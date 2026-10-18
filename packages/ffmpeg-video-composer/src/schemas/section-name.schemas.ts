// A section name becomes file names (`<buildDir>/<name>_output.mp4`, the concat list) written unquoted into
// the FFmpeg command string, and pad labels (`<name>_text`, `<name>_bg`) in the filter graph: letters, digits,
// `_`, `-` and `.`, never `..`, and at least one letter or digit. The render checks it again (core/arg-guard.ts assertSafeSegmentName).
export const SECTION_NAME = /^(?!.*\.\.)(?=.*[A-Za-z0-9])[A-Za-z0-9_.-]+$/;
