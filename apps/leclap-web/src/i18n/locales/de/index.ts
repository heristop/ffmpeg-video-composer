// German resource bundle. Mirrors the English bundle key-for-key — same namespaces,
// same nested keys, same `{{interpolation}}` tokens and `_one`/`_other` plural suffixes.
// `satisfies LocaleShape<Resources>` makes `tsc` the completeness gate (see fr/index.ts).
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

type LocaleShape<T> = { [K in keyof T]: T[K] extends string ? string : LocaleShape<T[K]> };

export const de = {
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
