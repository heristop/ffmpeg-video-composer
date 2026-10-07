// The bundled sound-effect library: one manifest the schema (id enum), the mix (duration, anchor,
// default level), the auto placement and the motion catalog all read. The files themselves are
// synthesized by packages/leclap-creative-kit/scripts/gen-sfx.ts into its src/library/sfx/ folder (original,
// license-free audio); a test checks every entry against the file on disk. Pure data.

export const SFX_IDS = [
  'whoosh',
  'swoosh-short',
  'hit',
  'boom',
  'riser',
  'click',
  'tick',
  'pop',
  'shutter',
  'ding',
  'glitch',
  'sparkle',
  'thud',
  'zap',
  'notification',
  'keystroke',
  'blip',
  'rise-short',
  'coin',
  'drum-roll',
  'heartbeat',
  'clap',
  'snap',
  'success',
  'error',
  'swoosh-long',
  'sub-drop',
  'reverse-cymbal',
  'water-drop',
  'whistle-up',
  'camera-focus',
  'paper',
  'tada',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

export interface SfxEntry {
  id: SfxId;
  /** File name under the library's `sfx/` folder. */
  file: string;
  /** Length in seconds. */
  duration: number;
  /** Which edge of the sound lands on `at`: `start` plays from `at`, `end` finishes at `at` (a riser). */
  anchor: 'start' | 'end';
  /** Level (gain, 0..2) when a cue sets no `volume`; the files are peak-normalised to -3 dBFS. */
  defaultVolume: number;
  useWhen: string;
  avoidWhen: string;
}

function entry(id: SfxId, duration: number, rest: Omit<SfxEntry, 'id' | 'file' | 'duration'>): SfxEntry {
  return { id, file: `${id}.m4a`, duration, ...rest };
}

export const SFX_LIBRARY: Record<SfxId, SfxEntry> = {
  whoosh: entry('whoosh', 0.6, {
    anchor: 'start',
    defaultVolume: 0.5,
    useWhen: 'a designed transition (push, swipe, zoom-through) or a fast camera move',
    avoidWhen: 'calm fades and dissolves, or more than one per two seconds',
  }),
  'swoosh-short': entry('swoosh-short', 0.3, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a quick slide-in of a label, panel or lower third',
    avoidWhen: 'slow reveals; pair a long transition with whoosh instead',
  }),
  hit: entry('hit', 0.5, {
    anchor: 'start',
    defaultVolume: 0.7,
    useWhen: 'a kinetic impact landing, a camera hit or a flash on the beat',
    avoidWhen: 'body copy and calm beats; more than one hit per beat',
  }),
  boom: entry('boom', 1.2, {
    anchor: 'start',
    defaultVolume: 0.7,
    useWhen: 'the drop or the reveal after a riser, a title slam',
    avoidWhen: 'anything but the single biggest moment of the video',
  }),
  riser: entry('riser', 2, {
    anchor: 'end',
    defaultVolume: 0.5,
    useWhen: 'building into a drop or reveal: place it at the moment it leads into ("cue:drop")',
    avoidWhen: 'sections shorter than the riser, or several builds in a row',
  }),
  click: entry('click', 0.05, {
    anchor: 'start',
    defaultVolume: 0.5,
    useWhen: 'a UI tap or button press in a product demo',
    avoidWhen: 'cinematic pieces',
  }),
  tick: entry('tick', 0.06, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a counter step, a typewriter rhythm or a list item appearing',
    avoidWhen: 'dense repetition faster than 6 per second',
  }),
  pop: entry('pop', 0.15, {
    anchor: 'start',
    defaultVolume: 0.55,
    useWhen: 'playful labels, stickers, emoji or a pop kinetic preset',
    avoidWhen: 'serious or corporate tone',
  }),
  shutter: entry('shutter', 0.25, {
    anchor: 'start',
    defaultVolume: 0.6,
    useWhen: 'a freeze frame, a photo reveal or a flash graphic',
    avoidWhen: 'moments with no photographic idea',
  }),
  ding: entry('ding', 1.5, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a success state, a notification or a final call to action',
    avoidWhen: 'more than once per video',
  }),
  glitch: entry('glitch', 0.4, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a glitch transition, an RGB-split or distortion graphic, a tech or error beat',
    avoidWhen: 'calm or premium pieces, or more than a couple per video',
  }),
  sparkle: entry('sparkle', 1.2, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a magical reveal, a shine sweep over a logo, a sticker or emoji appearing',
    avoidWhen: 'serious tone; stacking it with a ding on the same moment',
  }),
  thud: entry('thud', 0.45, {
    anchor: 'start',
    defaultVolume: 0.6,
    useWhen: 'a soft landing: a card, block or word dropping into place, a subtle emphasis',
    avoidWhen: 'the big impacts (use hit or boom), or rapid sequences',
  }),
  zap: entry('zap', 0.35, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'neon or electric graphics, a power-up, a quick energetic accent',
    avoidWhen: 'calm, natural footage',
  }),
  notification: entry('notification', 0.8, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a message, alert or app notification popping up in a product demo',
    avoidWhen: 'cinematic pieces; keep ding for the single final success',
  }),
  keystroke: entry('keystroke', 0.09, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a typing or typewriter text reveal, one per character or word',
    avoidWhen: 'more than 12 per second, or counters (use tick)',
  }),
  blip: entry('blip', 0.12, {
    anchor: 'start',
    defaultVolume: 0.4,
    useWhen: 'a UI element appearing, a toggle, a hover or a menu item in a product demo',
    avoidWhen: 'cinematic pieces and dense repetition',
  }),
  'rise-short': entry('rise-short', 0.6, {
    anchor: 'end',
    defaultVolume: 0.5,
    useWhen: 'a quick lift into a cut, a title or a punch-in: place it at the moment it leads into',
    avoidWhen: 'big drops (use riser then boom), or sections shorter than the rise',
  }),
  coin: entry('coin', 0.6, {
    anchor: 'start',
    defaultVolume: 0.4,
    useWhen: 'a price, a reward, points scored or a purchase confirmation',
    avoidWhen: 'serious finance or corporate tone',
  }),
  'drum-roll': entry('drum-roll', 1.5, {
    anchor: 'end',
    defaultVolume: 0.5,
    useWhen: 'the build into an announcement, a winner or a number reveal: place it at the reveal',
    avoidWhen: 'more than once per video, or sections shorter than the roll',
  }),
  heartbeat: entry('heartbeat', 1, {
    anchor: 'start',
    defaultVolume: 0.7,
    useWhen: 'suspense, tension or a slow-motion moment; repeat it every second for a pulse',
    avoidWhen: 'upbeat or playful pieces',
  }),
  clap: entry('clap', 0.5, {
    anchor: 'start',
    defaultVolume: 0.6,
    useWhen: 'a beat-synced cut, a title landing on the beat, applause for a reveal or the brand moment',
    avoidWhen: 'more than one per beat, or stacking it with a hit on the same frame',
  }),
  snap: entry('snap', 0.2, {
    anchor: 'start',
    defaultVolume: 0.6,
    useWhen: 'an instant change: a snap cut, an outfit or scene swap, an item appearing out of nowhere',
    avoidWhen: 'cinematic pieces, or more than a few per video',
  }),
  success: entry('success', 1, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a task done, a form sent, a checkmark or a before/after win in a product demo',
    avoidWhen: 'stacking it with ding or sparkle; keep ding for the single final call to action',
  }),
  error: entry('error', 0.45, {
    anchor: 'start',
    defaultVolume: 0.4,
    useWhen: 'a wrong answer, a crossed-out myth, the "before" in a before/after or a failed state in a demo',
    avoidWhen: 'more than a couple per video; never on the product itself',
  }),
  'swoosh-long': entry('swoosh-long', 1.2, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'a slow transition, a long camera move or a big element gliding across the frame',
    avoidWhen: 'quick cuts (use whoosh or swoosh-short), or sections shorter than the pass',
  }),
  'sub-drop': entry('sub-drop', 1.5, {
    anchor: 'start',
    defaultVolume: 0.6,
    useWhen: 'the drop after a build, a heavy title slam or a dramatic cut to black',
    avoidWhen: 'calm pieces, or more than once or twice per video',
  }),
  'reverse-cymbal': entry('reverse-cymbal', 1.5, {
    anchor: 'end',
    defaultVolume: 0.45,
    useWhen: 'a swell into a cut, a reveal or a new chapter: place it at the moment it leads into',
    avoidWhen: 'sections shorter than the swell, or right after another build',
  }),
  'water-drop': entry('water-drop', 0.3, {
    anchor: 'start',
    defaultVolume: 0.5,
    useWhen: 'a bubble, a drop or a soft playful pop-in, drinks, skincare or nature shots',
    avoidWhen: 'serious tone and dense repetition',
  }),
  'whistle-up': entry('whistle-up', 0.7, {
    anchor: 'start',
    defaultVolume: 0.35,
    useWhen: 'a comic beat: something shooting up, a jump, a surprised zoom or a punchline',
    avoidWhen: 'serious, premium or corporate tone',
  }),
  'camera-focus': entry('camera-focus', 0.62, {
    anchor: 'start',
    defaultVolume: 0.4,
    useWhen: 'a rack focus, a blur-to-sharp reveal or a zoom-in on a detail before a shutter',
    avoidWhen: 'moments with no camera idea',
  }),
  paper: entry('paper', 0.45, {
    anchor: 'start',
    defaultVolume: 0.5,
    useWhen: 'a page turn, a card flip, a list or chapter changing, a note or sticker slapped on',
    avoidWhen: 'electronic or tech moments (use swoosh-short or blip)',
  }),
  tada: entry('tada', 1.3, {
    anchor: 'start',
    defaultVolume: 0.45,
    useWhen: 'the big playful reveal: a winner, a finished result or the product unveiled',
    avoidWhen: 'more than once per video, or serious and premium tone',
  }),
};

export function sfxEntry(id: string): SfxEntry | undefined {
  return Object.hasOwn(SFX_LIBRARY, id) ? SFX_LIBRARY[id as SfxId] : undefined;
}
