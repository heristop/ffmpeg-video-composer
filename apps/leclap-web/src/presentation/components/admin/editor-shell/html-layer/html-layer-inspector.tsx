// The HTML layer's settings: its markup and stylesheet as two code fields, the fields it can show as
// insertable `{{ name }}` chips, its box (width × height, in output pixels), and a live preview drawn by
// the engine's own rasteriser with what the render will drop or cut, next to the code that causes it.
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HTML_LAYER_MAX_SIZE } from 'ffmpeg-video-composer/src/core/html/limits.ts';
import type { HtmlLayerFinding } from 'ffmpeg-video-composer/src/browser.ts';
import { Button } from '@/presentation/components/ui';
import { NumberField } from '@/presentation/components/ui/NumberField';
import { cn } from '@/lib/utils';
import type { HtmlLayer } from '../../templateEditorModel';
import { EDITOR_INPUT_CLASS } from '../../editor/editorStyles';
import { insertVariableAtHash } from '../../editor/variableInsert';
import type { HtmlPreviewEnv } from './html-layer-env';
import { useHtmlLayerPreview, type HtmlLayerPreviewState } from './use-html-layer-preview';

const LABEL_CLS = 'block text-xs font-semibold uppercase tracking-widest text-gray-400';
const CODE_CLS = cn(EDITOR_INPUT_CLASS, 'min-h-28 resize-y font-mono text-xs leading-relaxed');

interface HtmlLayerInspectorProps {
  layer: HtmlLayer;
  env: HtmlPreviewEnv;
  onChange: (patch: Partial<HtmlLayer>) => void;
  onRemove: () => void;
}

export const HtmlLayerInspector = ({ layer, env, onChange, onRemove }: HtmlLayerInspectorProps) => {
  const { t } = useTranslation('admin');
  const id = useId();
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const preview = useHtmlLayerPreview(layer, env);

  // At the caret (or over the selection) of the HTML field, then back to typing right after the token.
  const insertField = (name: string) => {
    const field = htmlRef.current;
    const start = field?.selectionStart ?? layer.html.length;
    const end = field?.selectionEnd ?? start;
    const next = insertVariableAtHash(layer.html, start, end, name);

    onChange({ html: next.text });
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-name`} className={LABEL_CLS}>
          {t('htmlLayer.name')}
        </label>
        <input
          id={`${id}-name`}
          value={layer.name ?? ''}
          placeholder="address_card"
          spellCheck={false}
          aria-describedby={`${id}-name-hint`}
          onChange={(event) => {
            onChange({ name: event.target.value.replace(/[^\w]/g, '_') });
          }}
          className={cn(EDITOR_INPUT_CLASS, 'mt-1 font-mono text-xs')}
        />
        <p id={`${id}-name-hint`} className="mt-1 text-[0.7rem] text-gray-500 dark:text-gray-400">
          {t('htmlLayer.nameHint')}
        </p>
      </div>
      <CodeField
        id={`${id}-html`}
        label={t('htmlLayer.html')}
        value={layer.html}
        textareaRef={htmlRef}
        describedBy={`${id}-findings`}
        onChange={(html) => {
          onChange({ html });
        }}
      />
      <FieldChips env={env} onInsert={insertField} />
      <CodeField
        id={`${id}-css`}
        label={t('htmlLayer.css')}
        value={layer.css ?? ''}
        describedBy={`${id}-findings`}
        onChange={(css) => {
          onChange({ css });
        }}
      />
      <BoxFields layer={layer} onChange={onChange} />
      <PreviewPanel id={`${id}-findings`} preview={preview} layer={layer} />
      <Button type="button" variant="outline" size="sm" onClick={onRemove}>
        {t('htmlLayer.remove')}
      </Button>
    </div>
  );
};

interface CodeFieldProps {
  id: string;
  label: string;
  value: string;
  describedBy: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  onChange: (value: string) => void;
}

const CodeField = ({ id, label, value, describedBy, textareaRef, onChange }: CodeFieldProps) => (
  <div>
    <label htmlFor={id} className={LABEL_CLS}>
      {label}
    </label>
    <textarea
      ref={textareaRef}
      id={id}
      value={value}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-describedby={describedBy}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className={cn(CODE_CLS, 'mt-1')}
    />
  </div>
);

const FieldChips = ({ env, onInsert }: { env: HtmlPreviewEnv; onInsert: (name: string) => void }) => {
  const { t } = useTranslation('admin');

  return (
    <div role="group" aria-label={t('htmlLayer.fields')}>
      <span className={LABEL_CLS}>{t('htmlLayer.fields')}</span>
      {env.fields.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('htmlLayer.fieldsEmpty')}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {env.fields.map((field) => (
            <li key={field.name}>
              <button
                type="button"
                aria-label={t('htmlLayer.insert', { name: field.name })}
                title={t(`htmlLayer.source.${field.source}`)}
                onClick={() => {
                  onInsert(field.name);
                }}
                className="tap rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[0.7rem] text-brand-700 transition-colors hover:bg-brand-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-200"
              >
                {`{{ ${field.name} }}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const BoxFields = ({ layer, onChange }: { layer: HtmlLayer; onChange: (patch: Partial<HtmlLayer>) => void }) => {
  const { t } = useTranslation('admin');

  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className={cn(LABEL_CLS, 'mb-1')}>{t('htmlLayer.box')}</legend>
      {(['width', 'height'] as const).map((side) => (
        <NumberField
          key={side}
          label={t(`htmlLayer.${side}`)}
          value={layer[side]}
          min={16}
          max={HTML_LAYER_MAX_SIZE}
          step={8}
          unit="px"
          compact
          onChange={(value) => {
            // The box is what the layout fills: a set scale would stretch it, so it follows the box.
            onChange({ [side]: value, scale: undefined });
          }}
        />
      ))}
    </fieldset>
  );
};

interface PreviewPanelProps {
  id: string;
  preview: HtmlLayerPreviewState;
  layer: HtmlLayer;
}

const PreviewPanel = ({ id, preview, layer }: PreviewPanelProps) => {
  const { t } = useTranslation('admin');

  return (
    <div className="space-y-2">
      <span className={LABEL_CLS}>{t('htmlLayer.preview')}</span>
      <div
        className="grid place-items-center overflow-hidden rounded-lg border border-foreground/10 bg-surface-inset p-2"
        aria-busy={preview.status === 'drawing'}
      >
        {preview.url ? (
          <img
            src={preview.url}
            alt={t('htmlLayer.previewAlt')}
            width={layer.width}
            height={layer.height}
            className={cn('h-auto max-w-full', preview.status === 'drawing' && 'opacity-60')}
          />
        ) : (
          <span className="py-6 text-xs text-gray-500">{t('htmlLayer.drawing')}</span>
        )}
      </div>
      <Findings id={id} preview={preview} />
    </div>
  );
};

const Findings = ({ id, preview }: { id: string; preview: HtmlLayerPreviewState }) => {
  const { t } = useTranslation('admin');

  if (preview.status === 'failed') {
    return (
      <p id={id} role="status" className="text-xs text-error">
        {t('htmlLayer.failed', { error: preview.error ?? '' })}
      </p>
    );
  }

  if (preview.findings.length === 0) {
    return (
      <p id={id} role="status" className="text-xs text-gray-500 dark:text-gray-400">
        {preview.status === 'ready' ? t('htmlLayer.clean') : ''}
      </p>
    );
  }

  return (
    <div id={id} role="status">
      <span className="sr-only">{t('htmlLayer.advisories')}</span>
      <ul className="space-y-1">
        {preview.findings.map((finding, index) => (
          <FindingRow key={`${finding.code}-${index}`} finding={finding} />
        ))}
      </ul>
    </div>
  );
};

const FindingRow = ({ finding }: { finding: HtmlLayerFinding }) => {
  const { t } = useTranslation('admin');

  return (
    <li className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-xs text-foreground">
      <span className="font-semibold">{t(`htmlLayer.advisory.${finding.code}`)}</span>
      <span className="text-gray-500 dark:text-gray-400"> · {finding.source.toUpperCase()}</span>
      <span className="block break-words font-mono text-[0.7rem] text-gray-600 dark:text-gray-300">
        {finding.message}
      </span>
    </li>
  );
};
