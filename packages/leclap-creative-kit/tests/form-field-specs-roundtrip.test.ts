// A form field's contract (type, required, default, help, choices) lives in global.fields under the field's
// name; the builder edits it on the form field itself. It must survive descriptor -> editor -> descriptor,
// and declared fields no form asks for must not be dropped on save.
import { describe, expect, it } from 'vitest';
import {
  buildDescriptor,
  toEditorState,
  type EditableTemplate,
  type EditorSection,
  type TemplateDescriptor,
} from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';

function template(descriptor: TemplateDescriptor): EditableTemplate {
  return { id: 'user-1', name: 'Fields', description: '', orientation: 'landscape', descriptor };
}

const descriptor: TemplateDescriptor = {
  global: {
    orientation: 'landscape',
    musicEnabled: false,
    fields: {
      form_1_topic: { type: 'text', required: false, default: 'Our launch', description: 'One short line.' },
      form_1_size: { type: 'enum', options: ['S', 'M', 'L'], required: true },
      brand_color: { type: 'color', default: '#7C83FD' },
    },
  },
  sections: [
    {
      name: 'form_0',
      type: 'form',
      options: {
        fields: [
          { name: 'form_1_topic', maxLength: 40, label: { en: 'Topic' } },
          { name: 'form_1_size', maxLength: 10, label: { en: 'Size' } },
          { name: 'form_1_name', maxLength: 30, label: { en: 'Name' } },
        ],
      },
    },
  ],
} as TemplateDescriptor;

function formFields(sections: EditorSection[]) {
  const form = sections.find((section) => section.kind === 'form');

  return form?.kind === 'form' ? form.fields : [];
}

describe('form field contracts', () => {
  it('binds a declared contract onto the form field of the same name', () => {
    const [topic, size, name] = formFields(toEditorState(template(descriptor)).sections);

    expect(topic).toMatchObject({ type: 'text', required: false, default: 'Our launch', help: 'One short line.' });
    expect(size).toMatchObject({ type: 'enum', options: ['S', 'M', 'L'], required: true });
    expect(name.type).toBeUndefined();
  });

  it('writes the contracts back in the same shape, keeping unedited keys and fields', () => {
    const rebuilt = buildDescriptor(toEditorState(template(descriptor)));

    expect(TemplateDescriptorSchema.safeParse(rebuilt).success).toBe(true);
    expect(rebuilt.global?.fields).toEqual(descriptor.global?.fields);
  });

  it('applies an edit to the bound field only', () => {
    const state = toEditorState(template(descriptor));
    const edited = {
      ...state,
      sections: state.sections.map((section) =>
        section.kind === 'form'
          ? {
              ...section,
              fields: section.fields.map((field) =>
                field.name === 'form_1_topic' ? { ...field, default: '' } : field
              ),
            }
          : section
      ),
    };
    const fields = buildDescriptor(edited).global?.fields as unknown as Record<string, Record<string, unknown>>;

    expect(fields.form_1_topic).toEqual({ type: 'text', required: false, description: 'One short line.' });
    expect(fields.brand_color).toEqual({ type: 'color', default: '#7C83FD' });
  });

  it('emits a contract once the author sets one, keeping the field required unless they say otherwise', () => {
    const state = toEditorState(null);
    const withForm = {
      ...state,
      sections: [
        {
          kind: 'form' as const,
          fields: [{ name: 'form_1_price', label: 'Price', maxLength: 8, type: 'number' as const, default: '24' }],
        },
      ],
    };
    expect(buildDescriptor(withForm).global?.fields).toEqual({
      form_1_price: { type: 'number', required: true, default: 24 },
    });
  });

  it('declares nothing for plain fields', () => {
    const state = toEditorState(null);
    const plain = {
      ...state,
      sections: [{ kind: 'form' as const, fields: [{ name: 'a', label: 'A', maxLength: 10 }] }],
    };

    expect(buildDescriptor(plain).global?.fields).toBeUndefined();
  });
});
