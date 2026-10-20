// Field block for a background-music section: the track shortlist (ticks, default, preview) and the
// upload toggle.
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/presentation/components/ui';
import type { EditorSection } from '../../templateEditorModel';
import { MusicTrackList } from '../music-track-list';
import { makeDefault } from '../music-track-list.logic';
import { toggleId } from './toggleId';

type MusicSection = Extract<EditorSection, { kind: 'music' }>;

interface MusicFieldsProps {
  section: MusicSection;
  onChange: (p: Partial<EditorSection>) => void;
}

export function MusicFields({ section, onChange }: MusicFieldsProps) {
  const { t } = useTranslation('admin');

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('musicSection.pickTracks')}</p>
      <MusicTrackList
        selectedIds={section.allowed}
        allowUpload={section.allowUpload}
        onToggle={(id) => {
          onChange({ allowed: toggleId(section.allowed, id) });
        }}
        onMakeDefault={(id) => {
          onChange({ allowed: makeDefault(section.allowed, id) });
        }}
        onClear={() => {
          onChange({ allowed: [] });
        }}
      />
      <div className="border-t border-divider pt-4">
        <label className="flex w-fit cursor-pointer select-none items-center gap-3 text-sm text-foreground">
          <Checkbox
            checked={section.allowUpload}
            onCheckedChange={(c) => {
              onChange({ allowUpload: c === true });
            }}
          />
          {t('musicSection.allowUpload')}
        </label>
      </div>
    </div>
  );
}
