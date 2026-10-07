// The ready state: what was generated, at a glance — name, one-line description, scene and clip
// counts, length and format, and the effects it uses — plus any warnings from the run and the
// engine's art-direction notes (pacing, accent, palette lint), counted and expandable.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { DescriptorSummary } from '@/application/usecases/ai-template/descriptor-summary';
import type { Advisory } from '@/application/usecases/ai-template/validate-generated';
import { Info } from '@/presentation/components/icons';

interface ResultCardProps {
  summary: DescriptorSummary;
  warnings: string[];
  advisories?: Advisory[];
}

const FACT = 'rounded-md bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium tabular-nums text-foreground/90';

const AdvisoryList = ({ advisories }: { advisories: Advisory[] }) => {
  const { t } = useTranslation('ai');

  if (advisories.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('result.noAdvisories')}</p>;
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer rounded font-medium text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
        {t('result.advisories', { count: advisories.length })}
      </summary>
      <ul className="mt-2 grid gap-2 pl-4">
        {advisories.map((advisory) => (
          <li key={`${advisory.code}:${advisory.path}:${advisory.message}`} className="grid gap-0.5">
            <span className="text-pretty text-foreground/90">
              <code className="mr-1.5 font-mono text-[0.7rem] text-muted-foreground">{advisory.code}</code>
              {advisory.message}
            </span>
            {advisory.hint && <span className="text-pretty text-muted-foreground">{advisory.hint}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
};

export const ResultCard = ({ summary, warnings, advisories = [] }: ResultCardProps) => {
  const { t } = useTranslation('ai');
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const seconds = Number(summary.durationSeconds.toFixed(1));

  // Bring the result into view when it arrives — the form above it may have been scrolled away.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [reduced]);

  return (
    <section
      ref={ref}
      aria-labelledby="ai-result-name"
      className="grid scroll-mb-48 gap-3 rounded-xl border border-divider bg-surface-2 p-4"
    >
      <div>
        <h3 id="ai-result-name" className="text-base font-semibold text-foreground">
          {summary.name || t('title')}
        </h3>
        {summary.description && (
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{summary.description}</p>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        <li className={FACT}>{t('result.scenes', { count: summary.scenes })}</li>
        {summary.footageScenes > 0 && <li className={FACT}>{t('result.footage', { count: summary.footageScenes })}</li>}
        <li className={FACT}>
          {summary.durationIsEstimate ? t('result.durationEstimate', { seconds }) : t('result.duration', { seconds })}
        </li>
        <li className={FACT}>
          {t(`hints.${summary.orientation as 'landscape'}`, { defaultValue: summary.orientation })}
        </li>
      </ul>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t('result.effects')}</p>
        <p className="text-sm text-foreground/90">
          {summary.effects.length > 0 ? summary.effects.join(' · ') : t('result.noEffects')}
        </p>
      </div>
      <AdvisoryList advisories={advisories} />
      {warnings.length > 0 && (
        <ul className="grid gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-px size-3.5 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
