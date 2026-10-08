import { describe, expect, it, vi } from 'vitest';
import { transcribeSections, type TranscribeSectionsDeps } from '@/director/transcribe-sections';
import type { Section, TemplateDescriptor } from '@/core/types';
import { mapTranscriptWords } from '@/core/captions/transcript-time';
import { editFingerprint } from '@/core/captions/transcript-pin';
import { sectionFootagePlan } from '@/editor/utils/footage-section';

function template(subtitles: Record<string, unknown>, meta?: unknown): TemplateDescriptor {
  return {
    ...(meta === undefined ? {} : { meta }),
    sections: [
      { name: 'talk', type: 'project_video', options: { clip: { from: 1 } }, subtitles },
      { name: 'card', type: 'color_background', options: { duration: 1 } },
    ],
  } as unknown as TemplateDescriptor;
}

function deps(overrides: Partial<TranscribeSectionsDeps> = {}): TranscribeSectionsDeps {
  return {
    service: {
      transcribe: vi.fn(async () => ({
        engine: 'whisper.cpp',
        model: 'base',
        language: 'en',
        words: [{ text: 'Hello', start: 1.2, end: 1.6, confidence: 0.9 }],
      })),
      digest: vi.fn(async () => 'sha256:new'),
    },
    sourceOf: vi.fn(async () => '/clips/talk.mp4'),
    fps: 30,
    buildInfos: { sourceDurations: { talk: 5 } },
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

describe('transcribeSections', () => {
  it('pins the words onto the descriptor and the sections the build renders', async () => {
    const descriptor = template({ transcribe: {}, style: 'loud' });
    const sections = descriptor.sections as Section[];
    const host = deps();
    const pinned = await transcribeSections(descriptor, sections, host);

    expect(sections[0].subtitles).toEqual({
      style: 'loud',
      words: [{ text: 'Hello', start: 0.2, end: 0.6, confidence: 0.9 }],
    });
    expect((pinned.meta as { resolved: unknown }).resolved).toEqual({
      transcripts: { talk: expect.objectContaining({ engine: 'whisper.cpp', digest: 'sha256:new' }) },
    });
    expect(host.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/\[Transcribe\] talk: pinned 1 word .*whisper\.cpp base, en/)
    );
  });

  it("hands the render's abort signal to the transcriber, so a cancelled render stops whisper", async () => {
    const descriptor = template({ transcribe: {} });
    const controller = new AbortController();
    const host = deps({ signal: controller.signal });

    await transcribeSections(descriptor, descriptor.sections as Section[], host);

    expect(host.service?.transcribe).toHaveBeenCalledWith(
      '/clips/talk.mp4',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('stops the build with transcribe_unavailable without a transcriber', async () => {
    const descriptor = template({ transcribe: {} });

    await expect(
      transcribeSections(descriptor, descriptor.sections as Section[], deps({ service: null }))
    ).rejects.toThrow(/transcribe_unavailable/);
  });

  it('warns when a pinned transcript came from another clip', async () => {
    const descriptor = template(
      { words: [{ text: 'Hi', start: 0, end: 0.2 }] },
      { resolved: { transcripts: { talk: { from: 'talk', engine: 'whisper.cpp', digest: 'sha256:old' } } } }
    );
    const host = deps();

    expect(await transcribeSections(descriptor, descriptor.sections as Section[], host)).toBe(descriptor);
    expect(host.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/transcript_stale/));
    expect(host.service?.transcribe).not.toHaveBeenCalled();
  });

  it('maps a reused clip through the plan the lowering builds (useVideoSection length)', async () => {
    const spoken = [{ text: 'Hello', start: 2, end: 2.2, confidence: 0.9 }];
    const reused = {
      name: 'b',
      type: 'video',
      options: { useVideoSection: 'talk', speedRamp: 'hero', duration: 4 },
      subtitles: { transcribe: {} },
    } as unknown as Section;
    const descriptor = {
      sections: [{ name: 'talk', type: 'project_video', options: {} }, reused],
    } as unknown as TemplateDescriptor;
    const buildInfos = { sourceDurations: { talk: 10 } };
    const host = deps({
      buildInfos,
      service: {
        transcribe: vi.fn(async () => ({ engine: 'whisper.cpp', words: spoken })),
        digest: vi.fn(async () => 'sha256:new'),
      },
    });
    const plan = sectionFootagePlan(reused, buildInfos as never, 30);

    await transcribeSections(descriptor, descriptor.sections as Section[], host);

    expect(reused.subtitles?.words).toEqual(
      mapTranscriptWords(spoken, { pieces: plan?.pieces ?? null, freezes: plan?.freezes ?? [], fps: 30, duration: 4 })
    );
  });

  it('warns when the section was re-cut since its words were pinned, even without a transcriber', async () => {
    const descriptor = template(
      { words: [{ text: 'Hi', start: 0, end: 0.2 }] },
      {
        resolved: {
          transcripts: { talk: { from: 'talk', engine: 'ios-speech', edit: editFingerprint({ clip: { from: 0 } }) } },
        },
      }
    );
    const host = deps({ service: null });

    await transcribeSections(descriptor, descriptor.sections as Section[], host);

    expect(host.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/transcript_edit_changed/));
  });

  it('does nothing for a descriptor without transcripts', async () => {
    const descriptor = template({ words: [] });
    const host = deps();

    expect(await transcribeSections(descriptor, descriptor.sections as Section[], host)).toBe(descriptor);
    expect(host.sourceOf).not.toHaveBeenCalled();
  });
});
