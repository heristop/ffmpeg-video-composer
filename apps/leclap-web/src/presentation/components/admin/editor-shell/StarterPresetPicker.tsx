import { useTranslation } from 'react-i18next';
import { STARTER_PRESETS, type StarterPreset } from '../templateEditorModel';
import { SECTION_ICON } from '@/lib/sectionMeta';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/presentation/components/ui';
import { Sparkles } from '@/presentation/components/icons';

interface StarterPresetPickerProps {
  open: boolean;
  onPick: (preset: StarterPreset) => void;
  onBlank: () => void;
  // Offers "describe it and generate with AI" as a third way to start.
  onGenerate?: () => void;
}

// The scene-kind glyph strip a preset would create — a tiny structural preview of the template.
// Decorative (the description carries the meaning), so it's hidden from AT.
const SceneStrip = ({ preset }: { preset: StarterPreset }) => (
  <span aria-hidden="true" className="flex flex-wrap items-center gap-1">
    {preset.scenes.map((kind, i) => {
      const Icon = SECTION_ICON[kind];

      return (
        <span
          key={i}
          className="grid h-6 w-6 place-items-center rounded-md border border-divider bg-surface-inset text-gray-500"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      );
    })}
  </span>
);

// Cold-start chooser shown when the builder opens on a blank template: pick a ready-made structure
// (talking-head, showcase, testimonial…) or start from scratch. Picking resets the editor history to
// the preset's freshly-built EditorState; "start blank" just dismisses.
export const StarterPresetPicker = ({ open, onPick, onBlank, onGenerate }: StarterPresetPickerProps) => {
  const { t } = useTranslation('admin');
  const { t: tAi } = useTranslation('ai');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onBlank();
      }}
    >
      {/* Capped to the small-viewport height so the whole picker scrolls instead of clipping. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{t('presets.pickerTitle')}</DialogTitle>
          <DialogDescription>{t('presets.pickerSubtitle')}</DialogDescription>
        </DialogHeader>
        <ul className="mt-2 grid gap-2">
          {STARTER_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(preset);
                }}
                className="tap w-full cursor-pointer rounded-xl border border-divider bg-surface-inset p-4 text-left transition-colors hover:border-brand-500/50 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-[0.99]"
              >
                {/* flex-wrap lets the glyph strip drop under the copy on narrow phones. */}
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-8 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: preset.accent }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{t(preset.nameKey)}</span>
                      <span className="block text-xs text-gray-500">{t(preset.descriptionKey)}</span>
                    </span>
                  </span>
                  <SceneStrip preset={preset} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onBlank}
          className="tap mt-1 inline-flex min-h-11 cursor-pointer items-center justify-self-start rounded-lg px-1 text-sm font-medium text-gray-500 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          {t('presets.startBlank')}
        </button>
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className="tap inline-flex min-h-11 cursor-pointer items-center gap-1.5 justify-self-start rounded-lg px-1 text-sm font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <Sparkles aria-hidden className="size-4" />
            {tAi('fromPresets')}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
};
