// @vitest-environment node
// The form panel and its stage rendered in en: the numbered rows, the open row's contract controls,
// the empty state, where answers are used, and the viewer-form mock on the monitor.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import type { ReactNode } from 'react';
import admin from '@/i18n/locales/en/admin.json';
import { newSection, type EditorSection } from '../../templateEditorModel';
import { FormFields } from './FormFields';
import { FormStagePreview } from '../../editor-shell/form-stage-preview';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const render = (node: ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
const noop = () => {};
const form = (fields: Extract<EditorSection, { kind: 'form' }>['fields']) => ({ kind: 'form' as const, fields });
const color = newSection('color') as Extract<EditorSection, { kind: 'color' }>;
const shown: EditorSection = { ...color, titleCard: { headline: { en: 'About {{ topic }}' } } } as EditorSection;

describe('FormFields', () => {
  it('lists fields as numbered rows and opens a lone field', () => {
    const html = render(
      <FormFields
        section={form([{ name: 'topic', label: 'Topic', maxLength: 40 }])}
        onChange={noop}
        inputCls=""
        sections={[shown]}
      />
    );

    expect(html).toContain(`aria-label="${admin.form.listLabel}"`);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(admin.form.intro);
    expect(html).toContain('Shown in scene 1.');
    expect(html).toContain(`>${admin.form.type.text}<`);
    expect(html).toContain(admin.form.required);
    expect(html).toContain(admin.form.defaultHint);
    expect(html).toContain(admin.form.helpHint);
    expect(html).toContain('The form stops at 40 characters.');
    expect(html).toContain(`aria-label="${admin.form.moveUp}"`);
    expect(html).toContain(`title="${admin.form.moveDownTooltip}"`);
  });

  it('flags a duplicate id and an empty label, and marks optional fields', () => {
    const html = render(
      <FormFields
        section={form([
          { name: 'topic', label: '', maxLength: 40, required: false },
          { name: 'topic', label: 'Again', maxLength: 40 },
        ])}
        onChange={noop}
        inputCls=""
      />
    );

    expect(html).toContain(admin.form.untitled);
    expect(html).toContain(`>${admin.form.optionalMark}<`);
    expect(html).toContain(`title="${admin.form.reorderHint}"`);
  });

  it('explains an empty form', () => {
    expect(render(<FormFields section={form([])} onChange={noop} inputCls="" />)).toContain(admin.form.empty);
  });

  it('shows choices for a choice field', () => {
    const html = render(
      <FormFields
        section={form([{ name: 'size', label: 'Size', maxLength: 10, type: 'enum', options: ['S', 'M'] }])}
        onChange={noop}
        inputCls=""
      />
    );

    expect(html).toContain(admin.form.options);
    expect(html).toContain(admin.form.optionsHint);
  });
});

describe('FormStagePreview', () => {
  it('mocks the viewer form and lists where each answer goes', () => {
    const html = render(
      <FormStagePreview
        section={form([
          { name: 'topic', label: 'Topic', maxLength: 40, help: 'One line.' },
          { name: 'price', label: 'Price', maxLength: 8, type: 'number', required: false, default: '24' },
        ])}
        sections={[shown]}
      />
    );

    expect(html).toContain(admin.monitor.formTitle);
    expect(html).toContain(admin.monitor.formLead);
    expect(html).toContain('0/40');
    expect(html).toContain('One line.');
    expect(html).toContain(`aria-label="${admin.monitor.formRequired}"`);
    expect(html).toContain(admin.monitor.formAnswers);
    expect(html).toContain('Scene 1');
    expect(html).toContain(admin.monitor.formNowhere);
    expect(html).toContain(admin.monitor.formSample.text);
  });

  it('says when there is nothing to fill', () => {
    expect(render(<FormStagePreview section={form([])} sections={[]} />)).toContain(admin.monitor.formEmpty);
  });
});
