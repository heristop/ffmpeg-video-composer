// Global audio finishing panel. Replaces the old two-slider AudioMixEditor with the
// full global mix: source/music volumes, loudness normalisation (off/loudnorm/
// dynaudnorm) and speech-ducking with an advanced fine-tune (threshold/ratio/attack/
// release, the descriptor's DuckingSchema object form). All map to state.audio (AudioMix).
// Per-section music volume overrides and audio fades are on each visual section card
// via SectionAudioFields — they map to EditorSection.musicVolume / .audioFade. Whole-video sound
// effects (global.sfx, the editor's audio.cues) sit in a collapsed group below the mix.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { MicIcon } from '@/presentation/components/icons/mic';
import { Checkbox } from '@/presentation/components/ui';
import type { AudioMix, DuckingSettings } from '../templateEditorModel';
import { RangeSlider, SegmentedControl, VolumeSlider, type SegmentOption } from './controls';
import { SectionDisclosure } from './SectionDisclosure';
import { sfxSummary } from './sectionHints';
import { SfxCuesPanel } from './sfx-cues-panel';
import { GLOBAL_SFX_MAX } from './sfx-cues.logic';

// Engine defaults for the fine-tune knobs (DuckingSchema descriptions) — used to seed the sliders
// so opening "advanced" starts from what `true` already does.
const DUCKING_DEFAULTS: Required<DuckingSettings> = { threshold: 0.05, ratio: 8, attack: 20, release: 400 };

type DuckingKnob = keyof DuckingSettings;

// A knob write: staying exactly on every default collapses the object back to plain `true` so the
// descriptor stays minimal.
function nextDucking(current: DuckingSettings, knob: DuckingKnob, value: number): AudioMix['ducking'] {
  const merged = { ...DUCKING_DEFAULTS, ...current, [knob]: value };
  const allDefault = (Object.keys(DUCKING_DEFAULTS) as DuckingKnob[]).every(
    (key) => merged[key] === DUCKING_DEFAULTS[key]
  );

  return allDefault ? true : merged;
}

interface AudioPanelProps {
  audio: AudioMix;
  onChange: (audio: AudioMix) => void;
}

type NormalizeChoice = 'off' | 'loudnorm' | 'dynaudnorm';

// One-line plain-language caption per normalisation choice, so "Loudnorm"/"Dynamic"
// never read as unexplained filter jargon.
const NORMALIZE_HINT_KEY: Record<NormalizeChoice, string> = {
  off: 'audio.normalizeHintOff',
  loudnorm: 'audio.normalizeHintLoudnorm',
  dynaudnorm: 'audio.normalizeHintDynamic',
};

export const AudioPanel = ({ audio, onChange }: AudioPanelProps) => {
  const { t } = useTranslation('admin');
  const duckId = useId();

  const normalizeOptions: ReadonlyArray<SegmentOption<NormalizeChoice>> = [
    { value: 'off', label: t('audio.normalizeOff') },
    { value: 'loudnorm', label: t('audio.normalizeLoudnorm') },
    { value: 'dynaudnorm', label: t('audio.normalizeDynamic') },
  ];

  const set = (p: Partial<AudioMix>) => {
    onChange({ ...audio, ...p });
  };

  const setCues = (cues: AudioMix['cues']) => {
    const { cues: _drop, ...rest } = audio;

    onChange(cues ? { ...rest, cues } : rest);
  };

  const setNormalize = (choice: NormalizeChoice) => {
    if (choice === 'off') {
      const { normalize: _drop, ...rest } = audio;
      onChange(rest);

      return;
    }
    set({ normalize: choice });
  };

  return (
    <div>
      {/* The panel frame already titles this tool "Audio" — repeat only the guidance line here. */}
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('audio.hint')}</p>
      <div className="space-y-4 rounded-xl border border-foreground/10 bg-surface p-3">
        <VolumeSlider
          label={t('audio.yourVideo')}
          value={audio.sourceVolume}
          onChange={(sourceVolume) => {
            set({ sourceVolume });
          }}
        />
        <VolumeSlider
          label={t('audio.music')}
          value={audio.musicVolume}
          onChange={(musicVolume) => {
            set({ musicVolume });
          }}
        />
        <div>
          <SegmentedControl
            label={t('audio.normalize')}
            value={audio.normalize ?? 'off'}
            options={normalizeOptions}
            onChange={setNormalize}
          />
          {/* Live caption for the active choice: swaps as the author toggles, so each option is
              self-explanatory without a tooltip (one glance, zero extra interactions). */}
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t(NORMALIZE_HINT_KEY[audio.normalize ?? 'off'])}
          </p>
        </div>
        <label
          htmlFor={duckId}
          className="-mx-2 flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg px-2 text-sm text-gray-700 transition-colors hover:bg-foreground/5 dark:text-gray-200"
        >
          <Checkbox
            id={duckId}
            checked={audio.ducking !== false}
            onCheckedChange={(c) => {
              set({ ducking: c === true });
            }}
          />
          <MicIcon size={14} className="text-brand-500" /> {t('audio.ducking')}
        </label>
        {audio.ducking !== false && (
          <DuckingAdvanced
            ducking={audio.ducking}
            onChange={(ducking) => {
              set({ ducking });
            }}
          />
        )}
      </div>
      {/* global.sfx: sounds on the whole-video timeline (the editor keeps them as audio.cues). */}
      <div className="mt-4">
        <SectionDisclosure label={t('sfx.globalLabel')} summary={sfxSummary(t, audio.cues)}>
          <SfxCuesPanel cues={audio.cues} max={GLOBAL_SFX_MAX} hint={t('sfx.globalHint')} onChange={setCues} />
        </SectionDisclosure>
      </div>
    </div>
  );
};

// How many fine-tune knobs sit off their engine default — feeds the collapsed summary chip.
function tunedKnobCount(current: DuckingSettings): number {
  return (Object.keys(DUCKING_DEFAULTS) as DuckingKnob[]).filter(
    (key) => current[key] !== undefined && current[key] !== DUCKING_DEFAULTS[key]
  ).length;
}

// The fine-tune disclosure shown while ducking is on. Sliders read from the object form (or the
// engine defaults while ducking is plain `true`); the first non-default write upgrades to the object.
// Rendered with the shared SectionDisclosure so it matches every other collapsed group in the builder,
// and its summary chip reports how many knobs were moved off the defaults without expanding.
const DuckingAdvanced = ({
  ducking,
  onChange,
}: {
  ducking: true | DuckingSettings;
  onChange: (ducking: AudioMix['ducking']) => void;
}) => {
  const { t } = useTranslation('admin');
  const current: DuckingSettings = ducking === true ? {} : ducking;
  const tuned = tunedKnobCount(current);
  const summary = tuned === 0 ? t('summaryChip.default') : t('audio.duckingTuned', { count: tuned });

  const knob = (key: DuckingKnob): number => current[key] ?? DUCKING_DEFAULTS[key];

  return (
    <SectionDisclosure label={t('audio.duckingAdvanced')} summary={summary}>
      <div className="grid gap-3 sm:grid-cols-2">
        <RangeSlider
          label={t('audio.duckingThreshold')}
          value={knob('threshold')}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          resetTo={DUCKING_DEFAULTS.threshold}
          onChange={(v) => {
            onChange(nextDucking(current, 'threshold', v));
          }}
        />
        <RangeSlider
          label={t('audio.duckingRatio')}
          value={knob('ratio')}
          min={1}
          max={20}
          step={0.5}
          format={(v) => `${v}:1`}
          resetTo={DUCKING_DEFAULTS.ratio}
          onChange={(v) => {
            onChange(nextDucking(current, 'ratio', v));
          }}
        />
        <RangeSlider
          label={t('audio.duckingAttack')}
          value={knob('attack')}
          min={1}
          max={500}
          step={1}
          format={(v) => `${v} ms`}
          resetTo={DUCKING_DEFAULTS.attack}
          onChange={(v) => {
            onChange(nextDucking(current, 'attack', v));
          }}
        />
        <RangeSlider
          label={t('audio.duckingRelease')}
          value={knob('release')}
          min={10}
          max={2000}
          step={10}
          format={(v) => `${v} ms`}
          resetTo={DUCKING_DEFAULTS.release}
          onChange={(v) => {
            onChange(nextDucking(current, 'release', v));
          }}
        />
      </div>
    </SectionDisclosure>
  );
};
