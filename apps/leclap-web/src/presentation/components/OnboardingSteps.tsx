import type { RefObject } from 'react';
import { Video as VideoIcon, Check, Download, ArrowRight, RotateCcw, X } from '@/presentation/components/icons';
import { SparklesIcon } from '@/presentation/components/icons/sparkles';
import { UploadIcon } from '@/presentation/components/icons/upload';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ProgressDisplay } from '@/presentation/components/ProgressDisplay';
import { ClappyCheer, ClappyReaction } from '@/presentation/components/clappy';
import { VideoPreview } from '@/presentation/components/VideoPreview';
import { StopButton } from '@/presentation/components/StopButton';
import { Button, Input } from '@/presentation/components/ui';
import { useBrowserSupport } from '@/hooks/useBrowserSupport';
import type { CompilationProgress, CompilationResult } from '@/application/usecases/coreCompilationService';
import type { CompileFailure } from '@/application/usecases/compile-failure';
import { CompileFailureText } from '@/presentation/components/compile-failure-text';
import type { ClipSource } from '@/presentation/components/onboarding.logic';
import { useCameraWarmUp } from '@/lib/camera-warm-up';

// Every step's heading carries the id the dialog is labelled by, and takes focus when its step opens
// (Onboarding.tsx): a script-focused heading draws no ring, like the error pages' headings.
const TITLE_FOCUS = 'outline-none';

const WELCOME_FEATURES = [
  { id: 'record', icon: VideoIcon },
  { id: 'template', icon: SparklesIcon },
  { id: 'download', icon: Download },
] as const;

interface WelcomeStepProps {
  /** The id of this step's heading, which names the dialog. */
  titleId: string;
  onStart: () => void;
  onDone: () => void;
}

export const WelcomeStep = ({ titleId, onStart, onDone }: WelcomeStepProps) => {
  const { t } = useTranslation('onboarding');
  const { checks, checking, ready } = useBrowserSupport();
  let startLabel = t('welcome.unsupported');

  if (checking) {
    startLabel = t('welcome.checking');
  }

  if (!checking && ready) {
    startLabel = t('welcome.start');
  }

  return (
    <div className="text-center">
      {/* Clappy waves hello: he pops in, throws a hand up, waves three times and leaves it up (reduced motion
          shows him already waving). Decorative, like every Clappy: the heading says hello. */}
      <ClappyReaction reaction="wave" size={96} className="mb-3" />
      {/* The brand word takes the page-aware gradient: the animated one fades through pastel yellow, which
          all but vanishes on the light panel. */}
      <h2
        id={titleId}
        tabIndex={-1}
        className={clsx(
          'fade-in mb-2 px-8 font-display text-2xl font-bold text-balance text-foreground sm:px-0 sm:text-3xl',
          TITLE_FOCUS
        )}
        style={{ animationDelay: '80ms' }}
      >
        {t('welcome.title')} <span className="brand-gradient-text">{t('brand', { ns: 'common' })}</span>
      </h2>
      <p className="fade-in text-gray-300 mb-6" style={{ animationDelay: '160ms' }}>
        {t('welcome.subtitle')}
      </p>

      <div className="space-y-3 text-left mb-6">
        {WELCOME_FEATURES.map(({ icon: Icon, id }, i) => (
          <div
            key={id}
            className="fade-in flex items-center gap-3 text-sm text-gray-200"
            style={{ animationDelay: `${240 + i * 100}ms` }}
          >
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300 shrink-0 ring-1 ring-brand-500/20">
              <Icon className="w-4 h-4" />
            </span>
            {t(`welcome.features.${id}`)}
          </div>
        ))}
      </div>

      {/* Discreet browser readiness check — gates "Create my intro" so newcomers on an
          unsupported browser don't hit a mid-flow failure when recording or compiling. */}
      {checks && (
        <ul
          className="fade-in mb-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5"
          style={{ animationDelay: '520ms' }}
        >
          {checks.map((check) => (
            <li
              key={check.id}
              className={clsx(
                'flex items-center gap-1.5 text-xs',
                check.ok ? 'text-gray-400' : 'font-medium text-[var(--color-error)]'
              )}
            >
              {check.ok ? <Check className="w-3.5 h-3.5 text-success-foreground" /> : <X className="w-3.5 h-3.5" />}
              {t(check.labelKey)}
            </li>
          ))}
        </ul>
      )}

      <div className="fade-in" style={{ animationDelay: '560ms' }}>
        <Button
          onClick={onStart}
          variant="primary"
          size="lg"
          disabled={checking || !ready}
          className="group w-full text-base glow-brand"
        >
          {startLabel}
          {ready && <ArrowRight className="transition-transform group-hover:translate-x-1" />}
        </Button>
        {!checking && !ready && <p className="mt-2 text-xs text-gray-500">{t('welcome.unsupportedHint')}</p>}
        <Button onClick={onDone} variant="ghost" size="sm" className="mt-3 w-full text-gray-400">
          {t('welcome.skip')}
        </Button>
      </div>
    </div>
  );
};

interface CreateStepProps {
  /** The id of this step's heading, which names the dialog. */
  titleId: string;
  name: string;
  onNameChange: (value: string) => void;
  sampleName: string;
  videoFile: File | null;
  /** Where the clip came from: its row says so, and replacing it goes back the same way. */
  clipSource: ClipSource;
  canCreate: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Create, which focus moves to once a clip is ready. */
  createRef: RefObject<HTMLButtonElement | null>;
  onOpenCamera: () => void;
  onFilePicked: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCreate: () => void;
}

export const CreateStep = ({
  titleId,
  name,
  onNameChange,
  sampleName,
  videoFile,
  clipSource,
  canCreate,
  fileInputRef,
  createRef,
  onOpenCamera,
  onFilePicked,
  onCreate,
}: CreateStepProps) => {
  const { t } = useTranslation('onboarding');
  const { hoverProps: recordHoverProps } = useIconHover();
  const { ref: uploadRef, hoverProps: uploadHoverProps } = useIconHover();
  // Warm the browser's capture devices while the clip choice is on screen (see camera-warm-up.ts).
  const warmUpProps = useCameraWarmUp(videoFile === null);

  return (
    <div>
      {/* `pr-12` reserves the close button's corner so a left-aligned title never runs under it. */}
      <h2
        id={titleId}
        tabIndex={-1}
        className={clsx('mb-1 pr-12 font-display text-xl font-bold text-foreground sm:text-2xl', TITLE_FOCUS)}
      >
        {t('create.title')}
      </h2>
      <p className="mb-5 text-sm text-gray-300 sm:mb-6">{t('create.subtitle')}</p>

      {/* Both inputs carry a label so their weight is legible: the name is optional — a sample stands
          in when it's blank — and the clip is what gates Create. */}
      <label
        className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400"
        htmlFor="ob-name"
      >
        {t('create.nameLabel')}
        <span className="font-medium normal-case tracking-normal text-gray-500">{t('create.nameOptional')}</span>
      </label>
      <Input
        id="ob-name"
        value={name}
        onChange={(e) => {
          onNameChange(e.target.value);
        }}
        placeholder={t('create.namePlaceholder', { name: sampleName })}
        className="mb-5 px-4 py-3 rounded-xl"
      />

      <p
        id="ob-clip-label"
        className="mb-2 flex items-baseline gap-1.5 text-xs font-semibold uppercase tracking-widest text-gray-400"
      >
        {t('create.clipLabel')}
        <span aria-hidden="true" className="text-brand-500">
          *
        </span>
      </p>
      {/* A clip that is ready says where it came from, and replacing it goes back the same way: an imported
          clip is not "recorded", and its replacement is another file, not the camera. */}
      {videoFile ? (
        <div className="pop-in flex items-center justify-between gap-3 mb-6 p-3 rounded-xl bg-success/10 border border-success/30">
          <span id="ob-clip-ready" className="flex items-center gap-2 text-sm text-success-foreground font-medium">
            <Check className="w-5 h-5 shrink-0" /> {t(clipSource === 'file' ? 'create.imported' : 'create.recorded')}
          </span>
          <Button
            onClick={clipSource === 'file' ? () => fileInputRef.current?.click() : onOpenCamera}
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 rounded-lg bg-foreground/5 text-xs text-gray-300 [&_svg]:size-3.5"
          >
            <RotateCcw /> {t(clipSource === 'file' ? 'create.changeClip' : 'create.reRecord')}
          </Button>
        </div>
      ) : (
        <div role="group" aria-labelledby="ob-clip-label" className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={onOpenCamera}
            {...warmUpProps}
            aria-label={t('create.recordAria')}
            className="tap group/tile flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-200 transition-[transform,background-color,box-shadow,border-color] duration-300 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-brand-500/50 hover:bg-brand-500/20 hover:shadow-[var(--shadow-glow)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30"
            {...recordHoverProps}
          >
            <VideoIcon className="w-6 h-6 transition-transform duration-300 ease-[var(--ease-spring)] group-hover/tile:scale-110" />
            <span className="text-sm font-semibold">{t('create.record')}</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('create.uploadAria')}
            className="tap group/tile flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-foreground/10 bg-foreground/5 text-gray-300 transition-[transform,background-color,box-shadow,border-color] duration-300 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30"
            {...uploadHoverProps}
          >
            <UploadIcon
              ref={uploadRef}
              className="w-6 h-6 transition-transform duration-300 ease-[var(--ease-spring)] group-hover/tile:scale-110"
            />
            <span className="text-sm font-semibold">{t('create.upload')}</span>
          </button>
        </div>
      )}
      {/* Visually hidden via `sr-only`, NOT `display:none`: WebKit/Safari refuses to open the OS
          file dialog for a `display:none` input clicked programmatically, so the picker "won't
          open". sr-only keeps it rendered (and out of the tab order via tabIndex) so .click() works
          across browsers. Outside the choice, so an imported clip's "Change clip" can open it too. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        aria-label={t('create.uploadInputAria')}
        tabIndex={-1}
        className="sr-only"
        onChange={onFilePicked}
      />

      <Button
        ref={createRef}
        onClick={onCreate}
        disabled={!canCreate}
        variant="primary"
        size="lg"
        className="w-full text-base"
        aria-describedby={canCreate ? 'ob-clip-ready' : 'ob-create-hint'}
      >
        <SparklesIcon size={16} /> {t('create.create')}
      </Button>
      {/* The disabled button says "not yet"; this says why. It's gone once a clip exists, and
          `role="status"` re-announces it if a take is discarded and the gate closes again. */}
      {!canCreate && (
        <p id="ob-create-hint" role="status" className="mt-2 text-center text-xs text-gray-400">
          {t('create.clipRequired')}
        </p>
      )}
    </div>
  );
};

interface CompilingStepProps {
  /** The id of this step's heading, which names the dialog. */
  titleId: string;
  progress: CompilationProgress;
  onStop: () => void;
}

export const CompilingStep = ({ titleId, progress, onStop }: CompilingStepProps) => {
  const { t } = useTranslation('onboarding');

  return (
    <div>
      <h2
        id={titleId}
        tabIndex={-1}
        className={clsx('mb-1 pr-12 font-display text-xl font-bold text-foreground sm:text-2xl', TITLE_FOCUS)}
      >
        {t('compiling.title')}
      </h2>
      <p className="mb-5 text-sm text-gray-300 sm:mb-6">{t('compiling.subtitle')}</p>
      <ProgressDisplay progress={progress} />
      <div className="mt-5 flex justify-center sm:mt-6">
        <StopButton onClick={onStop} label={t('compiling.stop')} />
      </div>
    </div>
  );
};

interface DoneStepProps {
  /** The id of this step's heading, which names the dialog. */
  titleId: string;
  result: CompilationResult;
  onStartCreating: () => void;
}

export const DoneStep = ({ titleId, result, onStartCreating }: DoneStepProps) => {
  const { t } = useTranslation('onboarding');

  return (
    <div className="text-center">
      {/* The first video is in the can: Clappy claps it, with the clack when the sound is on. */}
      <ClappyCheer size={80} className="mb-3" />
      {/* `px-10` keeps the centered title clear of the close button, and `text-balance` stops a
          long localized title ("Ta première vidéo est prête !") from dropping its last glyph alone
          onto a second line. */}
      <h2
        id={titleId}
        tabIndex={-1}
        className={clsx(
          'mb-3 px-10 font-display text-xl font-bold text-balance brand-gradient-text sm:mb-2 sm:text-2xl',
          TITLE_FOCUS
        )}
      >
        {t('done.title')}
      </h2>
      <div className="mb-5 sm:mb-6">
        <VideoPreview url={result.url} duration={result.duration} />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild variant="primary" className="flex-1">
          <a href={result.url} download="leclap-intro.mp4">
            <Download /> {t('actions.download', { ns: 'common' })}
          </a>
        </Button>
        <Button onClick={onStartCreating} variant="secondary" className="flex-1">
          {t('done.startCreating')} <ArrowRight />
        </Button>
      </div>
    </div>
  );
};

interface ErrorStepProps {
  /** The id of this step's heading, which names the dialog. */
  titleId: string;
  failure: CompileFailure;
  onRetry: () => void;
  /** Leave the intro for the studio, wherever the dialog was opened from. */
  onContinue: () => void;
}

export const ErrorStep = ({ titleId, failure, onRetry, onContinue }: ErrorStepProps) => {
  const { t } = useTranslation('onboarding');

  return (
    <div className="text-center">
      <div className="pop-in inline-flex p-3 bg-[var(--color-error)]/15 border border-[var(--color-error)]/30 rounded-2xl mb-4">
        <X className="w-6 h-6 text-[var(--color-error)]" />
      </div>
      <h2
        id={titleId}
        tabIndex={-1}
        className={clsx(
          'mb-2 px-10 font-display text-xl font-bold text-balance text-foreground sm:px-0 sm:text-2xl',
          TITLE_FOCUS
        )}
      >
        {t('error.title')}
      </h2>
      <p className="text-gray-300 mb-6 text-sm">
        <CompileFailureText failure={failure} />
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button onClick={onRetry} variant="primary" className="flex-1">
          {t('actions.tryAgain', { ns: 'common' })}
        </Button>
        <Button onClick={onContinue} variant="secondary" className="flex-1">
          {t('error.continueInStudio')}
        </Button>
      </div>
    </div>
  );
};
