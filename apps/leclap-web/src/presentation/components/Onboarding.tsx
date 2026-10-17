import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X } from '@/presentation/components/icons';
import { useTranslation } from 'react-i18next';
import { CameraCapture } from '@/presentation/components/CameraCapture';
import { WelcomeStep, CreateStep, CompilingStep, DoneStep, ErrorStep } from '@/presentation/components/OnboardingSteps';
import { useOnboardingCompile, type OnboardingStep } from '@/hooks/useOnboardingCompile';
import { useSampleTemplate } from '@/hooks/useSampleTemplate';
import { setHeroVideo } from '@/services/heroVideoStore';
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll';
import type { TemplateOrientation } from '@leclap/creative-kit';
import {
  closesOnBackdrop,
  closesOnEscape,
  focusAfterClipPicked,
  sampleFormatFor,
  type ClipSource,
} from '@/presentation/components/onboarding.logic';

// The onboarding makes a first video from the built-in "Present Yourself" template so newcomers see
// the whole flow (record → compile → download) in one guided pass. One template, two formats: portrait
// on a phone held upright, landscape on a desktop (sampleFormatFor). It records one clip; the name typed
// at the record step lands in the template's first form field.
const SAMPLE_TEMPLATE_ID = 'present-yourself';

const pickSampleFormat = (): TemplateOrientation =>
  sampleFormatFor({ width: window.innerWidth, height: window.innerHeight });

// A friendly sample first name shown as the field's *placeholder* (not a prefilled value, so the user
// never has to clear it). If they skip typing, this same name is used so the title card is never empty.
const SAMPLE_FIRST_NAMES = ['Alex', 'Sam', 'Mia', 'Noah', 'Léa', 'Liam', 'Zoé', 'Ava', 'Theo', 'Nina'];

const randomFirstName = (): string => SAMPLE_FIRST_NAMES[Math.floor(Math.random() * SAMPLE_FIRST_NAMES.length)];

interface OnboardingProps {
  onDone: () => void;
}

/**
 * The dialog's modal behaviour: the body scroll lock; the page behind made inert (out of the tab order and
 * hidden from assistive tech) so Tab stays in the dialog, while the camera, portaled beside it, stays
 * reachable; focus on each step's heading as it opens, so a screen reader hears where the flow went and the
 * next Tab lands on the step's first control (the button that moved the flow on left with its step); focus
 * brought back into the dialog once the camera or the file picker hands it back (onboarding.logic.ts);
 * Escape; and, on close, focus back on whatever opened it: the landing's "See how it works", or nothing on
 * the studio's first visit, which opens it by itself.
 */
const useOnboardingDialog = ({
  step,
  showCamera,
  hasClip,
  onDone,
}: {
  step: OnboardingStep;
  showCamera: boolean;
  hasClip: boolean;
  onDone: () => void;
}) => {
  // Whichever step is showing names the dialog through its heading.
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  // The control that opened the camera: focus goes back to it when the camera closes without a clip.
  const cameraTriggerRef = useRef<HTMLElement | null>(null);

  useLockBodyScroll();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById('root');

    app?.setAttribute('inert', '');

    return () => {
      app?.removeAttribute('inert');

      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    document.getElementById(titleId)?.focus();
  }, [step, titleId]);

  useEffect(() => {
    if (showCamera) return;

    const active = document.activeElement;
    const target = focusAfterClipPicked({
      focusInDialog: active !== null && active !== document.body && panelRef.current?.contains(active) === true,
      hasClip,
    });

    if (target === 'create') createRef.current?.focus();

    if (target === 'trigger') cameraTriggerRef.current?.focus();
  }, [showCamera, hasClip]);

  // Escape closes the dialog like its close button, except over the camera, a screen of its own, and during
  // the render, which only Stop cancels.
  useEffect(() => {
    if (showCamera || !closesOnEscape(step)) return () => {};

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showCamera, step, onDone]);

  const rememberCameraTrigger = () => {
    cameraTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  return { titleId, panelRef, createRef, rememberCameraTrigger };
};

export const Onboarding = ({ onDone }: OnboardingProps) => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  // Picked once when the modal opens: shown as the field's placeholder and used as the title fallback.
  const [placeholderName] = useState(randomFirstName);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [clipSource, setClipSource] = useState<ClipSource>('camera');
  const [showCamera, setShowCamera] = useState(false);
  // Chosen once when the modal opens so a mid-flow rotation can't swap the format underfoot.
  const [sampleFormat] = useState(pickSampleFormat);
  const { template, recordingConfig } = useSampleTemplate(SAMPLE_TEMPLATE_ID, sampleFormat);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The compile flow (step state + start/stop around the in-browser compile) lives in its own hook;
  // `stop` cancels an in-flight compile and closes the dialog.
  const { step, setStep, progress, result, failure, start, stop } = useOnboardingCompile({
    sampleTemplateId: SAMPLE_TEMPLATE_ID,
    sampleFormat,
    template,
    onClose: onDone,
  });
  const { titleId, panelRef, createRef, rememberCameraTrigger } = useOnboardingDialog({
    step,
    showCamera,
    hasClip: videoFile !== null,
    onDone,
  });

  // Personalize the Home hero: once the in-browser compile succeeds, show that video as the hero clip
  // for this session (fires an event so a Home behind the modal swaps immediately; not persisted).
  useEffect(() => {
    if (result) {
      setHeroVideo(result.blob);
    }
  }, [result]);

  // Typed name, or the placeholder sample if left blank — so a recorded clip is always enough to create.
  const effectiveName = name.trim() || placeholderName;
  const canCreate = videoFile !== null;

  // Close when the click lands on the backdrop itself, not on the modal panel or its children, and only
  // while nothing is at stake (onboarding.logic.ts).
  const onBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closesOnBackdrop(step) && event.target === event.currentTarget) onDone();
  };

  // "Start creating" from the done step: close the dialog and drop the user into the studio.
  const startCreating = () => {
    onDone();
    Promise.resolve(navigate('/studio')).catch(() => {});
  };

  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setVideoFile(file);
    setClipSource('file');
  };

  const renderStep = () => {
    if (step === 'welcome') {
      return (
        <WelcomeStep
          titleId={titleId}
          onStart={() => {
            setStep('create');
          }}
          onDone={onDone}
        />
      );
    }

    if (step === 'create') {
      return (
        <CreateStep
          titleId={titleId}
          name={name}
          onNameChange={setName}
          sampleName={placeholderName}
          videoFile={videoFile}
          clipSource={clipSource}
          canCreate={canCreate}
          fileInputRef={fileInputRef}
          createRef={createRef}
          onOpenCamera={() => {
            rememberCameraTrigger();
            setShowCamera(true);
          }}
          onFilePicked={onFilePicked}
          onCreate={() => {
            Promise.resolve(start(effectiveName, videoFile)).catch(() => {});
          }}
        />
      );
    }

    if (step === 'compiling') return <CompilingStep titleId={titleId} progress={progress} onStop={stop} />;

    if (step === 'done' && result) {
      return <DoneStep titleId={titleId} result={result} onStartCreating={startCreating} />;
    }

    if (step === 'error' && failure) {
      return (
        <ErrorStep
          titleId={titleId}
          failure={failure}
          onRetry={() => {
            setStep('create');
          }}
          onContinue={startCreating}
        />
      );
    }

    return null;
  };

  return createPortal(
    // Inert under the camera, which takes the whole screen: Tab must not wander into the dialog behind it.
    <div inert={showCamera} className="fixed inset-0 z-[55] overflow-y-auto bg-black/40 dark:bg-black/80">
      {/* Ambient brand aurora — drifting multi-color blobs for a first-run "wow" backdrop.
          Hidden on mobile, where the soft glow reads as an unwanted blur on the small modal. */}
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] bg-brand-500/20 rounded-full blur-[120px] animate-float" />
        <div
          className="absolute top-1/4 -left-24 w-[26rem] h-[26rem] bg-secondary-500/15 rounded-full blur-[110px] animate-float"
          style={{ animationDelay: '-4s' }}
        />
        <div
          className="absolute -bottom-24 right-0 w-[28rem] h-[28rem] bg-accent-400/10 rounded-full blur-[120px] animate-float"
          style={{ animationDelay: '-8s' }}
        />
      </div>

      <div
        role="presentation"
        onClick={onBackdropClick}
        className="relative min-h-full flex items-center justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4 sm:pt-[max(1.5rem,env(safe-area-inset-top))] safe-b"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative w-full max-w-lg bg-surface border border-foreground/10 rounded-2xl p-5 sm:p-8 shadow-2xl rise-in"
        >
          <button
            onClick={step === 'compiling' ? stop : onDone}
            className="tap absolute top-3 right-3 sm:top-4 sm:right-4 z-10 grid place-items-center w-10 h-10 rounded-full text-gray-400 hover:text-foreground hover:bg-foreground/10 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 before:absolute before:-inset-2.5 before:content-['']"
            aria-label={step === 'compiling' ? t('compiling.stopAria') : t('skipAria')}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Keyed wrapper so each step re-triggers the entrance animation,
              keeping transitions between steps smooth and on-brand. */}
          <div key={step} className="fade-in">
            {renderStep()}
          </div>
        </div>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={(file) => {
            setVideoFile(file);
            setClipSource('camera');
          }}
          onClose={() => {
            setShowCamera(false);
          }}
          countdownSeconds={recordingConfig.countdownSeconds}
          maxDurationSeconds={recordingConfig.maxDurationSeconds}
          framingGuide={recordingConfig.framingGuide}
          description={recordingConfig.description}
          orientation={recordingConfig.orientation}
        />
      )}
    </div>,
    document.body
  );
};
