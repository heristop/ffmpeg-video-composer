export const CONTENT_MAX_WIDTH = 1120;
export const FORM_MAX_WIDTH = 720;
export const NAVIGATION_RAIL_WIDTH = 104;

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Use the current app window, including split-screen, rather than a device model or physical display. */
export function adaptiveLayout(width: number, height: number, fontScale: number, insets: Insets) {
  const usableWidth = Math.max(0, width - insets.left - insets.right);
  const usableHeight = Math.max(0, height - insets.top - insets.bottom);
  let sizeClass = 'compact';
  if (usableWidth >= 600) sizeClass = 'medium';

  if (usableWidth >= 840) sizeClass = 'expanded';

  return {
    usableWidth,
    usableHeight,
    contentWidth: Math.min(CONTENT_MAX_WIDTH, usableWidth),
    sizeClass,
    sidePanel: fontScale < 1.3 && (usableWidth >= 840 || (usableWidth >= 680 && usableHeight < 480)),
    navigationRail: usableWidth >= 840 && usableHeight >= 480 && fontScale < 1.3,
  };
}

/** Contain a template frame in its actual parent, including short landscape and near-square windows. */
export function fitFrame(width: number, height: number, aspect: number) {
  const fittedWidth = Math.max(0, Math.min(width, height * aspect));

  return { width: fittedWidth, height: fittedWidth / aspect };
}
