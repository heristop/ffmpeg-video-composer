// The structure as binding prompt rules (one beat per shot, in order) and the drift check a generated
// template is held to. The rules carry the format only: never what the reference shows.

import type { ReferenceStructure, Shot, TransitionGuess } from './types';

const LISTED_SHOTS = 24;
const DEFAULT_TOLERANCE = 0.2;
// Absolute slack (s) on top of the relative tolerance: a 0.25 s sampling grid can't time shorter.
const SLACK = 0.15;

/** The LeClap transition each guess maps to (xfade names, or a cut). */
export const LECLAP_TRANSITION: Record<TransitionGuess, string> = { cut: 'cut', dissolve: 'fade', dip: 'fadeblack' };

const MOTION_WORDS = ['still', 'calm', 'lively', 'fast'];

function motionWord(motion: number): string {
  return MOTION_WORDS[Math.min(MOTION_WORDS.length - 1, Math.floor(motion * MOTION_WORDS.length))];
}

function shotLine(shot: Shot): string {
  const entry =
    shot.transitionIn === null ? 'opens the video' : `enters with "${LECLAP_TRANSITION[shot.transitionIn]}"`;
  const detail = shot.anchor === 'spread' ? 'detail spread across the frame' : `main element ${shot.anchor}`;

  return `- Shot ${shot.index + 1}: ${shot.duration} s, ${shot.ground} ground, ${detail}, ${motionWord(shot.motion)}, ${entry}.`;
}

export function structurePromptRules(structure: ReferenceStructure): string {
  const { rhythm, shots } = structure;
  const head = [
    'Reference format (BINDING structure: copy the format, never the reference’s subjects, logos or text):',
  ];

  if (shots.length === 1) {
    return [
      ...head,
      `- The reference is one continuous shot of ${structure.duration} s: build one section with its motion inside, no cuts.`,
      shotLine(shots[0]),
    ].join('\n');
  }

  const listed = shots.slice(0, LISTED_SHOTS).map(shotLine);
  const rest = shots.length - LISTED_SHOTS;

  return [
    ...head,
    `- ${rhythm.shots} shots over ${structure.duration} s (average ${rhythm.avgShot} s, shortest ${rhythm.shortest} s, longest ${rhythm.longest} s, ${rhythm.cutsPerMinute} cuts/min).`,
    '- One section per shot, in this order, each within ±20% of its length; use the transition named for each boundary.',
    '- "main element <zone>" is where the headline or subject sits on a 3×3 grid; a dark/light ground sets the section background.',
    ...listed,
    ...(rest > 0 ? [`- …and ${rest} more shots in the same rhythm (average ${rhythm.avgShot} s).`] : []),
  ].join('\n');
}

export interface DriftIssue {
  code: 'shot_count' | 'shot_duration';
  message: string;
}

export function structureDrift(
  sections: readonly { name: string; duration: number; durationKnown?: boolean }[],
  structure: ReferenceStructure,
  tolerance = DEFAULT_TOLERANCE
): DriftIssue[] {
  const expected = structure.shots.length;
  const allowance = Math.max(1, Math.round(0.15 * expected));
  const issues: DriftIssue[] = [];

  if (Math.abs(sections.length - expected) > allowance) {
    issues.push({
      code: 'shot_count',
      message: `${sections.length} sections for a reference of ${expected} shots`,
    });
  }

  for (const [i, section] of sections.slice(0, expected).entries()) {
    const shot = structure.shots[i];

    if (section.durationKnown === false) continue;

    if (Math.abs(section.duration - shot.duration) <= tolerance * shot.duration + SLACK) continue;

    issues.push({
      code: 'shot_duration',
      message: `section "${section.name}" lasts ${section.duration} s where shot ${i + 1} lasts ${shot.duration} s`,
    });
  }

  return issues;
}
