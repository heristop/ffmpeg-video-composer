import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatValidation, exitCodeFor, bracketPath } from '../src/commands/validate';

const validateTemplateMock = vi.fn();
const getMotionWarningsMock = vi.fn((): unknown[] => []);
const nodeGeometryWarningsMock = vi.fn();
const renderedGeometryWarningsMock = vi.fn();
const templateFontErrorsMock = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);

vi.mock('ffmpeg-video-composer', () => ({
  TemplateValidator: vi.fn().mockImplementation(function TemplateValidatorMock() {
    return {
      validateTemplate: validateTemplateMock,
      getMotionWarnings: getMotionWarningsMock,
    };
  }),
  geometryApproxNote: (w: { approx: boolean }) => (w.approx ? ' (approx: font unavailable, width estimated)' : ''),
  nodeGeometryWarnings: (...args: unknown[]) => nodeGeometryWarningsMock(...args),
  renderedGeometryWarnings: (...args: unknown[]) => renderedGeometryWarningsMock(...args),
  templateFontErrors: (...args: unknown[]) => templateFontErrorsMock(...args),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => '{"sections":[]}'),
  },
}));

// picocolors honours NO_COLOR; strip any ANSI so assertions match the text regardless of env.
const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

describe('formatValidation', () => {
  it('reports a valid template on one line', () => {
    const lines = formatValidation({ success: true, errors: [] }).map(plain);
    expect(lines.join('\n')).toContain('valid');
    expect(lines.some((l) => l.includes('✗'))).toBe(false);
  });

  it('lists each error as "✗ <path> — <message>"', () => {
    const lines = formatValidation({
      success: false,
      errors: [
        { path: 'sections[0].type', message: 'unknown section type', code: 'invalid' },
        { path: 'global.music.url', message: 'must be a url', code: 'invalid_url' },
      ],
    }).map(plain);

    const text = lines.join('\n');
    expect(text).toContain('✗ sections[0].type — unknown section type');
    expect(text).toContain('✗ global.music.url — must be a url');
    expect(text).toContain('2'); // a count of problems is surfaced
  });

  it('prints a "→ hint" line under an error that has a known fix', () => {
    const lines = formatValidation({
      success: false,
      errors: [
        {
          path: 'sections.0.options.colour',
          message: 'Unknown key "colour"',
          code: 'unknown_key',
          hint: 'Rename "colour" to "backgroundColor".',
          suggestion: 'backgroundColor',
          kind: 'format',
        },
        { path: 'sections.1.type', message: 'bad type', code: 'invalid_type' },
      ],
    }).map(plain);

    const index = lines.findIndex((line) => line.includes('✗ sections[0].options.colour'));
    expect(lines[index + 1]).toContain('→ Rename "colour" to "backgroundColor".');
    expect(lines.filter((line) => line.includes('→'))).toHaveLength(1);
  });

  it('falls back gracefully when there are no error details', () => {
    const lines = formatValidation({ success: false }).map(plain);
    expect(lines.join('\n').toLowerCase()).toContain('invalid');
  });
});

describe('formatValidation with geometry warnings', () => {
  it('prints warnings even when the template is valid', () => {
    const output = formatValidation({
      success: true,
      warnings: [
        {
          path: 'sections[0].caption',
          message: 'overflows the safe width by 84px',
          code: 'text_overflow',
          severity: 'warn',
          approx: false,
        },
      ],
    })
      .map(plain)
      .join('\n');

    expect(output).toContain('sections[0].caption');
    expect(output).toContain('overflows');
  });

  it('still reports success when the only findings are warnings', () => {
    const output = formatValidation({
      success: true,
      warnings: [
        { path: 'sections[0].caption', message: 'too small', code: 'text_too_small', severity: 'warn', approx: false },
      ],
    })
      .map(plain)
      .join('\n');

    // The exit code is driven by `success`, and a warning must never change it — otherwise
    // `leclap validate` becomes unusable as a CI gate.
    expect(output).toContain('valid');
  });

  it('is unchanged for a clean template', () => {
    expect(formatValidation({ success: true }).map(plain).join('\n')).toContain('valid');
  });
});

describe('exitCodeFor', () => {
  it('is 0 when the template is valid, even with warnings present', () => {
    expect(
      exitCodeFor({
        success: true,
        warnings: [
          {
            path: 'sections[0].caption',
            message: 'too small',
            code: 'text_too_small',
            severity: 'warn',
            approx: false,
          },
        ],
      })
    ).toBe(0);
  });

  it('is 1 when the template is invalid', () => {
    expect(exitCodeFor({ success: false })).toBe(1);
  });
});

// End-to-end pin: exercises the actual `validate` command (not just the pure formatter/exit helpers)
// against a mocked engine, so a future change that lets a warning leak into `errors` — or otherwise
// flips `success` — fails here even if it never touches `formatValidation` or `exitCodeFor` directly.
describe('validate command exit code with geometry warnings', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    // The command sets `process.exitCode` rather than calling `process.exit()`, so leaving it set
    // would fail the whole vitest run — restore whatever the runner had.
    process.exitCode = previousExitCode;
    writeSpy.mockRestore();
  });

  it('never exits 1 when the template is valid but geometry warnings are found', async () => {
    validateTemplateMock.mockReturnValue({ success: true, data: { sections: [] } });
    nodeGeometryWarningsMock.mockResolvedValue([
      {
        path: 'sections[0].caption',
        message: 'overflows the safe width by 84px',
        code: 'text_overflow',
        severity: 'warn',
        approx: true,
      },
    ]);

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true } } as never);

    expect(process.exitCode).toBe(0);

    const out = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(out).toContain('"success":true');
    expect(out).toContain('overflows the safe width by 84px');
  });

  it('still exits 1 for a genuinely invalid template regardless of warnings', async () => {
    validateTemplateMock.mockReturnValue({
      success: false,
      errors: [{ path: 'sections[0].type', message: 'unknown section type', code: 'invalid' }],
    });
    nodeGeometryWarningsMock.mockResolvedValue([]);

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true } } as never);

    expect(process.exitCode).toBe(1);
  });

  it('emits hint, suggestion and kind unchanged with --json', async () => {
    const finding = {
      path: 'sections.0.look',
      message: 'bad look',
      code: 'invalid_value',
      hint: 'Use one of: "warm".',
      suggestion: 'warm',
      kind: 'format',
    };
    validateTemplateMock.mockReturnValue({ success: false, errors: [finding] });

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true } } as never);

    const out = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(JSON.parse(out).errors).toEqual([finding]);
  });

  // The loader wiring now lives in the engine (`nodeGeometryWarnings`), shared with the MCP server.
  // This pins that the command still routes through it, with the descriptor as the author wrote it.
  it('asks the engine for geometry warnings on the raw descriptor', async () => {
    validateTemplateMock.mockReturnValue({ success: true, data: { sections: [], expanded: true } });
    nodeGeometryWarningsMock.mockResolvedValue([]);

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true } } as never);

    expect(nodeGeometryWarningsMock).toHaveBeenCalledWith({ sections: [] }, expect.anything());
  });
});

describe('template fonts', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    writeSpy.mockRestore();
  });

  it('opens global.fonts from the template dir, then --fonts, then ./assets, and fails on a file it cannot use', async () => {
    const finding = {
      path: 'global.fonts[0].src',
      code: 'font_not_found',
      message: 'global.fonts[0] (Ubuntu): "Ubuntu.ttf" was not found',
      kind: 'judgement',
    };
    validateTemplateMock.mockReturnValue({ success: true, data: { sections: [] } });
    nodeGeometryWarningsMock.mockResolvedValue([]);
    templateFontErrorsMock.mockResolvedValueOnce([finding]);

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({
      args: { template: 'tpl/promo.json', json: true },
      rawArgs: ['tpl/promo.json', '--fonts', 'brand'],
    } as never);

    const [, options] = templateFontErrorsMock.mock.calls[0] as unknown as [
      unknown,
      { fontDirs: string[]; assetsDir: string },
    ];
    const out = JSON.parse(writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(''));

    expect(options.fontDirs).toEqual([`${process.cwd()}/tpl`, `${process.cwd()}/brand`]);
    expect(options.assetsDir).toBe(`${process.cwd()}/assets`);
    expect(out.success).toBe(false);
    expect(out.errors).toEqual([finding]);
    expect(process.exitCode).toBe(1);
  });
});

describe('one report, one notation', () => {
  it('writes schema error paths the way findings and agents address them', () => {
    expect(bracketPath('sections.1.caption.font')).toBe('sections[1].caption.font');
    expect(bracketPath('partials.0.sections.2')).toBe('partials[0].sections[2]');
    expect(bracketPath('global.orientation')).toBe('global.orientation');
  });

  it('counts warnings in the headline and names each location once', () => {
    const warning = {
      path: 'sections[0].caption',
      message: 'Section "a" caption is 8px, too small to read on a phone — use at least 18px',
      code: 'text_too_small',
      severity: 'warn' as const,
      approx: true,
    };
    const lines = formatValidation({ success: true, warnings: [warning, warning] }).map(plain);

    expect(lines[0]).toContain('Template is valid — 2 warnings');
    expect(lines[1]).toContain('(approx: font unavailable, width estimated) sections[0].caption');
    expect(lines[1].match(/sections\[0\]\.caption/g)).toHaveLength(1);
  });
});

describe('the rendered check (--render)', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let previousExitCode: typeof process.exitCode;
  const previousLogLevel = process.env.LECLAP_LOG_LEVEL;
  const finding = {
    path: 'sections[0].caption',
    message: 'Section "a" caption renders at 1.2:1 against what surrounds it',
    code: 'text_low_contrast_rendered',
    severity: 'warn' as const,
    approx: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    process.env.LECLAP_LOG_LEVEL = previousLogLevel;
    writeSpy.mockRestore();
  });

  it('says how many texts it measured and how long the render took', () => {
    const lines = formatValidation({ success: true, warnings: [finding], render: { measured: 2, seconds: 3.4 } }).map(
      plain
    );

    expect(lines.at(-1)).toContain('rendered check: 2 texts measured from pixels in 3.4s');
  });

  it('says why it did not render, instead of implying the template came out clean', () => {
    const lines = formatValidation({
      success: true,
      render: { measured: 0, seconds: 0.1, unavailable: 'the rendered check needs a native FFmpeg' },
    }).map(plain);

    expect(lines.at(-1)).toContain('rendered check skipped — the rendered check needs a native FFmpeg');
  });

  it('renders against the caller’s assets dir, silences the engine, and never flips the exit code', async () => {
    validateTemplateMock.mockReturnValue({ success: true, data: { sections: [] } });
    renderedGeometryWarningsMock.mockResolvedValue({ warnings: [finding], measured: 1 });

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true, render: true } } as never);

    expect(nodeGeometryWarningsMock).not.toHaveBeenCalled();
    expect(renderedGeometryWarningsMock).toHaveBeenCalledWith(
      { sections: [] },
      { assetsDir: expect.stringMatching(/assets$/) }
    );
    expect(process.env.LECLAP_LOG_LEVEL).toBe('silent');
    expect(process.exitCode).toBe(0);

    const out = JSON.parse(writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(''));

    expect(out.warnings).toEqual([finding]);
    expect(out.render).toMatchObject({ measured: 1 });
  });

  it('does not render a template that failed validation', async () => {
    validateTemplateMock.mockReturnValue({
      success: false,
      errors: [{ path: 'sections[0].type', message: 'unknown section type', code: 'invalid' }],
    });

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true, render: true } } as never);

    expect(renderedGeometryWarningsMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe('motion warnings', () => {
  const finding = {
    path: 'sections[1]',
    code: 'dead_air',
    message: 'Section "hold": nothing moves for 3.1s (0.9s–4s)',
    severity: 'warn' as const,
    hint: 'Add a slow camera move (push-in, drift), a late supporting reveal, or shorten the section.',
  };

  it('prints each finding with its code, path and hint, counted in the headline', () => {
    const lines = formatValidation({ success: true, motionWarnings: [finding] }).map(plain);

    expect(lines[0]).toContain('Template is valid — 1 warning');
    expect(lines[1]).toContain('nothing moves for 3.1s');
    expect(lines[1]).toContain('sections[1] dead_air');
    expect(lines[2]).toContain('Add a slow camera move');
  });

  it('attaches them to a valid template without changing the exit code, and skips invalid ones', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    validateTemplateMock.mockReturnValue({ success: true, data: { sections: [] } });
    nodeGeometryWarningsMock.mockResolvedValue([]);
    getMotionWarningsMock.mockReturnValue([finding]);

    const { validate } = await import('../src/commands/validate');
    await validate.run?.({ args: { template: 'template.json', json: true } } as never);
    const out = JSON.parse(writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(''));

    expect(process.exitCode).toBe(0);
    expect(out.motionWarnings).toEqual([finding]);

    writeSpy.mockClear();
    getMotionWarningsMock.mockClear();
    validateTemplateMock.mockReturnValue({ success: false, errors: [{ path: 'x', message: 'bad', code: 'c' }] });
    await validate.run?.({ args: { template: 'template.json', json: true } } as never);

    expect(getMotionWarningsMock).not.toHaveBeenCalled();
    process.exitCode = previousExitCode;
    writeSpy.mockRestore();
  });
});
