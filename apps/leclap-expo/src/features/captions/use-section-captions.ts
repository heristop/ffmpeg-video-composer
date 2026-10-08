import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import * as LeclapSpeech from '@/modules/leclap-speech';
import type { useSaveProject } from '@/src/hooks/useProjects';
import type { Project, Section } from '@/src/types';
import { isCaptionsStale, readSectionCaptions, withSectionCaptions, type SectionCaptions } from './caption-store';
import { transcribeRequests } from './pin-transcript';
import { captionLanguage, transcribeSection, TranscriptionError } from './transcribe-section';
import { transcribeUnlessCancelled, transcriptionRuns } from './transcription-runs';
import type { SectionTimeEdits, TranscriptWord } from './transcript-mapping';

// The preview screen's captions state for one recorded section: the pinned words stored in the project,
// on-device transcription when the user turns captions on (or retakes a captioned clip), and word fixes.
// Every change is saved to the project straight away, so compile pins exactly what the user saw.

export type CaptionsStatus = 'idle' | 'working' | 'error';

interface Args {
  project: Project | null | undefined;
  sectionName: string | undefined;
  clipPath: string | undefined;
  saveProjectMutation: ReturnType<typeof useSaveProject>;
}

function sectionEdits(project: Project, sectionName: string): SectionTimeEdits | undefined {
  const section = project.templateContent.sections?.find((candidate: Section) => candidate.name === sectionName);

  return section?.options;
}

// The language a template request listening to this step asks for (subtitles.transcribe.language).
function requestedLanguage(project: Project, sectionName: string): string | undefined {
  const requests = transcribeRequests(project.templateContent as Parameters<typeof transcribeRequests>[0]);

  return requests.find((request) => request.source === sectionName && request.language)?.language;
}

function templateFps(project: Project): number | undefined {
  return (project.templateContent.global as { fps?: number } | undefined)?.fps;
}

function describeFailure(error: unknown): string {
  if (error instanceof TranscriptionError) return error.code;

  return error instanceof Error ? error.message : String(error);
}

export function useSectionCaptions({ project, sectionName, clipPath, saveProjectMutation }: Args) {
  const [status, setStatus] = useState<CaptionsStatus>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  // undefined until the user changes something: the stored captions are read from the project.
  const [edited, setEdited] = useState<SectionCaptions | null | undefined>();
  const checkedStale = useRef(false);
  const [runs] = useState(transcriptionRuns);
  const stored = project && sectionName ? readSectionCaptions(project.formData, sectionName) : null;
  const captions = edited === undefined ? stored : edited;

  const save = async (next: SectionCaptions | null) => {
    if (!project || !sectionName) return;

    setEdited(next);
    await saveProjectMutation.mutateAsync({
      ...project,
      formData: withSectionCaptions(project.formData, sectionName, next),
      updatedAt: new Date().toISOString(),
    });
  };

  const transcribe = async () => {
    if (!project || !sectionName || !clipPath) return;

    setStatus('working');
    setFailure(null);

    try {
      const saved = await transcribeUnlessCancelled(
        runs,
        () =>
          transcribeSection({
            speech: LeclapSpeech,
            source: sectionName,
            clipPath,
            language: captionLanguage(requestedLanguage(project, sectionName), getLocales().at(0)?.languageTag),
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            options: sectionEdits(project, sectionName),
            mapping: { fps: templateFps(project), sourceLength: project.recordedVideos[sectionName]?.duration },
          }),
        save
      );

      if (saved) setStatus('idle');
    } catch (error) {
      setFailure(describeFailure(error));
      setStatus('error');
    }
  };

  // A captioned clip that was retaken since its transcription is transcribed again, once.
  useEffect(() => {
    if (checkedStale.current || !stored || !clipPath) return;

    checkedStale.current = true;

    if (isCaptionsStale(stored, clipPath)) transcribe().catch(console.error);
  });

  const setEnabled = (enabled: boolean) => {
    if (enabled) {
      transcribe().catch(console.error);

      return;
    }

    // A transcription still running must not bring the captions back when it finishes.
    runs.cancel();
    setStatus('idle');
    setFailure(null);
    save(null).catch(console.error);
  };

  const updateWords = (words: TranscriptWord[]) => {
    if (!captions) return;

    save({ ...captions, words }).catch(console.error);
  };

  return {
    captions,
    status,
    error: failure,
    enabled: captions !== null || status === 'working',
    setEnabled,
    updateWords,
    retry: transcribe,
  };
}
