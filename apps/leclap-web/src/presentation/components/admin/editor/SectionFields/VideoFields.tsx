// Field block for a video scene. A source toggle picks between the camera flow (project_video:
// the end-user films the scene) and a fixed clip (type 'video' + options.videoUrl: a brand bumper
// or stock video the author provides). Essentials (always visible): duration + mute, the optional
// countdown, and the WYSIWYG text-overlay editor — the title is the main creative act, so it stays
// one click away. The finishing controls (Effects, Section audio, Camera guide) live in collapsed
// disclosures that only appear in Advanced mode; recorder-only controls hide in clip mode.
import { useState } from 'react';
import { Camera, SwitchCamera } from '@/presentation/components/icons';
import { SparklesIcon } from '@/presentation/components/icons/sparkles';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/presentation/components/ui';
import { defaultCountdownFor, type EditorSection, type EditorState } from '../../templateEditorModel';
import { VariableTextField } from '../VariableTextField';
import { FramingGuidePicker } from '../FramingGuidePicker';
import { MotionPanel } from '../MotionPanel';
import { SectionDisclosure } from '../SectionDisclosure';
import { useIsAdvanced } from '../useBuilderMode';
import { effectsSummary, framingSummary, captureSummary } from '../sectionHints';
import { ClipSourceControl, type ClipSource } from './clip-source-control';
import { NumberField } from './NumberField';
import { SpeedField } from './SpeedField';
import { FitField } from './fit-field';
import { SectionSoundDisclosures } from './section-sound-disclosures';
import { VideoTextFields } from './video-text-fields';
import { CaptureModeField } from './CaptureModeField';
import { ChromaKeyField } from './ChromaKeyField';
import { VisualEffects } from './VisualEffects';

type VideoSection = Extract<EditorSection, { kind: 'video' }>;

interface VideoFieldsProps {
  section: VideoSection;
  orientation: EditorState['orientation'];
  variables: string[];
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

// Camera-only essentials: the filming prompt and the pre-record countdown.
const RecorderPromptFields = ({
  section,
  variables,
  onChange,
  inputCls,
}: {
  section: VideoSection;
  variables: string[];
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}) => {
  const { t } = useTranslation('admin');

  // Enabling the countdown seeds it from the clip duration (and marks it un-customized so
  // it keeps tracking); disabling just clears the flag.
  const toggleCountdown = (on: boolean) => {
    if (!on) {
      onChange({ countdown: false });

      return;
    }

    onChange({ countdown: true, countdownSeconds: defaultCountdownFor(section.duration), countdownCustomized: false });
  };

  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-gray-400">
          {t('video.whatToFilm')}
        </span>
        <VariableTextField
          multiline
          rows={2}
          value={section.description ?? ''}
          onChange={(text) => {
            onChange({ description: text.trim() === '' ? undefined : text });
          }}
          variables={variables.map((name) => ({ name, scope: 'global' as const }))}
          placeholder={t('video.whatToFilmPlaceholder')}
          className={`${inputCls} resize-none`}
          aria-label={t('video.whatToFilm')}
        />
        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t('video.whatToFilmHint')}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <Checkbox
            checked={section.countdown}
            onCheckedChange={(c) => {
              toggleCountdown(c === true);
            }}
          />{' '}
          {t('video.countdown')}
        </label>
        {section.countdown && (
          <NumberField
            label={t('video.countdownSeconds', { count: section.countdownSeconds })}
            value={section.countdownSeconds}
            onChange={(countdownSeconds) => {
              onChange({ countdownSeconds, countdownCustomized: true });
            }}
            inputCls={inputCls}
          />
        )}
      </div>
    </>
  );
};

// Camera-only advanced disclosures: recorder capture modes and the framing guide.
const CameraDisclosures = ({
  section,
  orientation,
  onChange,
}: {
  section: VideoSection;
  orientation: EditorState['orientation'];
  onChange: (p: Partial<EditorSection>) => void;
}) => {
  const { t } = useTranslation('admin');

  return (
    <>
      <SectionDisclosure
        label={t('disclosure.capture')}
        icon={<SwitchCamera className="size-4 shrink-0 text-brand-500" aria-hidden />}
        summary={captureSummary(t, section.captureMode, section.allowedCaptureModes)}
      >
        <CaptureModeField
          selection={{ captureMode: section.captureMode, allowedCaptureModes: section.allowedCaptureModes }}
          onChange={({ captureMode, allowedCaptureModes }) => {
            onChange({ captureMode, allowedCaptureModes });
          }}
        />
      </SectionDisclosure>
      <SectionDisclosure
        label={t('disclosure.cameraGuide')}
        icon={<Camera className="size-4 shrink-0 text-brand-500" aria-hidden />}
        summary={framingSummary(t, section.framingGuide)}
      >
        <FramingGuidePicker
          guide={section.framingGuide}
          orientation={orientation}
          onChange={(framingGuide) => {
            onChange({ framingGuide });
          }}
        />
      </SectionDisclosure>
    </>
  );
};

export const VideoFields = ({ section, orientation, variables, onChange, inputCls }: VideoFieldsProps) => {
  const { t } = useTranslation('admin');
  const advanced = useIsAdvanced();
  // Seeded from the stored choice; kept local so the author can switch to Clip and then pick the
  // video (the section only becomes a real clip once a source is chosen — until then it builds as
  // a camera scene).
  const [source, setSource] = useState<ClipSource>(section.videoUrl ? 'clip' : 'camera');
  const isClip = source === 'clip';

  const setClipSource = (next: ClipSource) => {
    setSource(next);

    if (next === 'camera') onChange({ videoUrl: undefined });
  };

  // Changing the clip duration re-syncs an un-customized countdown so a short take
  // never waits behind a long lead-in (and vice-versa). A hand-edited countdown is left alone.
  const setDuration = (duration: number) => {
    const syncCountdown = section.countdown && !section.countdownCustomized;

    onChange({ duration, ...(syncCountdown ? { countdownSeconds: defaultCountdownFor(duration) } : {}) });
  };

  return (
    <div className="space-y-3">
      <ClipSourceControl section={section} source={source} onSelectSource={setClipSource} onChange={onChange} />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label={t('video.duration', { count: section.duration })}
          value={section.duration}
          onChange={setDuration}
          inputCls={inputCls}
        />
        {/* sm:mt-6 aligns the checkbox with the input row beside it; no offset when stacked at 320px. */}
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700 sm:mt-6 dark:text-gray-200">
          <Checkbox
            checked={section.mute}
            onCheckedChange={(c) => {
              onChange({ mute: c === true });
            }}
          />{' '}
          {t('video.muteAudio')}
        </label>
      </div>
      <SpeedField
        speed={section.speed}
        onChange={(speed) => {
          onChange({ speed });
        }}
      />
      <FitField
        fit={section.fit}
        onChange={(fit) => {
          onChange({ fit });
        }}
      />
      {!isClip && (
        <RecorderPromptFields section={section} variables={variables} onChange={onChange} inputCls={inputCls} />
      )}
      <VideoTextFields section={section} variables={variables} onChange={onChange} inputCls={inputCls} />
      {advanced && (
        <div className="space-y-2">
          <SectionDisclosure
            label={t('disclosure.effects')}
            icon={<SparklesIcon size={16} className="shrink-0 text-brand-500" aria-hidden />}
            summary={effectsSummary(t, section.look, section.motion, section.letterbox)}
          >
            <MotionPanel
              motion={section.motion}
              onChange={(motion) => {
                onChange({ motion });
              }}
            />
            <VisualEffects
              look={section.look}
              grade={section.grade}
              letterbox={section.letterbox}
              onLook={(look) => {
                onChange({ look });
              }}
              onGrade={(grade) => {
                onChange({ grade });
              }}
              onLetterbox={(letterbox) => {
                onChange({ letterbox });
              }}
            />
          </SectionDisclosure>
          <SectionDisclosure
            label={t('disclosure.chromaKey')}
            icon={<SparklesIcon size={16} className="shrink-0 text-brand-500" aria-hidden />}
            summary={section.chromaKey ? t('chromaKey.summaryOn') : t('chromaKey.summaryOff')}
          >
            <ChromaKeyField
              chromaKey={section.chromaKey}
              onChange={(chromaKey) => {
                onChange({ chromaKey });
              }}
            />
          </SectionDisclosure>
          <SectionSoundDisclosures section={section} onChange={onChange} inputCls={inputCls} />
          {!isClip && <CameraDisclosures section={section} orientation={orientation} onChange={onChange} />}
        </div>
      )}
    </div>
  );
};
