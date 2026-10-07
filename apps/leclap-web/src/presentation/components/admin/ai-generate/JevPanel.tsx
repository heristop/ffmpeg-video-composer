// Jev's part of the dialog, shown only with a Jev key: analyse the brief (genre, platform, format,
// energy, closest template) and, from that, open the best-matching ready-made template without any
// writing model. Copy makes the division of labour explicit: Jev picks, it doesn't write.
import { useTranslation } from 'react-i18next';
import { bestSeed } from '@/application/usecases/ai-template/brief-router';
import { generationContext } from '@/application/usecases/ai-template/generation-context';
import { Loader2, Sparkles } from '@/presentation/components/icons';
import { Button } from '@/presentation/components/ui';
import type { EditorState } from '../templateEditorModel';
import { MIN_BRIEF_LENGTH } from './ai-generation.logic';
import { sampleToEditorState } from './load-generated';
import { chosenTheme, type RouteChip } from './route-decisions';
import { RouteChips } from './RouteChips';
import type { RouteState } from './use-ai-generation';

interface JevPanelProps {
  hasKey: boolean;
  brief: string;
  route: RouteState;
  chips: RouteChip[];
  onToggle: (chip: RouteChip) => void;
  onAnalyse: () => void;
  onStartFromMatch: (state: EditorState) => void;
  disabled: boolean;
}

function seedTitle(id: string): string {
  return generationContext().samples.find((sample) => sample.id === id)?.title ?? id;
}

const RouteError = ({ route }: { route: RouteState }) => {
  const { t } = useTranslation('ai');

  if (route.kind !== 'error') return null;

  return (
    <p role="alert" className="text-xs text-[var(--color-warning)]">
      {t(`errors.${route.error.key}`, { provider: t('jev.provider'), rounds: 0 })}
    </p>
  );
};

export const JevPanel = ({
  hasKey,
  brief,
  route,
  chips,
  onToggle,
  onAnalyse,
  onStartFromMatch,
  disabled,
}: JevPanelProps) => {
  const { t } = useTranslation('ai');

  if (!hasKey) return null;

  const seedOn = chips.some((chip) => chip.field === 'seed' && chip.on);
  const match = route.kind === 'ready' && seedOn ? bestSeed(route.route, generationContext().samples) : undefined;
  const ready = brief.trim().length >= MIN_BRIEF_LENGTH;

  return (
    <div className="grid gap-3 rounded-xl border border-divider p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pretty text-muted-foreground">
          {match ? t('jev.bestMatchHint', { title: match.title }) : t('jev.bestMatchNone')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10"
            disabled={disabled || !ready}
            onClick={onAnalyse}
          >
            {route.kind === 'routing' ? (
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Sparkles aria-hidden />
            )}
            {t('jev.route')}
          </Button>
          {match && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-10"
              disabled={disabled}
              onClick={() => {
                onStartFromMatch(sampleToEditorState(match, chosenTheme(chips)));
              }}
            >
              {t('jev.bestMatch')}
            </Button>
          )}
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
        {route.kind === 'routing' ? t('jev.routing') : ''}
      </p>
      {chips.length > 0 && <RouteChips chips={chips} seedTitle={seedTitle} onToggle={onToggle} />}
      <RouteError route={route} />
    </div>
  );
};
