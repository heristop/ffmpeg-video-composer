// "Your brand" inside Generate with AI: import a brand-kit.json (from `leclap brand <url>` or an agent's
// extract_brand) so the generated template uses the brand's colours, fonts and name. Optional, so it sits
// behind a disclosure that starts collapsed; its summary says whether a brand is attached.
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/ui';
import { SectionDisclosure } from '../editor/SectionDisclosure';
import { FIELD_HELP } from './ai-form-styles';
import { importBrandKit, MAX_BRAND_KIT_BYTES } from './brand-kit-import';

interface BrandKitSectionProps {
  attached: string | null;
  onAttach: (kit: { name: string; rules: string }) => void;
  onDetach: () => void;
  disabled: boolean;
}

export const BrandKitSection = ({ attached, onAttach, onDetach, disabled }: BrandKitSectionProps) => {
  const { t } = useTranslation('ai');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;

    try {
      if (file.size > MAX_BRAND_KIT_BYTES) throw new Error(t('brand.tooLarge'));

      onAttach(await importBrandKit(await file.text()));
      setError(null);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    }
  };

  return (
    <SectionDisclosure
      label={t('brand.label')}
      summary={attached === null ? t('brand.summaryNone') : t('brand.summaryAttached')}
      defaultOpen={attached !== null}
    >
      <div className="grid gap-3">
        <p className={FIELD_HELP}>{t('brand.hint')}</p>
        {attached === null ? (
          <input
            id={inputId}
            type="file"
            accept="application/json,.json"
            aria-label={t('brand.label')}
            className="text-xs text-foreground"
            disabled={disabled}
            onChange={(event) => {
              onFile(event.target.files?.[0]).catch(() => {});
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-xs text-pretty text-foreground">
              {t('brand.attached', { name: attached })}
            </p>
            <Button type="button" variant="ghost" size="sm" className="min-h-10" disabled={disabled} onClick={onDetach}>
              {t('brand.detach')}
            </Button>
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="text-xs text-pretty text-destructive">
            {error}
          </p>
        )}
      </div>
    </SectionDisclosure>
  );
};
