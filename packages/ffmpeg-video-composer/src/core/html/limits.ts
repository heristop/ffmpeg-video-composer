// HTML layer constants, apart from the layout code so the validation rules import nothing else.

/** The largest box side, in output pixels. */
export const HTML_LAYER_MAX_SIZE = 1920;

/** Pixels rendered per output pixel: the PNG is drawn at 2× and scaled into its box by the overlay. */
export const HTML_LAYER_DENSITY = 2;

/** Bumped whenever the layout rules change what a layer draws, so cached renders are not reused. */
export const HTML_LAYOUT_VERSION = 1;
