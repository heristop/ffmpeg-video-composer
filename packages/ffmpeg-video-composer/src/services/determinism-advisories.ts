import { findNondeterministicExpressions } from '@/core/determinism/hygiene';
import type { MotionWarning } from './motion-lint';

// nondeterministic_expression: a raw filter reads the wall clock or an unseeded random stream, so two
// renders of the same template differ (preview vs export, section cache, `leclap verify`). Advisory only:
// the template still renders.
export function nondeterminismAdvisories(template: unknown): MotionWarning[] {
  return findNondeterministicExpressions(template).map(({ path, token }) => ({
    path,
    code: 'nondeterministic_expression',
    message: `"${token}" reads the wall clock or an unseeded random stream: two renders of this template will differ`,
    severity: 'warn',
    hint: 'Use a global.seed-driven preset (fx, kinetic scramble, camera shake) if the render must be reproducible.',
  }));
}
