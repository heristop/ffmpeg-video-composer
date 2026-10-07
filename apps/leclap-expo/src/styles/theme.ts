// LeClap theme and styling constants

// Font families. Oswald (a condensed, cinematic display face — fitting for a video tool)
// is loaded in app/_layout.tsx and used for display/headings/buttons; body text stays on
// the system UI font for legibility at small sizes. `poppins` = display, `inter` = body.
export const fonts = {
  // Display family — Oswald (condensed, cinematic) for titles, headings and buttons.
  poppins: {
    light: 'Oswald_300Light',
    regular: 'Oswald_400Regular',
    medium: 'Oswald_500Medium',
    semiBold: 'Oswald_600SemiBold',
    bold: 'Oswald_700Bold',
  },
  // Body family — system UI font, most legible at body sizes.
  inter: {
    regular: 'System',
    medium: 'System',
    semiBold: 'System',
    bold: 'System',
  },
};

// React Native's StyleSheet color parser has no oklch()/color-mix() — only hex, rgb(a), hsl(a), hwb,
// named colors and PlatformColor. To tint a brand color by opacity, expand a #RRGGBB hex to rgba() so
// the hue stays sourced from one token (e.g. colors.primary) instead of hardcoded rgb triplets.
export const withAlpha = (hex: string, alpha: number): string => {
  const n = parseInt(hex.replace('#', ''), 16);

  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Neutrals are tinted toward the lavender brand hue for subconscious cohesion — no flat
// pure-white/pure-gray (which read as untinted "AI default").
export const colors = {
  primary: '#7C83FD', // Lavender — soft and creative
  primaryDark: '#5B61D6', // Deeper lavender for depth / pressed states
  primaryLight: '#AEB2FB', // The web's brand-300, oklch(0.787 0.104 281.3): Clappy's running dust
  onPrimary: '#FFFFFF',
  monitorBackground: '#17142B',
  monitorText: '#FCFBFF',
  monitorSecondary: '#C6C2DD',
  scrim: withAlpha('#17142B', 0.55),
  // `primary` at 28% flattened over `background`. Opaque: a translucent fill on a view with
  // elevation lets Android's shadow show through the gap in its own outline, painting a hard-edged
  // lighter rectangle inside the shape.
  primaryMuted: '#D2D4FB',
  accent: '#FFE45E', // Warm yellow — energy and fun
  background: '#F4F3FA', // Lavender-tinted light background
  surface: '#FCFBFF', // Off-white surface, subtly tinted
  surfaceRaised: '#FFFFFF', // Pure white — used only inside tinted surfaces, for lift
  text: '#1B1830', // Near-black with a brand-hue tint
  textStrong: '#17142B', // Deepest ink for oversized display type (≥7:1 on the light bg)
  textSecondary: '#6E6A82', // Tinted secondary text (replaces flat #757575 gray)
  divider: '#E7E4F2', // Tinted divider
  hairline: withAlpha('#1B1830', 0.06), // Signature hairline (text hue at 6%)
  secondary: '#FF8AAE', // Warm pink — friendly accent
  success: '#3FB27F',
  error: '#F4505A',
  warning: '#FF9800',
  info: '#2196F3',
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
};

// Oswald is condensed, so display sizes run tight — but `lineHeight` must clear the font's full
// ascent+descent (≈1.15–1.18×) or RN clips descenders (g/y/p) and the accented glyphs of fr/de/es/it.
// These are the smallest line-heights that stay editorial-tight without cropping.
export const typography = {
  displayHero: {
    fontFamily: fonts.poppins.bold,
    fontSize: 72,
    lineHeight: 84,
    letterSpacing: -1,
  },
  displayXl: {
    fontFamily: fonts.poppins.bold,
    fontSize: 56,
    lineHeight: 66,
    letterSpacing: -0.5,
  },
  displayL: {
    fontFamily: fonts.poppins.semiBold,
    fontSize: 44,
    lineHeight: 52,
    letterSpacing: -0.25,
  },
  displayM: {
    fontFamily: fonts.poppins.semiBold,
    fontSize: 34,
    lineHeight: 41,
    letterSpacing: 0,
  },
  displayS: {
    fontFamily: fonts.poppins.medium,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: 0.1,
  },
  title: {
    fontFamily: fonts.poppins.bold,
    fontSize: 24,
    letterSpacing: 0.1,
  },
  subtitle: {
    fontFamily: fonts.poppins.semiBold,
    fontSize: 18,
    letterSpacing: 0.1,
  },
  heading: {
    fontFamily: fonts.poppins.medium,
    fontSize: 20,
    letterSpacing: 0.15,
  },
  body: {
    fontFamily: fonts.inter.regular,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  button: {
    fontFamily: fonts.poppins.medium,
    fontSize: 16,
    letterSpacing: 0.3,
  },
  caption: {
    fontFamily: fonts.inter.regular,
    fontSize: 14,
    letterSpacing: 0.2,
    color: colors.textSecondary,
  },
  smallText: {
    fontFamily: fonts.inter.regular,
    fontSize: 12,
    letterSpacing: 0.4,
  },
};

const ThemeExports = {
  name: 'Theme',
};
export default ThemeExports;

export { FORM_MAX_WIDTH } from './adaptive-layout';
