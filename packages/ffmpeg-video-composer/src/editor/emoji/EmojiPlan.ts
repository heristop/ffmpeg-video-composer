// One section's emoji: which drawtext filters lost their emoji, which images replace them, the `-i`
// inputs those images take, and where they composite. SegmentBuilder drives it in four steps that
// mirror its own build order — rewrite (sugar staging), register (maps), compose (filters), stage
// (asset staging) — and a section without emoji never gets past the first.
import type { Filter } from '@/core/types';
import type Segment from '../../core/models/Segment';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import { EMOJI_DIR, MAX_EMOJI_OVERLAYS, emojiMode } from '@/core/emoji-assets';
import { buildSingleFileImageSource } from '../utils/input-sources';
import { extractEmojiOverlays, type EmojiContext, type EmojiOverlay } from './emoji-overlays';
import { emojiOverlayChains, linearWithEmoji, type EmojiChain } from './emoji-graph';
import { stageEmojiImages } from './emoji-staging';

export type EmojiPlanContext = Omit<EmojiContext, 'budget' | 'warn'> & {
  section: string;
  logger: AbstractLogger;
};

export class EmojiPlan {
  readonly overlays: EmojiOverlay[] = [];
  private readonly rewritten = new Set<Filter>();
  private readonly ctx: EmojiContext;
  private dir = '';
  private firstInput = -1;

  constructor(private readonly plan: EmojiPlanContext) {
    this.ctx = {
      ...plan,
      budget: { remaining: MAX_EMOJI_OVERLAYS },
      warn: (message) => {
        plan.logger.warn(`[${plan.section}][Emoji] ${message}`);
      },
    };
  }

  /** `filters` with every emoji-bearing drawtext rewritten; the images are collected on the plan. */
  rewrite(filters: Filter[]): Filter[] {
    const extraction = extractEmojiOverlays(filters, this.ctx);

    this.overlays.push(...extraction.overlays);

    for (const filter of extraction.rewritten) this.rewritten.add(filter);

    return extraction.filters;
  }

  /** Resolves the build directory the images are staged into (only when there are any). */
  async prepare(filesystem: AbstractFilesystem): Promise<void> {
    if (this.overlays.length > 0) this.dir = await filesystem.getBuildPath(EMOJI_DIR);
  }

  /** Adds one `-loop 1 -i` per image to the segment inputs, the first at stream index `firstInput`. */
  register(inputsAsset: Record<string, string>, firstInput: number): void {
    if (this.overlays.length === 0 || this.dir === '') return;

    this.firstInput = firstInput;

    for (const [index, overlay] of this.overlays.entries()) {
      inputsAsset[`emoji_${index}`] = buildSingleFileImageSource(`${this.dir}/${overlay.file}`);
    }
  }

  /**
   * Composites the images: onto the final pad of an overlay graph, or — for a linear chain — after the
   * last rewritten text filter, turning the chain into a graph. `filters` is the section's linear
   * filter list (1:1 with the segment's compiled `filtersList`); `video` the main video stream.
   */
  compose(segment: Segment, filters: Filter[], video: string): void {
    if (this.firstInput < 0) return;

    const chain = segment.filtersMapList.length > 0 ? this.onGraph(segment) : this.onLinear(segment, filters, video);

    if (!chain) return;

    segment.filtersMapList.push(...chain.chains);
    segment.mapsList.push(chain.out);
  }

  private onGraph(segment: Segment): EmojiChain | null {
    const last = segment.mapsList.at(-1);

    return last === undefined ? null : emojiOverlayChains(last, this.overlays, this.firstInput, this.plan.section);
  }

  private onLinear(segment: Segment, filters: Filter[], video: string): EmojiChain {
    const lastText = filters.findLastIndex((filter) => this.rewritten.has(filter));
    const splitAt = lastText === -1 ? segment.filtersList.length : lastText + 1;
    const overlays = { list: this.overlays, firstInput: this.firstInput, prefix: this.plan.section };

    return linearWithEmoji(segment.filtersList, splitAt, video, overlays);
  }

  /** Stages every image the section composites into the build directory. */
  async stage(filesystem: AbstractFilesystem): Promise<void> {
    if (this.firstInput < 0) return;

    const files = [...new Set(this.overlays.map((overlay) => overlay.file))];

    await stageEmojiImages(files, this.dir, { filesystem, logger: this.plan.logger, section: this.plan.section });
  }
}

export interface EmojiPlanDeps {
  global: { emoji?: unknown } | undefined;
  section: { name: string; options?: { upperCase?: boolean; lowerCase?: boolean } };
  sugar: { scale: string; duration: number; fps: number };
  locale: string;
  /** Global variables then form fields, as FormatterManager.formatText substitutes them. */
  substitute: (text: string) => string;
  logger: AbstractLogger;
}

// The string a drawtext `text` value draws, resolved exactly as FormatterManager.formatText does
// (locale, variables, fields, section case) minus the escaping, which still runs on the rewrite.
function drawnTextResolver(deps: EmojiPlanDeps): (text: unknown) => string | null {
  return (text) => {
    const localized = typeof text === 'object' && text !== null ? (text as Record<string, unknown>)[deps.locale] : text;

    if (typeof localized !== 'string') return null;

    const resolved = deps.substitute(localized);
    const options = deps.section.options;
    const upper = options?.upperCase ? resolved.toUpperCase() : resolved;

    return options?.lowerCase ? upper.toLowerCase() : upper;
  };
}

/** The emoji plan for one section, from the builder's own context. */
export function createEmojiPlan(deps: EmojiPlanDeps): EmojiPlan {
  const [width, height] = deps.sugar.scale.split(':').map(Number);

  return new EmojiPlan({
    mode: emojiMode(deps.global),
    width,
    height,
    duration: deps.sugar.duration,
    fps: deps.sugar.fps,
    resolveText: drawnTextResolver(deps),
    section: deps.section.name,
    logger: deps.logger,
  });
}
