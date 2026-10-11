import { useEffect, useState } from 'react';
import { sceneMarkers, timelineLength } from './timeline.logic';

/** A template's scene starts and its own length, in its seconds (timeline.logic.ts). */
export interface TemplateScenes {
  markers: number[];
  length: number;
}

interface TemplateLike {
  sections?: unknown;
}

const scenesOf = (template: TemplateLike): TemplateScenes | null => {
  if (!Array.isArray(template.sections)) return null;

  const sections = template.sections as Parameters<typeof sceneMarkers>[0];
  const length = timelineLength(sections);

  return length > 0 ? { markers: sceneMarkers(sections), length } : null;
};

/**
 * The scenes of the template a video was rendered from, read from its public JSON (a showcase sample's), so the
 * timeline can mark where each scene starts. Nothing until it arrives, and nothing if it cannot be read.
 */
export function useTemplateScenes(url: string | undefined): TemplateScenes | null {
  const [scenes, setScenes] = useState<{ url: string; scenes: TemplateScenes | null } | null>(null);

  useEffect(() => {
    if (!url) return () => {};

    const controller = new AbortController();

    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<TemplateLike>) : null))
      .then((template) => {
        setScenes({ url, scenes: template ? scenesOf(template) : null });
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [url]);

  if (!scenes || scenes.url !== url) return null;

  return scenes.scenes;
}
