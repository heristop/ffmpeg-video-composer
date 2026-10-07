// A glanceable summary of a generated descriptor for the "ready" card: how many scenes, roughly how
// long, and which effects it leans on. Durations of footage scenes are the author's target length
// (options.duration) when given, so the total is an estimate, flagged as such.
import type { TemplateDescriptor } from '@leclap/creative-kit/editor';

export interface DescriptorSummary {
  name: string;
  description: string;
  orientation: string;
  scenes: number;
  footageScenes: number;
  durationSeconds: number;
  // True when some scene has no explicit duration (its clip decides).
  durationIsEstimate: boolean;
  effects: string[];
}

type Section = NonNullable<TemplateDescriptor['sections']>[number];

const VISUAL_TYPES = new Set(['video', 'project_video', 'color_background', 'image_background', 'effect']);

function sectionEffects(section: Section): string[] {
  const loose = section as unknown as {
    look?: string;
    motion?: Array<{ type: string }>;
    transition?: { type: string };
    filters?: Array<{ type?: string; reveal?: { type?: string } | string }>;
  };
  const reveals = (loose.filters ?? [])
    .map((filter) => (typeof filter.reveal === 'string' ? filter.reveal : filter.reveal?.type))
    .filter((type): type is string => typeof type === 'string' && type !== 'none');

  return [
    ...(loose.look ? [`look: ${loose.look}`] : []),
    ...(loose.motion ?? []).map((motion) => `motion: ${motion.type}`),
    ...(loose.transition && loose.transition.type !== 'cut' ? [`transition: ${loose.transition.type}`] : []),
    ...reveals.map((type) => `reveal: ${type}`),
  ];
}

function sectionDuration(section: Section): number | null {
  const duration = (section.options as { duration?: unknown } | undefined)?.duration;

  return typeof duration === 'number' && duration > 0 ? duration : null;
}

function metaText(descriptor: TemplateDescriptor, key: 'name' | 'description'): string {
  const value = (descriptor.meta as Record<string, unknown> | undefined)?.[key];

  return typeof value === 'string' ? value : '';
}

export function summarizeDescriptor(descriptor: TemplateDescriptor): DescriptorSummary {
  const visual = (descriptor.sections ?? []).filter((section) => VISUAL_TYPES.has(section.type));
  const durations = visual.map(sectionDuration);
  const look = descriptor.global?.look;
  const globalLook = look ? [`look: ${typeof look === 'string' ? look : look.preset}`] : [];
  const globalTransition =
    descriptor.global?.transition && descriptor.global.transition.type !== 'cut'
      ? [`transition: ${descriptor.global.transition.type}`]
      : [];

  return {
    name: metaText(descriptor, 'name'),
    description: metaText(descriptor, 'description'),
    orientation: descriptor.global?.orientation ?? 'landscape',
    scenes: visual.length,
    footageScenes: visual.filter((section) => section.type === 'project_video').length,
    durationSeconds: durations.reduce<number>((total, value) => total + (value ?? 0), 0),
    durationIsEstimate: durations.includes(null),
    effects: [...new Set([...globalLook, ...globalTransition, ...visual.flatMap(sectionEffects)])],
  };
}
