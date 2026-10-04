// English resource bundle. Each namespace is one JSON file; add new namespaces
// here so they are both registered with i18next and picked up by the typed-key
// augmentation in src/types/react-i18next.d.ts.
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

export const en = {
  common,
  showcase,
  home,
  about,
  compare,
  seo,
  legal,
  privacy,
  onboarding,
  media,
  builder,
  templates,
  process,
  browser,
  admin,
  shell,
  projects,
} as const;

export type Resources = typeof en;
