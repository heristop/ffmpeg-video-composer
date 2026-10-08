import { useState, startTransition } from 'react';
import { useMediaDrop, type AcceptSpec, type Rejection } from '@/lib/upload';
import { MediaDropzone } from '@/presentation/components/upload/media-dropzone';
import { RejectionSlate } from '@/presentation/components/upload/rejection-slate';
import { X, File, Video as VideoIcon } from '@/presentation/components/icons';
import { UploadIcon } from '@/presentation/components/icons/upload';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CameraCapture } from '@/presentation/components/CameraCapture';
import { Button, Badge } from '@/presentation/components/ui';
import { useCameraWarmUp } from '@/lib/camera-warm-up';
import type { FramingGuideConfig } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { CaptureMode, TemplateOrientation } from '@leclap/creative-kit';

interface FileUploadProps {
  onFilesUploaded: (files: File[]) => void;
  uploadedFiles: File[];
  maxFiles?: number;
  maxSizeInMB?: number;
  // Recording-UX config forwarded to the in-browser camera (countdown + end warning).
  countdownSeconds?: number;
  maxDurationSeconds?: number;
  // Camera framing guide overlay — forwarded to CameraCapture.
  framingGuide?: FramingGuideConfig;
  // "What to film" hint forwarded to the camera.
  description?: string;
  // Template orientation — forwarded so the camera frames/records to the right aspect (portrait/square).
  orientation?: TemplateOrientation;
  // Default camera capture mode when modal opens.
  defaultCaptureMode?: CaptureMode;
  // Which capture mode tabs to show.
  allowedCaptureModes?: CaptureMode[];
  // A secondary intake under takes already captured: a one-line dropzone and a plain record button,
  // instead of the full-size drop target that leads an empty section.
  compact?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface UploadedFileItemProps {
  file: File;
  index: number;
  onRemove: (index: number) => void;
}

function UploadedFileItem({ file, index, onRemove }: UploadedFileItemProps) {
  const { t } = useTranslation('media');

  return (
    <div className="group flex items-center justify-between gap-3 p-3 bg-surface/40 rounded-xl border border-foreground/5 hover:bg-surface/60 hover:border-foreground/10 transition-colors backdrop-blur-sm">
      <div className="flex items-center space-x-3 min-w-0">
        <div className="p-2 bg-brand-500/15 rounded-lg border border-brand-500/25 shrink-0">
          <File className="w-4 h-4 text-brand-700 dark:text-brand-300" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate">{file.name}</p>
          <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          onRemove(index);
        }}
        className="size-11 text-gray-500 hover:text-[var(--color-error)] [&_svg]:size-4"
        aria-label={t('upload.removeAria', { name: file.name })}
      >
        <X />
      </Button>
    </div>
  );
}

// Wildcard group: the extensions validate and feed the "Supports MP4…" copy, but never reach the
// <input accept> attribute — that is what keeps Camera and Photo Library in the mobile picker.
const VIDEO_ACCEPT: AcceptSpec = [{ mime: 'video/*', extensions: ['.mp4', '.avi', '.mov', '.mkv', '.webm'] }];

function collectDropErrors(
  rejectedFiles: Rejection[],
  maxSizeInMB: number,
  maxFiles: number,
  t: TFunction<'media'>
): string[] {
  const errors: string[] = [];

  for (const file of rejectedFiles) {
    for (const error of file.errors) {
      if (error.code === 'file-too-large') {
        errors.push(t('upload.errorTooLarge', { name: file.file.name, size: maxSizeInMB }));
        continue;
      }

      if (error.code === 'file-invalid-type') {
        errors.push(t('upload.errorInvalidType', { name: file.file.name }));
        continue;
      }

      // RejectionCode is exhaustive, so the remaining case is too-many-files.
      errors.push(t('upload.errorTooMany', { max: maxFiles }));
    }
  }

  // One line per distinct complaint: the too-many-files message names no file, so a drop with three
  // surplus clips would otherwise print the same sentence three times.
  return [...new Set(errors)];
}

interface RecordWithCameraProps {
  compact: boolean;
  disabled: boolean;
  onOpen: () => void;
  t: TFunction<'media'>;
}

// The record-with-camera alternative to uploading, behind an "or" rule — except in the compact intake,
// where the two sit as a plain pair under the takes and the rule would only add height.
const RecordWithCamera = ({ compact, disabled, onOpen, t }: RecordWithCameraProps) => {
  // Warm the browser's capture devices while this entry is on screen, so the first open isn't slow.
  const warmUpProps = useCameraWarmUp(!disabled);

  return (
    <>
      {!compact && (
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          <span className="flex-1 h-px bg-foreground/10" />
          {t('upload.or')}
          <span className="flex-1 h-px bg-foreground/10" />
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={onOpen}
        disabled={disabled}
        {...warmUpProps}
        className={clsx(
          'group w-full',
          compact ? 'px-4 py-2.5' : 'px-4 py-3 sm:px-6 sm:py-4',
          !disabled &&
            'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-200 hover:bg-brand-500/20 hover:border-brand-500/50 hover:-translate-y-0.5'
        )}
      >
        <VideoIcon className="transition-transform duration-300 group-hover:scale-110" />
        {t('upload.recordWithCamera')}
      </Button>
    </>
  );
};

export const FileUpload = ({
  onFilesUploaded,
  uploadedFiles,
  maxFiles = 5,
  maxSizeInMB = 100,
  countdownSeconds,
  maxDurationSeconds,
  framingGuide,
  description,
  orientation,
  defaultCaptureMode,
  allowedCaptureModes,
  compact = false,
}: FileUploadProps) => {
  const { t } = useTranslation('media');
  const { ref: uploadRef, hoverProps } = useIconHover();
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  // Bumped per accepted drop so the dropzone can replay its landing flourish.
  const [dropCount, setDropCount] = useState(0);
  const [showCamera, setShowCamera] = useState(false);

  const atCapacity = uploadedFiles.length >= maxFiles;

  const handleCameraCapture = (file: File) => {
    setUploadErrors([]);
    startTransition(() => {
      onFilesUploaded([...uploadedFiles, file].slice(0, maxFiles));
    });
  };

  // Report rejections WITHOUT discarding what came through: an over-limit drop now yields the files
  // that fit plus a too-many-files rejection, and the old early return would have thrown them away.
  const onDrop = (acceptedFiles: File[], rejectedFiles: Rejection[]) => {
    setUploadErrors(collectDropErrors(rejectedFiles, maxSizeInMB, maxFiles, t));

    if (acceptedFiles.length === 0) return;

    setDropCount((count) => count + 1);

    startTransition(() => {
      const newFiles = [...uploadedFiles, ...acceptedFiles].slice(0, maxFiles);
      onFilesUploaded(newFiles);
    });
  };

  const removeFile = (indexToRemove: number) => {
    startTransition(() => {
      const newFiles = uploadedFiles.filter((_, index) => index !== indexToRemove);
      onFilesUploaded(newFiles);
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useMediaDrop({
    onDrop,
    accept: VIDEO_ACCEPT,
    remaining: maxFiles - uploadedFiles.length,
    maxSize: maxSizeInMB * 1024 * 1024,
    multiple: true,
    disabled: atCapacity,
  });

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3 sm:space-y-4'}>
      <MediaDropzone
        getRootProps={getRootProps}
        getInputProps={getInputProps}
        isDragActive={isDragActive}
        dropCount={dropCount}
        disabled={atCapacity}
        dense={compact}
        title={isDragActive ? t('upload.dropActive') : t('upload.dropIdle')}
        compactTitle={isDragActive ? t('upload.dropActive') : t('upload.pickFile')}
        // The "(N remaining)" count only means something when several files can be picked at once; a
        // take intake always accepts one more, and "1 remaining" read as a limit that isn't there.
        detail={maxFiles > 1 ? t('upload.browse', { count: maxFiles - uploadedFiles.length }) : undefined}
        hint={t('upload.formats', { size: maxSizeInMB })}
        icon={<UploadIcon ref={uploadRef} className={compact ? 'size-5' : 'size-5 sm:size-6'} />}
        hoverProps={hoverProps}
        inputAriaLabel={t('upload.uploadAria')}
        badge={
          uploadedFiles.length > 0 ? (
            <Badge variant="success" className="tracking-normal normal-case">
              {t('upload.filesBadge', { count: uploadedFiles.length, max: maxFiles })}
            </Badge>
          ) : undefined
        }
      />

      <RecordWithCamera
        compact={compact}
        disabled={atCapacity}
        onOpen={() => {
          setShowCamera(true);
        }}
        t={t}
      />

      <RejectionSlate title={t('upload.errorsTitle')} messages={uploadErrors} />

      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => {
            setShowCamera(false);
          }}
          countdownSeconds={countdownSeconds}
          maxDurationSeconds={maxDurationSeconds}
          framingGuide={framingGuide}
          description={description}
          orientation={orientation}
          defaultCaptureMode={defaultCaptureMode}
          allowedCaptureModes={allowedCaptureModes}
        />
      )}

      {uploadedFiles.length > 0 && (
        <div className="space-y-2 fade-in">
          <h4 className="text-sm font-medium text-gray-300">{t('upload.uploadedFiles')}</h4>
          <div className="space-y-2">
            {uploadedFiles.map((file, index) => (
              <UploadedFileItem key={`${file.name}-${index}`} file={file} index={index} onRemove={removeFile} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
