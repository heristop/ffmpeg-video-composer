import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { escapeDrawtextText, typographicText } from '../src/core/drawtext-text';
import { counterText } from '../src/core/kinetic/extras';
import { parseCommand } from '../src/platform/ffmpeg/parse-command';

const execFileAsync = promisify(execFile);
const FONT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../leclap-creative-kit/src/library/fonts/Rubik.ttf'
);

function hasDrawtext(): boolean {
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });

  return probe.status === 0 && probe.stdout.includes(' drawtext ');
}

describe('escapeDrawtextText', () => {
  it('escapes the option separator, the expansion sigil and the escape character', () => {
    expect(escapeDrawtextText('a:b')).toBe(String.raw`a\:b`);
    expect(escapeDrawtextText('100%')).toBe(String.raw`100\\\%`);
    expect(escapeDrawtextText(String.raw`C:\dir`)).toBe(String.raw`C\:\\\\dir`);
  });

  it('draws quotes typographically so they cannot close the value or the argv token', () => {
    expect(escapeDrawtextText(`it's "here"`)).toBe('it’s ”here”');
  });

  it('leaves filtergraph punctuation, newlines, emoji and CJK alone inside the quoted value', () => {
    expect(escapeDrawtextText('[0:v];a,b=c\n😀 中文')).toBe('[0\\:v];a,b=c\n😀 中文');
  });

  it('drops control characters that cannot be drawn (a NUL would truncate the argv)', () => {
    expect(escapeDrawtextText('a\u0000b\u0007c\td')).toBe('abc\td');
  });

  it('escapes counter prefix/suffix the same way, keeping their backslashes', () => {
    const text = counterText({ from: 0, to: 1, prefix: '\\$', suffix: '%:' }, { delay: 0, duration: 1 }, 'linear');

    expect(text.startsWith(String.raw`\\\\$%{eif`)).toBe(true);
    expect(text.endsWith(String.raw`\\\%\:`)).toBe(true);
  });
});

// Deterministic PRNG so a failure reproduces.
function mulberry32(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [
  "'",
  '"',
  '%',
  '%{',
  '%{pts}',
  ':',
  ',',
  '\\',
  '[',
  ']',
  ';',
  '=',
  '{',
  '}',
  '\n',
  ' ',
  '\t',
  'a',
  'Z',
  '7',
  'é',
  'ß',
  '😀',
  '👍🏽',
  '中',
  '文',
  '$',
];

function randomText(next: () => number): string {
  const length = 1 + Math.floor(next() * 20);

  return Array.from({ length }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join('');
}

const FIXED = [
  '100%',
  'a:b',
  String.raw`C:\path\file`,
  "it's",
  'say "hi"',
  '%{pts}',
  String.raw`%{eif\:1\:d}`,
  '\\',
  'end\\',
  String.raw`\%`,
  '%%',
  '[0:v];[1:v]',
  'a,b=c',
  'line1\nline2',
  '😀 emoji 中文',
];

// What drawtext is expected to draw: the typographic text with controls dropped and the edges trimmed
// by FFmpeg's option parser.
function expectedDrawn(input: string): string {
  return typographicText(input)
    .replace(/\p{Cc}/gu, (char: string) => (char === '\n' || char === '\t' ? char : ''))
    .replace(/^[ \n\t\r]+|[ \n\t\r]+$/g, '');
}

describe.skipIf(!hasDrawtext())('drawtext round trip through a real FFmpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawtext-text-'));

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  // One frame's md5. The command string goes through parseCommand exactly as every adapter does.
  async function frameDigest(textOption: string): Promise<string> {
    const command = `-v error -f lavfi -i color=c=black:s=1280x240:d=1 -vf "drawtext=fontfile='${FONT}':fontsize=22:fontcolor=white:x=8:y=8:${textOption}" -frames:v 1 -f framemd5 -`;
    const { stdout } = await execFileAsync('ffmpeg', parseCommand(command));

    return String(stdout.trim().split('\n').at(-1)?.split(',').at(-1)).trim();
  }

  // The oracle: the expected string read verbatim from a file, with expansion disabled.
  async function oracleDigest(expected: string, index: number): Promise<string> {
    const file = path.join(dir, `expected-${index}.txt`);

    fs.writeFileSync(file, expected);

    return frameDigest(`textfile='${file}':expansion=none`);
  }

  async function assertRoundTrip(raw: string, index: number): Promise<void> {
    // An all-whitespace string draws nothing either way; anchor it so the frame has something to compare.
    const input = expectedDrawn(raw) === '' ? `${raw}x` : raw;
    const drawn = await frameDigest(`text='${escapeDrawtextText(input)}'`);

    expect(drawn, JSON.stringify(input)).toBe(await oracleDigest(expectedDrawn(input), index));
  }

  it('draws a fixed set of hostile strings exactly', async () => {
    for (const [index, text] of FIXED.entries()) await assertRoundTrip(text, index);
  }, 60_000);

  it('draws random strings of reserved characters, emoji and CJK exactly', async () => {
    const next = mulberry32(0x1eaf);

    for (let index = 0; index < 40; index++) await assertRoundTrip(randomText(next), 100 + index);
  }, 120_000);
});
