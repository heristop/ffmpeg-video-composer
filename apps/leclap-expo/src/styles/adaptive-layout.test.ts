import { adaptiveLayout, fitFrame } from './adaptive-layout';

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('adaptive app window', () => {
  it('uses the safe width, including landscape cutouts', () => {
    const layout = adaptiveLayout(852, 393, 1, { top: 0, bottom: 21, left: 59, right: 59 });
    expect(layout.contentWidth).toBe(734);
    expect(layout.sidePanel).toBe(true);
    expect(layout.navigationRail).toBe(false);
  });

  it('reflows from a narrow cover screen to a passport-shaped unfolded window', () => {
    expect(adaptiveLayout(320, 780, 1, noInsets)).toMatchObject({ sizeClass: 'compact', sidePanel: false });
    expect(adaptiveLayout(720, 780, 1, noInsets)).toMatchObject({ sizeClass: 'medium', sidePanel: false });
    expect(adaptiveLayout(960, 840, 1, noInsets)).toMatchObject({
      sizeClass: 'expanded',
      sidePanel: true,
      navigationRail: true,
    });
    expect(adaptiveLayout(390, 840, 1, noInsets).sidePanel).toBe(false);
  });

  it('keeps large text in a single flow and caps content on large windows', () => {
    expect(adaptiveLayout(960, 840, 1.5, noInsets).sidePanel).toBe(false);
    expect(adaptiveLayout(1366, 1024, 1, noInsets).contentWidth).toBe(1120);
  });

  it('fits square and portrait frames inside short windows instead of clipping', () => {
    expect(fitFrame(780, 360, 1)).toEqual({ width: 360, height: 360 });
    expect(fitFrame(780, 360, 9 / 16)).toEqual({ width: 202.5, height: 360 });
    expect(fitFrame(320, 780, 16 / 9)).toEqual({ width: 320, height: 180 });
    expect(fitFrame(0, 0, 1)).toEqual({ width: 0, height: 0 });
  });
});
