import { resolveTranslation, resolveVariables, buildDescriptionVars } from './i18nText';

describe('resolveTranslation', () => {
  it('resolves regional locales before the English fallback', () => {
    expect(resolveTranslation({ en: 'Hello', fr: 'Bonjour' }, 'fr-FR')).toBe('Bonjour');
  });

  it('ignores empty translations when choosing a fallback', () => {
    expect(resolveTranslation({ fr: '', en: 'Hello' }, 'fr')).toBe('Hello');
  });
  it('returns the requested locale when present', () => {
    expect(resolveTranslation({ en: 'Hello', fr: 'Bonjour' }, 'fr')).toBe('Bonjour');
  });

  it('falls back to en when the locale is missing', () => {
    expect(resolveTranslation({ en: 'Hello', fr: 'Bonjour' }, 'de')).toBe('Hello');
  });

  it('falls back to the first present translation when en is missing', () => {
    expect(resolveTranslation({ fr: 'Bonjour', de: 'Hallo' }, 'es')).toBe('Bonjour');
  });

  it('returns undefined for an empty or missing map', () => {
    expect(resolveTranslation(undefined, 'en')).toBeUndefined();
    expect(resolveTranslation({}, 'en')).toBeUndefined();
  });
});

describe('resolveVariables', () => {
  it('substitutes known tokens', () => {
    expect(resolveVariables('{{ a }} or {{ b }}?', { a: 'Cats', b: 'Dogs' })).toBe('Cats or Dogs?');
  });

  it('joins array values with a comma', () => {
    expect(resolveVariables('Colors: {{ list }}', { list: ['red', 'blue'] })).toBe('Colors: red, blue');
  });

  it('leaves unknown tokens as-is', () => {
    expect(resolveVariables('{{ a }} and {{ missing }}', { a: 'Cats' })).toBe('Cats and {{ missing }}');
  });

  it('returns the text untouched when there are no tokens', () => {
    expect(resolveVariables('plain text', { a: 'x' })).toBe('plain text');
  });
});

describe('buildDescriptionVars', () => {
  it('expands colorsList to 1-indexed color tokens', () => {
    const vars = buildDescriptionVars(undefined, ['#fff', '#000'], undefined);

    expect(vars).toEqual({ color1: '#fff', color2: '#000' });
  });

  it('merges global variables and form answers, form answers winning', () => {
    const vars = buildDescriptionVars({ optionA3: 'Cats', shared: 'global' }, undefined, { shared: 'answer', n: 3 });

    expect(vars).toEqual({ optionA3: 'Cats', shared: 'answer', n: '3' });
  });

  it('resolves a fast-curious prompt with global variables', () => {
    const vars = buildDescriptionVars({ optionA3: 'Cats', optionB3: 'Dogs' }, undefined, undefined);

    expect(resolveVariables('{{ optionA3 }} or {{ optionB3 }}? — film your answer', vars)).toBe(
      'Cats or Dogs? — film your answer'
    );
  });
});
