// The sound groups of a visual section card: "Audio" (music override, voice effect, fades) and "Sound
// effects" (the section's `sfx` cues, timed in section time).
import { useTranslation } from 'react-i18next';
import { Music, Waves } from '@/presentation/components/icons';
import type { EditorSection } from '../../templateEditorModel';
import { SectionDisclosure } from '../SectionDisclosure';
import { audioSummary, sfxSummary } from '../sectionHints';
import { SfxCuesPanel } from '../sfx-cues-panel';
import { SECTION_SFX_MAX } from '../sfx-cues.logic';
import { SectionAudioFields } from './SectionAudioFields';

type VisualSection = Extract<EditorSection, { kind: 'video' } | { kind: 'color' } | { kind: 'image' }>;

interface SectionSoundDisclosuresProps {
  section: VisualSection;
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

export const SectionSoundDisclosures = ({ section, onChange, inputCls }: SectionSoundDisclosuresProps) => {
  const { t } = useTranslation('admin');

  return (
    <>
      <SectionDisclosure
        label={t('disclosure.audio')}
        icon={<Music className="size-4 shrink-0 text-brand-500" aria-hidden />}
        summary={audioSummary(t, section.audioFade, section.musicVolume !== undefined)}
      >
        <SectionAudioFields section={section} onChange={onChange} inputCls={inputCls} />
      </SectionDisclosure>
      <SectionDisclosure
        label={t('disclosure.sfx')}
        icon={<Waves className="size-4 shrink-0 text-brand-500" aria-hidden />}
        summary={sfxSummary(t, section.sfx)}
      >
        <SfxCuesPanel
          cues={section.sfx}
          max={SECTION_SFX_MAX}
          hint={t('sfx.sectionHint')}
          onChange={(sfx) => {
            // Present-but-undefined clears the key: patchSection merges a Partial.
            onChange({ sfx });
          }}
        />
      </SectionDisclosure>
    </>
  );
};
