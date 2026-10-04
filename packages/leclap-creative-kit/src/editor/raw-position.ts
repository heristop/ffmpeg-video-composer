// Stored drawtext x/y the [0,1] fraction cannot express (absolute pixels, `w-text_w-44`). The
// fraction is what the builder edits; the stored expression is written back only while `fraction`
// still equals the overlay's fraction, so moving an overlay falls back to the fraction form.
export interface RawPosition {
  rawX?: { expr: string | number; fraction: number };
  rawY?: { expr: string | number; fraction: number };
}
