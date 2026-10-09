import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import { SampleSource } from './SampleSource';
import { isNative, sampleShape, type ShowcaseSample } from './catalog';

// What a sample is and what to do with it, under its player: its kind, how it renders and its shape, its
// JSON source, and a way into the studio for the app templates.
export function SampleFacts({ sample }: { sample: ShowcaseSample }) {
  const { t } = useTranslation('showcase');

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{t(`categories.${sample.category}`)}</span>
        <span aria-hidden="true">/</span>
        <span>{isNative(sample) ? t('native') : 'Remotion'}</span>
        <span aria-hidden="true">/</span>
        <span>{t(`shapes.${sampleShape(sample)}`)}</span>
      </div>
      <SampleSource key={sample.id} sample={sample} />
      {sample.source.startsWith('packages/leclap-creative-kit/') && (
        <Link
          to={`/studio/new?template=${sample.id}`}
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-base text-brand-700 underline-offset-4 hover:underline dark:text-brand-300 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          {t('useTemplate')}
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      )}
    </>
  );
}
