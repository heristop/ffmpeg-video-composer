// Lets a control deep in the panel (the effect panel's "Render this scene") start the builder's preview
// render of the selected scene alone, through the same dialog as the titlebar's Preview render. Provided by
// the shell; absent elsewhere, where the control hides.
import { createContext, useContext, type ReactNode } from 'react';
import type { EditorState } from '../templateEditorModel';
import type { PreviewRender } from './usePreviewRender';
import { sceneOnlyState } from './scene-render.logic';

export interface SceneRender {
  /** Renders the selected scene alone and opens the preview dialog. */
  render: () => void;
  /** A preview render is running (the control disables). */
  rendering: boolean;
}

const SceneRenderContext = createContext<SceneRender | null>(null);

export function useSceneRender(): SceneRender | null {
  return useContext(SceneRenderContext);
}

interface SceneRenderScopeProps {
  state: EditorState;
  sectionIndex: number;
  preview: PreviewRender;
  children: ReactNode;
}

export const SceneRenderScope = ({ state, sectionIndex, preview, children }: SceneRenderScopeProps) => {
  const scene = sceneOnlyState(state, sectionIndex);
  const value: SceneRender | null = scene
    ? {
        render: () => {
          preview.start(scene).catch(() => {});
        },
        rendering: preview.rendering,
      }
    : null;

  return <SceneRenderContext.Provider value={value}>{children}</SceneRenderContext.Provider>;
};
