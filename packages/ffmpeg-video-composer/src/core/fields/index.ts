// Typed template fields (`global.fields`): the declared input contract, its coercion and its resolution.
export { declaredFields, declaresFields } from './declared';
export {
  coerceFieldValue,
  probeValue,
  DEFAULT_FIELD_COERCERS,
  type Coerced,
  type FieldCoercer,
  type FieldCoercers,
  type FieldValue,
} from './coerce';
export {
  resolveFields,
  assertFieldsResolved,
  FieldResolutionError,
  type FieldIssue,
  type FieldIssueCode,
  type FieldSubstitution,
  type ResolveFieldsOptions,
  type ResolvedFields,
} from './resolve';
export { placeholderNames, PLACEHOLDER_PATTERN } from './placeholders';
