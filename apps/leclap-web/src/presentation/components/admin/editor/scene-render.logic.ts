// "Render this scene": the template cut down to one scene, so the preview render (the real WASM pipeline,
// placeholder media, ultrafast) shows that scene's exact engine effects in a few seconds instead of the whole
// video. Pure.
import type { EditorState } from '../templateEditorModel';

/**
 * `state` with only the scene at `index` (the whole-video look, theme, seed, overlays and watermark kept, so
 * the scene renders as it will in the video), or null when there is no such scene. Per-format compositions
 * are dropped: they would render the scene once per format.
 */
export function sceneOnlyState(state: EditorState, index: number): EditorState | null {
  const section = state.sections.at(index);

  if (!section || index < 0) return null;

  return { ...state, sections: [section], formats: undefined };
}
