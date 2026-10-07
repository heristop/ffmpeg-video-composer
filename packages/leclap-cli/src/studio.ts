// The studio production gates: an ordered checklist recorded in studio.json. Each gate names the artifacts
// that must exist before it can be passed; `leclap studio status` reports the next gate and what it still
// misses, `leclap studio pass <gate>` stamps it. Plain files, no hidden state.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Artifact {
  /** Folder-relative file or directory. */
  path: string;
  /** For a directory: the files that count (default: any non-hidden file). */
  match?: RegExp;
  /** What to produce, shown when missing. */
  label: string;
}

export interface Gate {
  id: string;
  label: string;
  needs: Artifact[];
}

const STILL = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|webm|mkv)$/i;
const NOTES = /^(?!README\.md$).+\.md$/i;

export const GATES: Gate[] = [
  {
    id: 'assets-approved',
    label: 'Assets approved',
    needs: [
      { path: 'brief.md', label: 'brief.md with approved assets and copy' },
      { path: 'assets', label: 'at least one approved file in assets/' },
    ],
  },
  {
    id: 'style-approved',
    label: 'Style approved',
    needs: [
      { path: 'style-guide.md', label: 'style-guide.md' },
      { path: 'shotlist.md', label: 'shotlist.md' },
    ],
  },
  {
    id: 'stills-checked',
    label: 'Stills checked',
    needs: [
      { path: 'template.json', label: 'template.json' },
      { path: 'reviews', match: STILL, label: 'contact-sheet stills (.png/.jpg) in reviews/' },
    ],
  },
  {
    id: 'rough-cut',
    label: 'Rough cut rendered',
    needs: [{ path: 'out', match: VIDEO, label: 'a rendered video in out/' }],
  },
  {
    id: 'repaired',
    label: 'Defects repaired',
    needs: [{ path: 'reviews', match: NOTES, label: 'defect notes (reviews/<pass>.md)' }],
  },
  {
    id: 'delivered',
    label: 'Delivered',
    needs: [{ path: 'out', match: VIDEO, label: 'the final video in out/' }],
  },
];

export interface StudioManifest {
  version: 1;
  name: string;
  createdAt: string;
  /** Gate id → ISO timestamp when passed, or null. */
  gates: Record<string, string | null>;
}

export const MANIFEST = 'studio.json';

function present(dir: string, artifact: Artifact): boolean {
  const target = path.join(dir, artifact.path);

  if (!existsSync(target)) return false;

  if (!statSync(target).isDirectory()) return true;

  const match = artifact.match ?? /^[^.]/;

  return readdirSync(target).some((file) => match.test(file));
}

export function missingArtifacts(dir: string, gate: Gate): Artifact[] {
  return gate.needs.filter((artifact) => !present(dir, artifact));
}

export function readManifest(dir: string): StudioManifest {
  const file = path.join(dir, MANIFEST);

  if (!existsSync(file)) throw new Error(`${file} not found: run \`leclap init --studio <dir>\` first`);

  return JSON.parse(readFileSync(file, 'utf8')) as StudioManifest;
}

export interface GateStatus {
  gate: Gate;
  passedAt: string | null;
  missing: Artifact[];
}

export interface StudioStatus {
  name: string;
  gates: GateStatus[];
  /** The first gate not yet passed; undefined once delivered. */
  next?: GateStatus;
}

export function studioStatus(dir: string): StudioStatus {
  const manifest = readManifest(dir);
  const gates = GATES.map((gate) => ({
    gate,
    passedAt: manifest.gates[gate.id] ?? null,
    missing: missingArtifacts(dir, gate),
  }));

  return { name: manifest.name, gates, next: gates.find((status) => status.passedAt === null) };
}

/**
 * Stamps `gateId` as passed now. Gates pass in order and only once their artifacts exist; `force` skips
 * the artifact check (never the order). Returns the updated manifest.
 */
export function passGate(dir: string, gateId: string, options: { now?: Date; force?: boolean } = {}): StudioManifest {
  const status = studioStatus(dir);
  const target = status.gates.find((entry) => entry.gate.id === gateId);

  if (!target) throw new Error(`unknown gate "${gateId}" (one of: ${GATES.map((gate) => gate.id).join(', ')})`);

  if (target.passedAt !== null) return readManifest(dir);

  if (status.next?.gate.id !== gateId) throw new Error(`pass "${status.next?.gate.id}" before "${gateId}"`);

  if (!options.force && target.missing.length > 0) {
    throw new Error(`"${gateId}" is missing: ${target.missing.map((artifact) => artifact.label).join('; ')}`);
  }

  const manifest = readManifest(dir);
  manifest.gates[gateId] = (options.now ?? new Date()).toISOString();
  writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}
