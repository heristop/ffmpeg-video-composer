// Jev's read of the brief as toggle chips: "Product launch · 92%". Confident picks start on; unsure
// ones start off and read "Suggested". Each chip is a real toggle button (aria-pressed).
import { useTranslation } from 'react-i18next';
import { Check } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { percent, type RouteChip } from './route-decisions';

interface RouteChipsProps {
  chips: RouteChip[];
  seedTitle: (id: string) => string;
  onToggle: (chip: RouteChip) => void;
}

function useChipLabel(seedTitle: (id: string) => string) {
  const { t } = useTranslation('ai');

  return (chip: RouteChip): string => {
    if (chip.field === 'seed') return t('jev.seed', { title: seedTitle(chip.value) });

    if (chip.field === 'orientation') return t(`hints.${chip.value as 'portrait' | 'landscape' | 'square'}`);

    if (chip.field === 'energy') return t(`jev.energy.${String(Math.round(Number(chip.value))) as '0'}`);

    if (chip.field === 'theme') return t('jev.theme', { name: chip.value });

    if (chip.field === 'genre') return t(`jev.genre.${chip.value as 'explainer'}`, { defaultValue: chip.value });

    return t(`jev.platform.${chip.value as 'tiktok'}`, { defaultValue: chip.value });
  };
}

export const RouteChips = ({ chips, seedTitle, onToggle }: RouteChipsProps) => {
  const { t } = useTranslation('ai');
  const label = useChipLabel(seedTitle);

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">{t('jev.decisions')}</p>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.field}>
            <button
              type="button"
              aria-pressed={chip.on}
              onClick={() => {
                onToggle(chip);
              }}
              className={cn(
                'tap inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                chip.on
                  ? 'border-brand-500/60 bg-brand-500/15 text-foreground'
                  : 'border-dashed border-divider text-muted-foreground hover:text-foreground'
              )}
            >
              {chip.on && <Check aria-hidden className="size-3.5 text-brand-300" />}
              <span>
                {chip.on
                  ? t('jev.applied', { label: label(chip), confidence: percent(chip.confidence) })
                  : `${label(chip)} · ${t('jev.suggestion', { confidence: percent(chip.confidence) })}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
