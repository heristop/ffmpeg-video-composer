import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TemplateDescriptorSchema, TemplateValidator } from 'ffmpeg-video-composer';
import { studioFiles } from '../src/studio-files';
import { GATES, passGate, studioStatus } from '../src/studio';
import { formatStudioStatus, scaffoldStudio } from '../src/commands/studio';
import { rewriteArgv, KNOWN_COMMANDS } from '../src/args';

const NOW = new Date('2026-01-02T03:04:05.000Z');

describe('studioFiles', () => {
  const files = studioFiles('launch', NOW);

  it('scaffolds the production folder', () => {
    expect(Object.keys(files).sort()).toEqual([
      'assets/.gitkeep',
      'brief.md',
      'out/.gitkeep',
      'reviews/README.md',
      'shotlist.md',
      'studio.json',
      'style-guide.md',
      'template.json',
    ]);
  });

  it('writes the brief, style guide, shot list and review sections', () => {
    for (const heading of ['## The film in one line', '## Audience', '## Duration and formats', '## Approved assets']) {
      expect(files['brief.md']).toContain(heading);
    }

    for (const heading of ['## Approved copy', '## Keep / avoid', '## Never invent']) {
      expect(files['brief.md']).toContain(heading);
    }

    for (const heading of [
      '## Palette',
      '## Type',
      '## Composition',
      '## Pacing',
      '## Motion roles',
      '## Banned defaults',
    ]) {
      expect(files['style-guide.md']).toContain(heading);
    }

    expect(files['shotlist.md']).toContain('| Time | Role | Entry state | Exit state | Purpose |');
    expect(files['reviews/README.md']).toContain('Local fix');
    expect(files['reviews/README.md']).toContain('Evidence');
  });

  it('wires template.json to the brief: one section per shot-list beat with purpose and role', () => {
    const template = JSON.parse(files['template.json']);
    const beats = files['shotlist.md'].split('\n').filter((line) => /^\| \d/.test(line));

    expect(template.meta.brief).toBe('brief.md');
    expect(template.meta.creativeDirection).toContain('brief.md');
    expect(template.global.theme).toBe('editorial');
    expect(template.sections).toHaveLength(beats.length);

    for (const [index, section] of template.sections.entries()) {
      expect(section.purpose.length).toBeGreaterThan(0);
      expect(beats[index]).toContain(`| ${section.role} |`);
      expect(beats[index]).toContain(section.purpose);
    }
  });

  it('produces a valid template that already satisfies the purpose and hold advisories', () => {
    const template = JSON.parse(files['template.json']);
    const validator = new TemplateValidator();

    expect(TemplateDescriptorSchema.safeParse(template).success).toBe(true);
    expect(validator.validateTemplate(template).errors ?? []).toEqual([]);

    const codes = validator.getMotionWarnings(template).map((warning) => warning.code);

    expect(codes).not.toContain('section_without_purpose');
    expect(codes).not.toContain('headline_hold_short');
  });

  it('records every gate as not passed yet', () => {
    const manifest = JSON.parse(files['studio.json']);

    expect(manifest.createdAt).toBe(NOW.toISOString());
    expect(Object.keys(manifest.gates)).toEqual(GATES.map((gate) => gate.id));
    expect(Object.values(manifest.gates).every((value) => value === null)).toBe(true);
  });
});

describe('studio status and gates', () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'leclap-studio-')), 'film');
    await scaffoldStudio(dir, NOW);
  });

  afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

  it('refuses to scaffold over a non-empty folder', async () => {
    await expect(scaffoldStudio(dir, NOW)).rejects.toThrow(/not empty/);
  });

  it('starts at assets-approved, missing approved assets', () => {
    const status = studioStatus(dir);

    expect(status.next?.gate.id).toBe('assets-approved');
    expect(status.next?.missing.map((artifact) => artifact.path)).toEqual(['assets']);

    const text = formatStudioStatus(status).join('\n');

    expect(text).toContain('Next gate:');
    expect(text).toContain('at least one approved file in assets/');
  });

  it('passes gates in order once their artifacts exist, stamping the time', () => {
    expect(() => passGate(dir, 'assets-approved', { now: NOW })).toThrow(/missing/);
    expect(() => passGate(dir, 'style-approved', { now: NOW })).toThrow(/before/);

    writeFileSync(path.join(dir, 'assets', 'logo.png'), '');
    passGate(dir, 'assets-approved', { now: NOW });
    passGate(dir, 'style-approved', { now: NOW });

    const manifest = JSON.parse(readFileSync(path.join(dir, 'studio.json'), 'utf8'));
    const status = studioStatus(dir);

    expect(manifest.gates['assets-approved']).toBe(NOW.toISOString());
    expect(status.next?.gate.id).toBe('stills-checked');
    expect(status.next?.missing.map((artifact) => artifact.path)).toEqual(['reviews']);
  });

  it('reports delivered once every gate is passed', () => {
    for (const gate of GATES) passGate(dir, gate.id, { now: NOW, force: true });

    const status = studioStatus(dir);

    expect(status.next).toBeUndefined();
    expect(formatStudioStatus(status).join('\n')).toContain('Delivered');
  });

  it('rejects an unknown gate and a folder without studio.json', () => {
    expect(() => passGate(dir, 'approved')).toThrow(/unknown gate/);
    expect(() => studioStatus(path.dirname(dir))).toThrow(/studio\.json not found/);
  });
});

describe('studio command routing', () => {
  it('is a known subcommand, not a render shorthand', () => {
    expect(rewriteArgv(['studio', 'status'], KNOWN_COMMANDS)).toEqual(['studio', 'status']);
  });
});
