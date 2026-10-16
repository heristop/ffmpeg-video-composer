import { describe, expect, it } from 'vitest';
import * as api from '@/index';

describe('reference-structure public API', () => {
  it('publishes the analyzer, the rules and the drift check', () => {
    for (const name of ['analyzeStructure', 'analyzeStructureFile', 'structurePromptRules', 'structureDrift']) {
      expect(api).toHaveProperty(name);
    }
    expect(api.LECLAP_TRANSITION.dissolve).toBe('fade');
  });

  it('keeps the tuning helpers internal', () => {
    for (const name of [
      'findBoundaries',
      'frameTime',
      'DEFAULT_FRAME_INTERVAL',
      'cropBars',
      'anchorOf',
      'groundOf',
      'motionOf',
    ]) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
