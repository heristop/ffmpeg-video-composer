// The derived theme as a swatch grid: each role's colour, hex, where it came from, and a WCAG badge
// for its contrast on the background. Swatch colours are the analysed data, so they are inline styles.
import { useTranslation } from 'react-i18next';
import type { StyleAnalysis } from 'ffmpeg-video-composer/src/core/style/types.ts';
import { Badge } from '@/presentation/components/ui';
import { percent, swatchesOf, type ContrastLevel, type Swatch } from './reference-style.logic';

const BADGE_VARIANT: Record<ContrastLevel, 'success' | 'secondary' | 'neutral'> = {
  aa: 'success',
  aaLarge: 'secondary',
  fail: 'neutral',
};

const ContrastBadge = ({ contrast }: { contrast: NonNullable<Swatch['contrast']> }) => {
  const { t } = useTranslation('admin');
  const ratio = contrast.ratio.toFixed(1);

  return (
    <Badge
      variant={BADGE_VARIANT[contrast.level]}
      className="px-1.5 text-[0.6rem] normal-case tracking-normal"
      aria-label={t('styleReference.contrastLabel', { ratio, level: t(`styleReference.level.${contrast.level}`) })}
    >
      {t(`styleReference.contrast.${contrast.level}`, { ratio })}
    </Badge>
  );
};

const SwatchItem = ({ swatch }: { swatch: Swatch }) => {
  const { t } = useTranslation('admin');

  return (
    <li className="grid grid-cols-[2.25rem_1fr] items-center gap-2">
      <span
        aria-hidden
        className="size-9 rounded-lg border border-foreground/15 shadow-sm"
        style={{ backgroundColor: swatch.hex }}
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
          {t(`styleReference.roles.${swatch.role}`)}
          {swatch.contrast && <ContrastBadge contrast={swatch.contrast} />}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {swatch.hex} · {t(`styleReference.source.${swatch.source}`)}
        </span>
      </span>
    </li>
  );
};

function rhythmLine(analysis: StyleAnalysis, t: (key: string, options?: Record<string, unknown>) => string): string {
  const { pacing, motion, texture } = analysis.styleGuide;
  const grain =
    texture.look === 'grain'
      ? t('styleReference.texture.grain', { grain: texture.grain })
      : t('styleReference.texture.none');

  if (!pacing) return grain;

  return `${t('styleReference.pacing', { avgShot: pacing.avgShot, cpm: pacing.cutsPerMinute, energy: motion?.energy ?? 0 })} · ${grain}`;
}

export const StyleSwatches = ({ analysis }: { analysis: StyleAnalysis }) => {
  const { t } = useTranslation('admin');
  const { genre } = analysis.styleGuide;

  return (
    <div className="grid gap-3">
      <ul aria-label={t('styleReference.swatches')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {swatchesOf(analysis).map((swatch) => (
          <SwatchItem key={swatch.role} swatch={swatch} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {rhythmLine(analysis, t)}
        {genre ? ` · ${t('styleReference.genre', { genre })}` : ''}
        {` · ${t('styleReference.confidence', { value: percent(analysis.confidence) })}`}
      </p>
    </div>
  );
};
