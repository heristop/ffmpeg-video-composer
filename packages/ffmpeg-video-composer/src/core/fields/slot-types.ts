import { TemplateDescriptorSchema } from '../../schemas/section.schemas';
import type { FieldValue } from './coerce';

// A whole-string placeholder takes the field's typed value, but the slot decides: a number placed alone in a
// string-only slot (`text: { en: "{{ PRICE }}" }`) goes in as its text, and a numeric-looking enum option
// placed in a numeric slot (`duration: "{{ HOLD }}"`) goes in as a number. The schema is the judge: the
// typed value stays unless the slot rejects it and accepts the other form.

type Path = ReadonlyArray<string | number>;

export interface SlotCandidate {
  path: Path;
  /** The other form of the value (its text for a number, its number for a numeric-looking option). */
  alternative: FieldValue;
}

function rejectedSlots(descriptor: unknown): Set<string> {
  const parsed = TemplateDescriptorSchema.safeParse(descriptor);

  return new Set((parsed.error?.issues ?? []).map((issue) => issue.path.join('.')));
}

function holderOf(root: unknown, path: Path): Record<string | number, unknown> | undefined {
  let node: unknown = root;

  for (const key of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return undefined;

    node = (node as Record<string | number, unknown>)[key];
  }

  return node !== null && typeof node === 'object' ? (node as Record<string | number, unknown>) : undefined;
}

function swap(root: unknown, candidate: SlotCandidate): SlotCandidate {
  const holder = holderOf(root, candidate.path);
  const key = candidate.path.at(-1) as string | number;
  const current = holder?.[key] as FieldValue;

  if (holder) holder[key] = candidate.alternative;

  return { path: candidate.path, alternative: current };
}

/** Swaps (in place, on a freshly resolved descriptor) each candidate its slot rejects for its other form. */
export function settleSlotTypes(descriptor: unknown, candidates: SlotCandidate[]): void {
  if (candidates.length === 0) return;

  const rejected = rejectedSlots(descriptor);
  const swapped = candidates
    .filter((candidate) => rejected.has(candidate.path.join('.')))
    .map((candidate) => swap(descriptor, candidate));

  if (swapped.length === 0) return;

  // The other form is kept only where the slot takes it; elsewhere the typed value goes back (its finding is
  // the clearer one).
  const stillRejected = rejectedSlots(descriptor);

  for (const original of swapped) {
    if (stillRejected.has(original.path.join('.'))) swap(descriptor, original);
  }
}
