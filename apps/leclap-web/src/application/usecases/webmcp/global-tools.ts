// Template-wide edits (#16–#18): the theme, the output format (orientation and delivery platform) and
// the music bed (library tracks, upload, volumes, ducking). Each is a descriptor-level change that takes
// the same path as edit_template — revision check, builder checks, no new validation errors, the round
// trip with dropped-field reporting — and lands as one undo step.
import { z } from 'zod';
import { OrientationSchema } from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';
import { PLATFORM_NAMES } from 'ffmpeg-video-composer/src/core/platforms.ts';
import { BUILTIN_THEMES } from 'ffmpeg-video-composer/src/core/theme/themes.ts';
import { buildDescriptor, type TemplateDescriptor } from '@leclap/creative-kit/editor';
import { MUSIC_LIBRARY } from '@leclap/creative-kit/media';
import { applyDescriptor } from './apply-descriptor';
import { expectedRevision, note, stale } from './edit-tools';
import { sanitizeDeep } from './guard';
import { fail, revisionConflict } from './results';
import { defineTool, type ToolContext, type ToolResult } from './types';

type Global = NonNullable<TemplateDescriptor['global']>;

// The current descriptor with `change` applied to a copy of its global block, then applied as one step.
function editGlobal(ctx: ToolContext, revision: string, change: (global: Global) => ToolResult | null): ToolResult {
  const state = ctx.port.getState();

  if (stale(state, revision)) return revisionConflict();

  const candidate = structuredClone(buildDescriptor(state));
  candidate.global ??= {};
  const refused = change(candidate.global);

  return refused ?? applyDescriptor(candidate, state, ctx);
}

const setTheme = defineTool({
  name: 'set_theme',
  title: 'Set Theme',
  description:
    `Set global.theme: a built-in name (${Object.keys(BUILTIN_THEMES).join(', ')}) or a theme object ` +
    '{ extends, colors, fonts, radius, motion } (get_template_schema with pointer "/$defs/Theme"); null removes ' +
    'it. `$color.*` / `$font.*` references elsewhere resolve against it. One undo step.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    theme: z
      .union([z.string().min(1).max(60), z.record(z.string(), z.unknown()), z.null()])
      .describe('A built-in theme name, a theme object, or null to remove the theme.'),
    note,
  }),
  run: (args, ctx) =>
    editGlobal(ctx, args.expectedRevision, (global) => {
      delete global.theme;

      if (args.theme !== null) global.theme = sanitizeDeep(args.theme) as Global['theme'];

      return null;
    }),
});

const setFormat = defineTool({
  name: 'set_format',
  title: 'Set Format',
  description:
    'Set the output format: `orientation` (landscape 1280x720, portrait 720x1280, square 1080x1080) and/or the ' +
    'delivery `platform` (safe zones, duration and loudness targets; null removes it). Pick a platform whose ' +
    'orientation matches, or validate_template reports the mismatch. One undo step.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    orientation: z.enum(OrientationSchema.options).optional(),
    platform: z.enum(PLATFORM_NAMES).nullable().optional().describe('Delivery target, or null to clear it.'),
    note,
  }),
  run: (args, ctx) => {
    if (args.orientation === undefined && args.platform === undefined) {
      return fail('invalid_input', 'Pass orientation, platform, or both.');
    }

    return editGlobal(ctx, args.expectedRevision, (global) => {
      if (args.orientation) global.orientation = args.orientation;

      if (args.platform === null) delete global.platform;

      if (args.platform) global.platform = args.platform;

      return null;
    });
  },
});

const MUSIC_IDS = new Set(MUSIC_LIBRARY.map((track) => track.id));

interface MusicArgs {
  tracks?: string[];
  allowUpload?: boolean;
  musicVolume?: number;
  sourceVolume?: number;
  ducking?: boolean;
}

function applyMusic(global: Global, args: MusicArgs): void {
  if (args.tracks) global.allowedMusic = [...new Set(args.tracks)];

  if (args.allowUpload !== undefined) global.allowUploadMusic = args.allowUpload;

  global.musicEnabled = (global.allowedMusic?.length ?? 0) > 0 || global.allowUploadMusic === true;

  const audio: NonNullable<Global['audio']> = { ...global.audio };

  if (args.musicVolume !== undefined) audio.musicVolume = args.musicVolume;

  if (args.sourceVolume !== undefined) audio.sourceVolume = args.sourceVolume;

  if (args.ducking === false) delete audio.ducking;

  // On keeps the fine-tuned settings the template already has.
  if (args.ducking === true && !audio.ducking) audio.ducking = true;

  global.audio = audio;
}

const volume = z.number().min(0).max(1);

const setMusic = defineTool({
  name: 'set_music',
  title: 'Set Music',
  description:
    'Set the music bed: `tracks` lists the library track ids the user may pick from (an empty list with ' +
    'allowUpload false removes music), `allowUpload` lets the user bring their own file, `musicVolume` / ' +
    '`sourceVolume` are 0..1 and `ducking` lowers the music under speech. Unknown track ids are refused with the ' +
    'valid ones. One undo step.',
  kind: 'edit',
  input: z.object({
    expectedRevision,
    tracks: z.array(z.string().min(1).max(100)).max(30).optional().describe('Music library ids.'),
    allowUpload: z.boolean().optional(),
    musicVolume: volume.optional(),
    sourceVolume: volume.optional(),
    ducking: z.boolean().optional(),
    note,
  }),
  run: (args, ctx) => {
    const unknown = (args.tracks ?? []).filter((id) => !MUSIC_IDS.has(id));

    if (unknown.length > 0) {
      return fail('not_found', `Unknown music track(s): ${unknown.slice(0, 10).join(', ')}.`, {
        hint: `Library ids: ${[...MUSIC_IDS].join(', ')}.`,
      });
    }

    const { expectedRevision: revision, note: _note, ...music } = args;

    if (Object.keys(music).length === 0) {
      return fail('invalid_input', 'Pass at least one music setting.');
    }

    return editGlobal(ctx, revision, (global) => {
      applyMusic(global, music);

      return null;
    });
  },
});

export const GLOBAL_TOOLS = [setTheme, setFormat, setMusic];
