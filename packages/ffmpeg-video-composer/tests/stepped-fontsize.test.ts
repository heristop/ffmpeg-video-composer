import { describe, expect, it } from 'vitest';
import { steppedFontSize } from '@/editor/utils/stepped-fontsize';
import type { Filter } from '@/core/types';

const timing = () => ({ fps: 10, duration: 1 });

function make(type: string, values: Record<string, unknown>): Filter {
  return { type, values } as Filter;
}

describe('steppedFontSize', () => {
  it('leaves constant sizes and other filters alone', () => {
    const plain = make('drawtext', { text: 'A', fontsize: 40 });
    const box = make('drawbox', { w: 't*10' });

    expect(steppedFontSize(plain, timing)).toEqual([plain]);
    expect(steppedFontSize(box, timing)).toEqual([box]);
  });

  it('splits an animated size into constant-size runs gated to their frames', () => {
    const steps = steppedFontSize(make('drawtext', { text: 'AB', fontsize: "'if(lt(t,0.25),60,40)'" }), timing);

    expect(steps.map((step) => step.values?.fontsize)).toEqual([60, 40]);
    expect(steps[0].values?.enable).toBe("'lt(t,0.250000)'");
    expect(steps[1].values?.enable).toBe("'gte(t,0.250000)'");
  });

  it('keeps the authored enable window on every run', () => {
    const text = make('drawtext', { text: 'A', fontsize: "'50+10*gte(t,0.5)'", enable: "'between(t,0.2,0.8)'" });

    expect(steppedFontSize(text, timing).map((step) => step.values?.enable)).toEqual([
      "'(between(t,0.2,0.8))*lt(t,0.450000)'",
      "'(between(t,0.2,0.8))*gte(t,0.450000)'",
    ]);
  });

  it('rounds to whole pixels like drawtext and merges equal frames', () => {
    const text = make('drawtext', { text: 'A', fontsize: "'40+0.1*n'" });

    expect(steppedFontSize(text, timing).map((step) => step.values?.fontsize)).toEqual([40, 41]);
  });

  it('keeps an expression it cannot evaluate', () => {
    const text = make('drawtext', { text: 'A', fontsize: "'h/20+t'" });

    expect(steppedFontSize(text, timing)).toEqual([text]);
  });
});
