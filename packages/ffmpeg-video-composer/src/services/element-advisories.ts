// Advisories on the elements a template composes from its own description rather than from footage:
// synthesized sounds (sound-advisories.ts) and HTML layers (html-advisories.ts). One entry point keeps
// TemplateValidator within its dependency budget.

import { htmlAdvisories } from './html-advisories';
import type { MotionWarning } from './motion-lint';
import { soundAdvisories } from './sound-advisories';

export function elementAdvisories(template: unknown): MotionWarning[] {
  return [...soundAdvisories(template), ...htmlAdvisories(template)];
}
