import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Play, Search, Plus, X, SearchX } from 'lucide-react';
import { Seo } from '@/presentation/components/Seo';
import { Button } from '@/presentation/components/ui/button';
import { Reveal } from '@/presentation/components/ui/reveal';
import { createRevealStagger } from '@/lib/reveal-stagger';
import { cn } from '@/lib/utils';
import { ShowcasePlayer } from '@/presentation/components/showcase/ShowcasePlayer';
import { SampleFacts } from '@/presentation/components/showcase/sample-facts';
import { SampleDialog } from '@/presentation/components/showcase/sample-dialog';
import {
  OPENED_STATE,
  closeRoute,
  dialogSample,
  withSample,
  withoutSample,
} from '@/presentation/components/showcase/sample-dialog.logic';
import {
  CATEGORIES,
  SHOWCASE_SAMPLES,
  filterSamples,
  selectedSample,
  validCategory,
  mediaPath,
} from '@/presentation/components/showcase/catalog';
import './showcase.css';

export function Showcase() {
  const { t } = useTranslation('showcase');
  const { t: seo } = useTranslation('seo');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // The page's own film, at the top. Every sample, this one included, plays in place in the dialog.
  const featured = selectedSample(null);
  const opened = dialogSample(params);
  const category = validCategory(params.get('category'));
  const query = params.get('q') ?? '';
  const samples = filterSamples(category, query);
  // The library's cards rise in as they scroll into view, the ones entering together staggered. Once the
  // visitor filters, cards a filter brings back only fade in quickly: no staggered replay on every keystroke.
  const [stagger] = useState(createRevealStagger);
  const [filtered, setFiltered] = useState(false);

  const updateFilter = (key: string, value: string) => {
    setFiltered(true);
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

  // A card pushes its sample's entry, so the browser's back closes the dialog; the page stays where it was.
  const open = (id: string) => {
    setParams((current) => withSample(current, id), { preventScrollReset: true, state: OPENED_STATE });
  };

  // Closing steps back over the entry a card pushed; a dialog reached by a link closes without a new entry.
  const close = () => {
    if (closeRoute(location.state) === 'back') {
      globalThis.history.back();

      return;
    }

    setParams(withoutSample, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="showcase-page mx-auto w-full max-w-[1440px] px-5 pb-20 pt-28 sm:px-8 lg:px-12">
      <Seo path="/showcase" title={seo('showcase.title')} description={seo('showcase.description')} />
      <Reveal className="mb-9 ease-[var(--ease-out-expo)]">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <h1 className="max-w-[12ch] text-balance text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
            {t('title')}
          </h1>
          <p className="max-w-[32ch] text-lg leading-relaxed text-muted-foreground">{t('intro')}</p>
        </header>
      </Reveal>
      <section aria-label={t('featuredPreview')} className="showcase-feature">
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,2.7fr)_minmax(240px,1fr)] lg:gap-9">
          <ShowcasePlayer sample={featured} requested={false} suspended={opened !== undefined} />
          <Reveal delay={120} className="flex min-w-0 flex-col gap-5 ease-[var(--ease-out-expo)] lg:pt-2">
            <div>
              <h2 className="mb-3 text-3xl font-medium leading-tight sm:text-4xl">{featured.title}</h2>
              <p className="text-lg leading-relaxed text-muted-foreground">{featured.description}</p>
            </div>
            <SampleFacts sample={featured} />
          </Reveal>
        </div>
      </section>
      <section aria-labelledby="sample-library" className="mt-14 sm:mt-20">
        <Reveal className="ease-[var(--ease-out-expo)]">
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
        </Reveal>
        <p className="sr-only" role="status">
          {t('resultCount', { count: samples.length })}
        </p>
        {samples.length > 0 ? (
          <div className="grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {samples.map((item) => (
              <Reveal
                key={item.id}
                stagger={filtered ? undefined : stagger}
                onScreen="fade"
                from={filtered ? 'none' : 'up'}
                className={cn('h-full', filtered && 'duration-300 ease-out')}
              >
                <article>
                  <button
                    type="button"
                    onClick={() => {
                      open(item.id);
                    }}
                    aria-label={t('playSample', { title: item.title })}
                    aria-haspopup="dialog"
                    data-sample-tile={item.id}
                    className="showcase-tile group block w-full rounded-xl text-left outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40"
                  >
                    <div className="relative aspect-video overflow-hidden rounded-xl bg-gray-900">
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
              </Reveal>
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
                setFiltered(true);
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
      <Reveal className="mt-16 ease-[var(--ease-out-expo)]">
        <section className="flex flex-col justify-between gap-5 border-t border-divider pt-8 sm:flex-row sm:items-center">
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
      </Reveal>
      <SampleDialog sample={opened} onClose={close} />
    </div>
  );
}
