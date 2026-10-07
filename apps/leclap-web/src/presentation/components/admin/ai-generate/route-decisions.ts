// Turns Jev's brief route into the chips the dialog shows and the hints the generation uses. A chip
// starts on when Jev was confident (≥ 0.5) and off (a suggestion) otherwise; the user can flip any
// of them, and only chips that are on feed the prompt.
import type { BriefRoute, Decision } from '@/application/usecases/ai-template/brief-router';
import type { GenerationHints, Orientation } from '@/application/usecases/ai-template/system-prompt';

export type { Orientation };

export type RouteField = 'genre' | 'platform' | 'orientation' | 'energy' | 'theme' | 'seed';

export interface RouteChip {
  field: RouteField;
  value: string;
  confidence: number;
  on: boolean;
}

export type RouteOverrides = Partial<Record<RouteField, boolean>>;

const FIELDS: RouteField[] = ['genre', 'platform', 'orientation', 'energy', 'theme', 'seed'];

function decisionOf(route: BriefRoute, field: RouteField): Decision<string | number> | undefined {
  return route[field];
}

export function routeChips(route: BriefRoute, overrides: RouteOverrides): RouteChip[] {
  return FIELDS.flatMap((field) => {
    const decision = decisionOf(route, field);

    if (
      !decision ||
      (field === 'platform' && decision.value === 'none') ||
      (field === 'genre' && decision.value === 'other')
    ) {
      return [];
    }

    return [
      {
        field,
        value: String(decision.value),
        confidence: decision.confidence,
        on: overrides[field] ?? decision.applied,
      },
    ];
  });
}

function chipValue(chips: RouteChip[], field: RouteField): string | undefined {
  return chips.find((chip) => chip.field === field && chip.on)?.value;
}

// The user's own Format/Length choices win over Jev's; Jev fills only what the user left on Auto.
export function effectiveHints(
  chips: RouteChip[],
  user: { orientation: Orientation | 'auto'; durationSeconds: number | null }
): GenerationHints {
  const orientation = user.orientation === 'auto' ? chipValue(chips, 'orientation') : user.orientation;
  const energy = chipValue(chips, 'energy');

  return {
    ...(orientation ? { orientation: orientation as Orientation } : {}),
    ...(user.durationSeconds ? { durationSeconds: user.durationSeconds } : {}),
    ...(chipValue(chips, 'platform') ? { platform: chipValue(chips, 'platform') } : {}),
    ...(energy === undefined ? {} : { energy: Number(energy) }),
    ...(chipValue(chips, 'genre') ? { genre: chipValue(chips, 'genre') } : {}),
    ...(chipValue(chips, 'theme') ? { theme: chipValue(chips, 'theme') } : {}),
  };
}

// The theme chip, when on: "Start from the best match" applies it to the opened template.
export function chosenTheme(chips: RouteChip[]): string | undefined {
  return chipValue(chips, 'theme');
}

export function preferredSamples(chips: RouteChip[]): string[] {
  const seed = chipValue(chips, 'seed');

  return seed ? [seed] : [];
}

export function percent(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

// An attached reference style sets the theme itself, so a routed built-in theme hint would contradict it.
export function withoutThemeHint(hints: GenerationHints, referenceStyle: string | null): GenerationHints {
  if (!referenceStyle) return hints;

  const rest = { ...hints };
  delete rest.theme;

  return rest;
}
