// Function words a caption line should not end on: articles, prepositions, conjunctions and the like.
// A break right after one ("the | cat", "de la | maison") strands the word from the noun it introduces,
// which reads as a stumble. Lists per language; the default is their union, so a line is judged the
// same way whatever the active locale is.

export const CAPTION_LANGUAGES = ['en', 'fr', 'es', 'de', 'it'] as const;
export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

const WORDS: Record<CaptionLanguage, string> = {
  en: 'a an the of to in on at by for with from into onto over under about as and or but nor so if than that this these those my your his her its our their',
  fr: "le la les l' un une des du de d' à au aux en dans sur sous par pour avec sans chez et ou mais ni que qu' ce cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs se ne",
  es: 'el la los las un una unos unas de del a al en con sin por para sobre bajo entre y o pero ni que su sus mi mis tu tus lo se',
  de: 'der die das den dem des ein eine einen einem einer eines zu zum zur von vom mit bei aus nach an am auf im in für über unter und oder aber dass wie als sein seine ihr ihre',
  it: "il lo la i gli le un uno una un' l' di del dello della dei degli delle a al allo alla ai agli alle da dal dalla in nel nella con su sul sulla per tra fra e o ma che",
};

const SETS: Record<CaptionLanguage, ReadonlySet<string>> = {
  en: new Set(WORDS.en.split(' ')),
  fr: new Set(WORDS.fr.split(' ')),
  es: new Set(WORDS.es.split(' ')),
  de: new Set(WORDS.de.split(' ')),
  it: new Set(WORDS.it.split(' ')),
};

const ALL: ReadonlySet<string> = new Set(CAPTION_LANGUAGES.flatMap((lang) => [...SETS[lang]]));

// Lower case, straight apostrophes, no surrounding punctuation: "L’" and "(the" both match.
function normalized(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^[("“«¿¡]+|[)"”»,;:.!?…]+$/g, '');
}

/** True when a line should not end on `word` (an article, preposition, conjunction…). */
export function isFunctionWord(word: string, lang?: string): boolean {
  const key = normalized(word);
  const set = lang !== undefined && Object.hasOwn(SETS, lang) ? SETS[lang as CaptionLanguage] : ALL;

  return set.has(key);
}
