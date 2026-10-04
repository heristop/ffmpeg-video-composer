import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Play, Search, Plus, X, SearchX } from 'lucide-react';
import { Seo } from '@/presentation/components/Seo';
import { Button } from '@/presentation/components/ui/button';
import { ShowcasePlayer } from '@/presentation/components/showcase/ShowcasePlayer';
import { SampleSource } from '@/presentation/components/showcase/SampleSource';
import {
  CATEGORIES,
  SHOWCASE_SAMPLES,
  filterSamples,
  selectedSample,
  validCategory,
  mediaPath,
  type ShowcaseSample,
} from '@/presentation/components/showcase/catalog';
import './showcase.css';

export function Showcase() {
  const { t } = useTranslation('showcase');
  const { t: seo } = useTranslation('seo');
  const [params, setParams] = useSearchParams();
  const [playRequest, requestPlay] = useState(0);
  const playerRef = useRef<HTMLElement>(null);
  const sample = selectedSample(params.get('sample'));
  const category = validCategory(params.get('category'));
  const query = params.get('q') ?? '';
  const samples = filterSamples(category, query);
  const native = !sample.source.includes('llm-remotion-title');

  const updateFilter = (key: string, value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        next.delete(key);

        if (value && value !== 'all') next.set(key, value);

        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  };

  const select = (next: ShowcaseSample) => {
    requestPlay((value) => value + 1);
    setParams(
      (current) => {
        const result = new URLSearchParams(current);
        result.set('sample', next.id);

        return result;
      },
      { preventScrollReset: true }
    );
    playerRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
    playerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="showcase-page mx-auto w-full max-w-[1440px] px-5 pb-20 pt-28 sm:px-8 lg:px-12">
      <Seo path="/showcase" title={seo('showcase.title')} description={seo('showcase.description')} />
      <header className="mb-9 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <h1 className="max-w-[12ch] text-balance text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
          {t('title')}
        </h1>
        <p className="max-w-[32ch] text-lg leading-relaxed text-muted-foreground">{t('intro')}</p>
      </header>
      <section
        ref={playerRef}
        tabIndex={-1}
        aria-label={t('featuredPreview')}
        className="showcase-feature scroll-mt-24 outline-none"
      >
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,2.7fr)_minmax(240px,1fr)] lg:gap-9">
          <ShowcasePlayer key={`${sample.id}:${playRequest}`} sample={sample} requested={playRequest > 0} />
          <div className="flex min-w-0 flex-col gap-5 lg:pt-2">
            <div>
              <h2 className="mb-3 text-3xl font-medium leading-tight sm:text-4xl">{sample.title}</h2>
              <p className="text-lg leading-relaxed text-muted-foreground">{sample.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{t(`categories.${sample.category}`)}</span>
              <span aria-hidden="true">/</span>
              <span>{native ? t('native') : 'Remotion'}</span>
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
          </div>
        </div>
      </section>
      <section aria-labelledby="sample-library" className="mt-14 sm:mt-20">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="flex items-baseline gap-4">
            <h2 id="sample-library" className="text-3xl font-medium">
              {t('library')}
            </h2>
            <span className="text-sm text-muted-foreground">
              {SHOWCASE_SAMPLES.length} {t('samples')}
            </span>
          </div>
          <div className="relative w-full sm:w-72">
            <label htmlFor="showcase-search" className="sr-only">
              {t('search')}
            </label>
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="showcase-search"
              type="search"
              value={query}
              onChange={(event) => {
                updateFilter('q', event.target.value);
              }}
              placeholder={t('search')}
              className="min-h-11 w-full rounded-lg border border-divider bg-transparent pl-10 pr-3 text-base text-foreground outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>
        <div className="mb-8 flex flex-wrap gap-x-2 gap-y-2" role="group" aria-label={t('filterLabel')}>
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === category}
              onClick={() => {
                updateFilter('category', item);
              }}
              className={`min-h-11 rounded-full px-4 text-base transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-brand-500 ${item === category ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
            >
              {t(`categories.${item}`)}
            </button>
          ))}
        </div>
        <p className="sr-only" role="status">
          {t('resultCount', { count: samples.length })}
        </p>
        {samples.length > 0 ? (
          <div className="grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {samples.map((item) => (
              <article key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    select(item);
                  }}
                  aria-label={t('playSample', { title: item.title })}
                  aria-current={item.id === sample.id ? 'true' : undefined}
                  className="showcase-tile group block w-full rounded-xl text-left outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40"
                >
                  <div
                    className={`relative aspect-video overflow-hidden rounded-xl bg-gray-900 ${item.id === sample.id ? 'ring-2 ring-brand-500 ring-offset-4 ring-offset-background' : ''}`}
                  >
                    <img
                      src={mediaPath(item, 'webp')}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width="720"
                      height="405"
                      className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.025] motion-reduce:transform-none"
                    />
                    <span className="absolute bottom-3 right-3 grid size-10 place-content-center rounded-full bg-background/95 text-foreground">
                      <Play size={16} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4 pt-4">
                    <div>
                      <h3 className="text-xl font-medium leading-snug">{item.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{t(`categories.${item.category}`)}</p>
                    </div>
                    <ArrowUpRight size={18} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground" />
                  </div>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-14 text-center">
            <SearchX size={28} className="text-muted-foreground" aria-hidden="true" />
            <h3 className="text-2xl">{t('emptyTitle')}</h3>
            <p className="text-base text-muted-foreground">{t('emptyBody')}</p>
            <Button
              variant="outline"
              onClick={() => {
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.delete('q');
                    next.delete('category');

                    return next;
                  },
                  { replace: true, preventScrollReset: true }
                );
              }}
            >
              <X size={17} aria-hidden="true" />
              {t('clearFilters')}
            </Button>
          </div>
        )}
      </section>
      <section className="mt-16 flex flex-col justify-between gap-5 border-t border-divider pt-8 sm:flex-row sm:items-center">
        <div>
          <h2 className="mb-2 text-2xl font-medium">{t('closingTitle')}</h2>
          <p className="max-w-[58ch] text-base leading-relaxed text-muted-foreground">{t('closingBody')}</p>
        </div>
        <Button asChild variant="outline" className="min-h-11 w-fit shrink-0 rounded-full">
          <Link to="/studio">
            <Plus size={18} aria-hidden="true" />
            {t('openStudio')}
          </Link>
        </Button>
      </section>
    </div>
  );
}
