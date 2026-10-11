import type { TemplateDescriptor } from '@/src/types';
import {
  checkSummary,
  clipSlots,
  logLine,
  selectTemplates,
  type CheckRow,
} from '@/src/services/compile/all-templates-check';

const templates = [{ id: 'interview' }, { id: 'story-reel' }, { id: 'square-promo' }];

describe('selectTemplates', () => {
  it('keeps every bundled template without a filter', () => {
    expect(selectTemplates(templates).map((t) => t.id)).toEqual(['interview', 'story-reel', 'square-promo']);
  });

  it('keeps only the ids listed in ?only=, in catalog order', () => {
    expect(selectTemplates(templates, 'square-promo,interview').map((t) => t.id)).toEqual([
      'interview',
      'square-promo',
    ]);
  });

  it('treats an empty ?only= as no filter', () => {
    expect(selectTemplates(templates, '')).toHaveLength(3);
  });
});

describe('clipSlots', () => {
  it('fills every project_video section with the sample clip, and nothing else', () => {
    const descriptor = {
      sections: [
        { name: 'intro', type: 'color_background' },
        { name: 'talk', type: 'project_video' },
        { name: 'outro', type: 'project_video' },
      ],
    } as unknown as TemplateDescriptor;

    expect(clipSlots(descriptor, 'file:///sample.mp4', 'portrait')).toEqual({
      talk: { path: 'file:///sample.mp4', orientation: 'portrait' },
      outro: { path: 'file:///sample.mp4', orientation: 'portrait' },
    });
  });

  it('returns no slots for a template without recorded sections', () => {
    expect(clipSlots({ sections: [] } as unknown as TemplateDescriptor, 'x.mp4', 'landscape')).toEqual({});
  });
});

describe('checkSummary and logLine', () => {
  const rows: CheckRow[] = [
    { id: 'interview', status: 'OK', secs: 6.4, info: '812 KB' },
    { id: 'story-reel', status: 'FAIL', secs: 1.25, info: 'unknown' },
    { id: 'square-promo', status: 'RUN' },
  ];

  it('counts passes over the templates started so far', () => {
    expect(checkSummary(rows, false)).toBe('Running… 1/3');
    expect(checkSummary(rows, true)).toBe('DONE 1/3 OK');
  });

  it('writes one greppable log line per template', () => {
    expect(logLine(rows[0])).toBe('LECLAP_ALLTEMPLATES interview=OK secs=6.4 812 KB');
    expect(logLine(rows[1])).toBe('LECLAP_ALLTEMPLATES story-reel=FAIL secs=1.3 unknown');
  });
});
