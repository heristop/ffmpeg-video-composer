import { describe, it, expect } from 'vitest';
import {
  overflowWarnings,
  legibilityWarnings,
  collisionWarnings,
  contrastWarnings,
  footageLegibilityWarnings,
} from '@/services/geometry/rules';
import type { Box } from '@/services/geometry/text-boxes';

const canvas = { width: 1280, height: 720 };

function box(overrides: Partial<Box> = {}): Box {
  return {
    path: 'sections[0].caption',
    label: 'Section "a" caption',
    x: 100,
    y: 500,
    width: 200,
    height: 48,
    fontSize: 40,
    startSec: 0,
    endSec: 5,
    settledSec: 2.5,
    approx: false,
    color: null,
    backdrop: null,
    // Defaults to "handled" so a test exercising an unrelated rule never trips the footage rule
    // by accident; the contrast/footage describe blocks below override this explicitly.
    legibilityAid: true,
    // Captions are author-positioned, so both axes are checked. The lowerThird boxes set this
    // false; see the "preset-anchored" cases in the overflow block below.
    verticalPositionAuthored: true,
    timingAssumed: false,
    sectionIndex: 0,
    drawIndex: 0,
    ...overrides,
  };
}

describe('overflowWarnings', () => {
  it('says nothing about a box inside the frame', () => {
    expect(overflowWarnings([box()], canvas)).toEqual([]);
  });

  it('reports a box that crosses the title-safe margin while staying inside the frame', () => {
    const warnings = overflowWarnings([box({ x: 10, width: 1260 })], canvas);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_overflow');
    expect(warnings[0].severity).toBe('warn');
  });

  // The lowerThird preset anchors its lines inside a band pinned to the frame edge, so their `y` is
  // not something the author chose — and on the engine's OWN preset the subtitle lands 6px below the
  // landscape title-safe line (11px portrait, 9px square). Checking that axis therefore fired on
  // every lowerThird in every orientation, with a two-character subtitle, telling the author to
  // "shorten it or reduce the size" when neither can move a band-anchored y.
  it('does not apply the vertical title-safe margin to preset-anchored text', () => {
    const subtitle = box({ y: 666, height: 24.2, verticalPositionAuthored: false });

    expect(overflowWarnings([subtitle], canvas)).toEqual([]);
  });

  // Width is still the author's to fix even inside a band, so the horizontal half must keep firing.
  it('still reports horizontal overflow for preset-anchored text', () => {
    const wide = box({ x: 10, width: 1260, y: 666, height: 24.2, verticalPositionAuthored: false });
    const warnings = overflowWarnings([wide], canvas);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_overflow');
  });

  // Exempting the title-safe margin must not also exempt the frame edge: text genuinely off-screen
  // is a real defect whoever positioned it.
  it('still reports preset-anchored text that leaves the frame entirely', () => {
    const offFrame = box({ y: 710, height: 40, verticalPositionAuthored: false });
    const warnings = overflowWarnings([offFrame], canvas);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_out_of_frame');
  });

  it('reports a box running off the right edge', () => {
    const warnings = overflowWarnings([box({ x: 1200, width: 300 })], canvas);

    expect(warnings[0].code).toBe('text_out_of_frame');
  });

  it('stays quiet about a sub-pixel excess instead of reporting "overflows ... by 0px"', () => {
    // Flush against the left title-safe margin and four tenths of a pixel past the right one — the
    // measurement's own noise, which rounding turned into a finding whose text said the excess was
    // zero.
    const margin = canvas.width * 0.05;

    expect(overflowWarnings([box({ x: margin, width: canvas.width - margin * 2 + 0.4 })], canvas)).toEqual([]);
  });

  it('flags text that clears the safe margin on one side even though it fits the safe width', () => {
    // 1140px inside a 1152px safe width, but pinned at the engine's absolute 80px left margin, so it
    // reaches 1220 — four pixels past the right margin at 1216. A width-only rule says nothing.
    const warnings = overflowWarnings([box({ x: 80, width: 1140 })], canvas);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_overflow');
  });

  it('prefers the out-of-frame finding over the softer safe-area one', () => {
    // 40 + 1300 = 1340 on a 1280-wide frame: 60px of it is not on screen at all, which is worse than
    // — and hides — the title-safe margin it also crosses.
    const warnings = overflowWarnings([box({ x: 40, width: 1300 })], canvas);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_out_of_frame');
    expect(warnings[0].message).toContain('60px');
  });

  it('carries the approximate flag through to the warning', () => {
    const warnings = overflowWarnings([box({ x: 40, width: 1300, approx: true })], canvas);

    expect(warnings[0].approx).toBe(true);
  });

  it('takes the vertical safe margin from the frame HEIGHT, not its width', () => {
    // The engine's own `position: "top"` preset draws the glyph box at y=60 and the default `bar`
    // style's background box reaches 18px further up, so y=42. Five percent of a 720px-high frame is
    // 36px — inside the margin. Deriving that inset from the 1280px WIDTH makes it 64px instead, and
    // a two-word default caption was reported as "extends 22px past the title-safe margin".
    expect(overflowWarnings([box({ x: 599, y: 42, width: 82, height: 91.2 })], canvas)).toEqual([]);

    const portrait = { width: 720, height: 1280 };

    // The same mistake in the other direction: on portrait the width-derived inset is 36px, so a box
    // 40px from the top cleared a margin that is really 64px. It must be reported.
    const warnings = overflowWarnings([box({ x: 300, y: 40, width: 120, height: 50 })], portrait);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_overflow');
  });
});

describe('legibilityWarnings', () => {
  it('accepts type at a readable size', () => {
    expect(legibilityWarnings([box({ fontSize: 40 })], canvas)).toEqual([]);
  });

  it('flags type below the readable floor', () => {
    // The floor is 2.5% of frame height: 18px on a 720px canvas.
    const warnings = legibilityWarnings([box({ fontSize: 10 })], canvas);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_too_small');
  });

  it('reads the size off the box rather than dividing the height back out', () => {
    // `height` also carries the background box's padding, so recovering the size from it would
    // report a number the author never wrote and cannot map back to their descriptor.
    const warnings = legibilityWarnings([box({ fontSize: 10, height: 10 * 1.2 + 36 })], canvas);

    expect(warnings[0].message).toContain('10px');
  });
});

describe('collisionWarnings', () => {
  it('says nothing about boxes that never share the screen', () => {
    const a = box({ path: 'sections[0].caption', startSec: 0, endSec: 2 });
    const b = box({ path: 'sections[1].caption', startSec: 3, endSec: 5 });

    expect(collisionWarnings([a, b])).toEqual([]);
  });

  it('treats back-to-back windows that differ by float rounding as touching', () => {
    // A global overlay repeated on consecutive sections: 2.1 + 2.1 + 2.1 accumulates to 6.300000000000001.
    const end = 2.1 + 2.1 + 2.1;
    const a = box({ path: 'global.overlays[0]', startSec: 4.2, endSec: end });
    const b = box({ path: 'global.overlays[0]', startSec: 6.3 - 1e-9, endSec: 8.4 });

    expect(collisionWarnings([a, b])).toEqual([]);
  });

  it('says nothing about simultaneous boxes that do not overlap in space', () => {
    const a = box({ path: 'sections[0].caption', x: 0, y: 100, startSec: 0, endSec: 5 });
    const b = box({ path: 'sections[1].caption', x: 0, y: 600, startSec: 0, endSec: 5 });

    expect(collisionWarnings([a, b])).toEqual([]);
  });

  it('reports boxes that overlap in space and time at once', () => {
    const a = box({ path: 'sections[0].caption', x: 100, y: 500, startSec: 0, endSec: 5 });
    const b = box({ path: 'sections[1].caption', x: 150, y: 510, startSec: 2, endSec: 7 });

    const warnings = collisionWarnings([a, b]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_collision');
    // Overlap window is [max(0,2), min(5,7)] = [2, 5] = 3.0s, not 2.0s.
    expect(warnings[0].message).toContain('3.0');
  });

  it('reports each pair once, not twice', () => {
    const a = box({ path: 'sections[0].caption', startSec: 0, endSec: 5 });
    const b = box({ path: 'sections[1].caption', startSec: 0, endSec: 5 });

    expect(collisionWarnings([a, b])).toHaveLength(1);
  });
});

describe('contrastWarnings', () => {
  it('says nothing when either colour is missing', () => {
    expect(contrastWarnings([box({ color: null, backdrop: '#000000' })])).toEqual([]);
    expect(contrastWarnings([box({ color: '#ffffff', backdrop: null })])).toEqual([]);
  });

  it('says nothing when either colour is unparseable, rather than guessing', () => {
    expect(contrastWarnings([box({ color: '{{ accent }}', backdrop: '#000000' })])).toEqual([]);
  });

  it('says nothing about text that clears the 3:1 floor', () => {
    expect(contrastWarnings([box({ color: '#f5f5f0', backdrop: '#141416' })])).toEqual([]);
  });

  it('flags text below the 3:1 floor, carrying both colours and the ratio', () => {
    const warnings = contrastWarnings([box({ path: 'sections[0].caption', color: '#333333', backdrop: '#1a1a1a' })]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_low_contrast');
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].path).toBe('sections[0].caption');
    // The LABEL, like every other rule — not the path. Both consumers print `path` in front of
    // `message`, so a path here rendered as `sections[0].caption: sections[0].caption: …`.
    expect(warnings[0].message).toBe(
      'Section "a" caption: #333333 on #1a1a1a is 1.4:1, below 3:1 — change the text colour or the background'
    );
    expect(warnings[0].message.startsWith(warnings[0].path)).toBe(false);
  });

  it('is never approximate, regardless of the box own approx flag', () => {
    const warnings = contrastWarnings([box({ color: '#333333', backdrop: '#1a1a1a', approx: true })]);

    expect(warnings[0].approx).toBe(false);
  });
});

describe('footageLegibilityWarnings', () => {
  it('says nothing when the backdrop is known', () => {
    expect(footageLegibilityWarnings([box({ backdrop: '#141416', legibilityAid: false })])).toEqual([]);
  });

  it('says nothing when a box, shadow or outline already handles it', () => {
    expect(footageLegibilityWarnings([box({ backdrop: null, legibilityAid: true })])).toEqual([]);
  });

  it('flags text over an unknown backdrop with no box, shadow or outline', () => {
    const warnings = footageLegibilityWarnings([
      box({ path: 'sections[1].caption', backdrop: null, legibilityAid: false }),
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('text_unreadable_over_footage');
    expect(warnings[0].severity).toBe('warn');
    expect(warnings[0].approx).toBe(false);
    expect(warnings[0].path).toBe('sections[1].caption');
    // "unknown background", not "footage": a color_background card that never set a backgroundColor
    // lands here too, and calling its backdrop footage is simply wrong.
    expect(warnings[0].message).toBe(
      'Section "a" caption has no box, outline or shadow over footage or an image — add `effect: { "shadow": true }` or a background box'
    );
    expect(warnings[0].message.startsWith(warnings[0].path)).toBe(false);
  });
});

describe('collisionWarnings on an assumed timeline', () => {
  // A section with no duration gets a stand-in window, so any overlap in TIME between its box and
  // another is a guess — even when both widths were measured from real font metrics.
  it('flags a collision as approximate when either window was assumed', () => {
    const a = box({ path: 'sections[0].caption', startSec: 0, endSec: 2, timingAssumed: true });
    const b = box({ path: 'sections[1].caption', startSec: 1, endSec: 3 });

    expect(collisionWarnings([a, b])[0].approx).toBe(true);
  });

  it('keeps a collision exact when both windows were declared', () => {
    const a = box({ path: 'sections[0].caption', startSec: 0, endSec: 2 });
    const b = box({ path: 'sections[1].caption', startSec: 1, endSec: 3 });

    expect(collisionWarnings([a, b])[0].approx).toBe(false);
  });
});
