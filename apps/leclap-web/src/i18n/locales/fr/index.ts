// French resource bundle. Mirrors the English bundle key-for-key — same namespaces,
// same nested keys, same `{{interpolation}}` tokens and `_one`/`_other` plural suffixes.
//
// `satisfies LocaleShape<Resources>` makes `tsc` the completeness gate: every English key
// must have a French counterpart (string leaves can differ in value, but the shape can't),
// so a missing translation fails typecheck rather than silently falling back to English.
import common from './common.json';
import showcase from './showcase.json';
import home from './home.json';
import about from './about.json';
import compare from './compare.json';
import seo from './seo.json';
import onboarding from './onboarding.json';
import media from './media.json';
import builder from './builder.json';
import templates from './templates.json';
import process from './process.json';
import browser from './browser.json';
import admin from './admin.json';
import shell from './shell.json';
import projects from './projects.json';
import legal from './legal.json';
import privacy from './privacy.json';
import ai from './ai.json';
import agent from './agent.json';
import type { Resources } from '../en';

// Recursively replace string-literal leaves with `string` so French values may differ from
// English while the key structure is still enforced.
type LocaleShape<T> = { [K in keyof T]: T[K] extends string ? string : LocaleShape<T[K]> };

export const fr = {
  common,
  showcase,
  home,
  about,
  compare,
  seo,
  onboarding,
  media,
  builder,
  templates,
  process,
  browser,
  admin,
  shell,
  projects,
  legal,
  privacy,
  ai,
  agent,
} satisfies LocaleShape<Resources>;
