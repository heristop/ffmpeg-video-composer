import { expect, it } from 'vitest';
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import { buildDescriptor, toEditorState } from '../src/editor/templateEditorModel';

const record = (from: string) => ({ from, engine: 'whisper.cpp', language: 'en', digest: 'sha256:clip' });

it('follows the builder section names when an import renames the pinned sections', () => {
  const descriptor = {
    meta: { resolved: { transcripts: { talk: record('talk'), quote: record('talk'), gone: record('gone') } } },
    sections: [
      { name: 'intro', type: 'color_background', options: { duration: 1 } },
      { name: 'talk', type: 'project_video', options: { duration: 4 } },
      { name: 'quote', type: 'video', options: { duration: 2, videoUrl: 'https://cdn.test/quote.mp4' } },
    ],
  } as unknown as TemplateDescriptor;
  const state = toEditorState({ id: 'talk', name: 'Talk', description: '', orientation: 'portrait', descriptor });
  const built = buildDescriptor(state);

  expect(built.sections?.map((section) => section.name)).toEqual(['color_1', 'video_1', 'clip_1']);
  expect(built.meta?.resolved?.transcripts).toEqual({
    video_1: record('video_1'),
    clip_1: record('video_1'),
    gone: record('gone'),
  });
});
