import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Copy, Check, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '@/presentation/components/ui/button';
import { mediaPath, type ShowcaseSample } from './catalog';

type SourceState = { text: string; direction?: string };

export function SampleSource({ sample }: { sample: ShowcaseSample }) {
  const { t } = useTranslation('showcase');
  const [source, setSource] = useState<SourceState>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    const controller = new AbortController();
    fetch(mediaPath(sample, 'json'), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Source unavailable');
        const text = await response.text();
        const descriptor = JSON.parse(text) as { meta?: { creativeDirection?: string }; sections?: unknown[] };

        if (!Array.isArray(descriptor.sections)) throw new Error('Invalid source');

        if (!controller.signal.aborted) {
          setSource({ text, direction: descriptor.meta?.creativeDirection });
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => {
      controller.abort();
    };
  }, [sample, attempt]);

  const copy = () => {
    if (!source) return;

    try {
      navigator.clipboard.writeText(source.text).then(
        () => {
          setCopyState('copied');
        },
        () => {
          setCopyState('failed');
        }
      );
    } catch {
      setCopyState('failed');
    }
  };
  const copyMessage = { idle: '', copied: t('copied'), failed: t('copyError') }[copyState];

  return (
    <div className="showcase-source space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {source && (
          <Button asChild variant="outline" className="min-h-11 rounded-full">
            <a href={mediaPath(sample, 'json')} download={`${sample.id}.json`}>
              <Download size={17} aria-hidden="true" />
              {t('downloadJson')}
            </a>
          </Button>
        )}
        {!source && failed && (
          <Button
            variant="outline"
            className="min-h-11 rounded-full"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            <RefreshCw size={17} aria-hidden="true" />
            {t('retrySource')}
          </Button>
        )}
        {!source && !failed && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('loadingSource')}
          </p>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t('sourceError')}
        </p>
      )}
      {source && (
        <details className="group border-t border-divider pt-4">
          <summary className="flex min-h-11 items-center justify-between gap-3 rounded-md text-base text-foreground focus-visible:outline-2 focus-visible:outline-brand-500">
            {t('directionAndSource')}
            <ChevronDown
              size={18}
              aria-hidden="true"
              className="transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="space-y-5 pt-4">
            {source.direction && (
              <div>
                <h3 className="mb-2 text-base font-semibold">{t('creativeDirection')}</h3>
                <p className="text-base leading-relaxed text-muted-foreground">{source.direction}</p>
              </div>
            )}
            <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">{sample.source}</p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 rounded-full"
              onClick={() => {
                copy();
              }}
            >
              {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copyState === 'copied' ? t('copied') : t('copyJson')}
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {copyMessage}
            </p>
            <pre className="max-h-80 overflow-auto rounded-lg bg-surface p-4 text-xs leading-relaxed">
              <code>{source.text}</code>
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
