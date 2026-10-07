// Emoji advisories: what `global.emoji` will do to the template's emoji, read render-free. Like the
// pacing lint they never enter `errors` — the render still succeeds — they say which emoji won't show:
//   emoji_missing_asset  no bundled image for a cluster (default `image` mode): it is stripped;
//   emoji_overlay_cap    a section composites more than MAX_EMOJI_OVERLAYS images: the rest are stripped;
//   emoji_stripped       `strip` mode removes every emoji.
// `error` mode reports through validation instead (emoji_unsupported, glyph-coverage.ts).
import { expandPartialsSafe } from '@/core/partials';
import { emojiClusters } from '@/core/emoji-clusters';
import { coverageFor } from '@/core/font-coverage';
import { MAX_EMOJI_OVERLAYS, emojiAssetKey, emojiMode } from '@/core/emoji-assets';
import type { TemplateDescriptor } from '../schemas/template.schemas';
import { drawnTexts, type DrawnText } from './glyph-coverage';
import type { MotionWarning } from './motion-lint';

interface ClusterUse {
  drawn: DrawnText;
  clusters: string[];
}

function warn(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path, code, message, severity: 'warn', hint };
}

function quoted(clusters: string[]): string {
  return [...new Set(clusters)].join(' ');
}

function missingAssets(uses: ClusterUse[]): MotionWarning[] {
  return uses.flatMap(({ drawn, clusters }) => {
    const missing = clusters.filter((cluster) => emojiAssetKey(cluster) === null);

    return missing.length === 0
      ? []
      : [
          warn(
            drawn.path,
            'emoji_missing_asset',
            `${drawn.label}: no bundled image for ${quoted(missing)} — stripped from the drawn text`,
            'Use a common emoji (faces, hands, hearts, symbols, flags) or remove it.'
          ),
        ];
  });
}

// Global overlays draw on several sections; the cap is counted per section's own text.
function sectionOf(path: string): string | null {
  return /^sections\[\d+\]/.exec(path)?.[0] ?? null;
}

function overCap(uses: ClusterUse[]): MotionWarning[] {
  const counts = new Map<string, number>();

  for (const { drawn, clusters } of uses) {
    const section = sectionOf(drawn.path);
    const placed = clusters.filter((cluster) => emojiAssetKey(cluster) !== null).length;

    if (section !== null) counts.set(section, (counts.get(section) ?? 0) + placed);
  }

  return [...counts]
    .filter(([, count]) => count > MAX_EMOJI_OVERLAYS)
    .map(([section, count]) =>
      warn(
        section,
        'emoji_overlay_cap',
        `${count} emoji images in one section; only the first ${MAX_EMOJI_OVERLAYS} are composited, the rest are stripped`,
        `Keep a section to ${MAX_EMOJI_OVERLAYS} emoji or fewer.`
      )
    );
}

function stripped(uses: ClusterUse[]): MotionWarning[] {
  return uses.map(({ drawn, clusters }) =>
    warn(
      drawn.path,
      'emoji_stripped',
      `${drawn.label}: global.emoji is "strip", so ${quoted(clusters)} will not be drawn`,
      'Drop global.emoji (or set it to "image") to draw emoji as bundled colour images.'
    )
  );
}

function clusterUses(template: TemplateDescriptor): ClusterUse[] {
  return drawnTexts(template)
    .map((drawn) => ({ drawn, clusters: emojiClusters(drawn.text, coverageFor(drawn.font)) }))
    .filter((use) => use.clusters.length > 0);
}

/** Render-free emoji advisories for `template` (partials expanded first). */
export function emojiAdvisories(template: unknown): MotionWarning[] {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok || expansion.data === null || typeof expansion.data !== 'object') return [];

  const descriptor = expansion.data as TemplateDescriptor;
  const mode = emojiMode(descriptor.global);

  try {
    const uses = mode === 'error' ? [] : clusterUses(descriptor);

    return mode === 'strip' ? stripped(uses) : [...missingAssets(uses), ...overCap(uses)];
  } catch {
    return [];
  }
}
