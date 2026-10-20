// The types a form field can take, from the engine's typed-field contract (global.fields) less `media`
// (an upload, not something typed in a form).
export type FormFieldType = 'text' | 'number' | 'enum' | 'url' | 'color' | 'time';

// A form field and, when the author set one, its contract: the type, whether it may stay empty, the
// value used when it does, a help line and the choices. The contract is stored in global.fields under
// the field's name (see form-field-specs.ts); without one the field is plain required text.
export type FormField = {
  name: string;
  label: string;
  maxLength: number;
  type?: FormFieldType;
  required?: boolean;
  default?: string;
  help?: string;
  options?: string[];
};
