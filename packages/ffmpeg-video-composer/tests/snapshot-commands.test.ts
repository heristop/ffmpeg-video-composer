import { describe, expect, it } from 'vitest';
import {
  frameArgs,
  parseSheet,
  safeZoneFilters,
  sanitizeLabel,
  sheetArgs,
  sheetFilter,
  toCommand,
  zoomFilter,
} from '@/services/snapshot-commands';
import { PLATFORMS } from '@/core/platforms';
import { parseCommand } from '@/platform/ffmpeg/parse-command';

describe('frameArgs', () => {
  it('seeks accurately on the input and writes one PNG', () => {
    expect(frameArgs('/v/out.mp4', 1.5, '/f/a.png', ['crop=w=10:h=10:x=0:y=0'])).toEqual([
      '-y',
      '-ss',
      '1.500',
      '-i',
      '/v/out.mp4',
      '-frames:v',
      '1',
      '-vf',
      'crop=w=10:h=10:x=0:y=0',
      '-update',
      '1',
      '/f/a.png',
    ]);
    expect(frameArgs('v.mp4', 0, 'a.png')).not.toContain('-vf');
  });
});

describe('safeZoneFilters', () => {
  it('shades every edge the platform UI covers', () => {
    expect(safeZoneFilters(PLATFORMS.tiktok.safe)).toEqual([
      'drawbox=x=0:y=0:w=iw:h=ih*0.1:color=red@0.35:t=fill',
      'drawbox=x=0:y=ih*(1-0.22):w=iw:h=ih*0.22:color=red@0.35:t=fill',
      'drawbox=x=0:y=0:w=iw*0.05:h=ih:color=red@0.35:t=fill',
      'drawbox=x=iw*(1-0.14):y=0:w=iw*0.14:h=ih:color=red@0.35:t=fill',
    ]);
    expect(safeZoneFilters({ top: 0, bottom: 0.1, left: 0, right: 0 })).toHaveLength(1);
  });
});

describe('zoomFilter', () => {
  it('crops by fractions or by pixels', () => {
    expect(zoomFilter({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 })).toBe('crop=w=iw*0.5:h=ih*0.5:x=iw*0.25:y=ih*0.5');
    expect(zoomFilter({ x: 100, y: 50, w: 640, h: 360 })).toBe('crop=w=640:h=360:x=100:y=50');
    expect(() => zoomFilter({ x: 0, y: 0, w: 0, h: 1 })).toThrow(/positive/);
  });
});

describe('sheet', () => {
  const inputs = [
    { path: '/f/1.png', label: '1.50s hook' },
    { path: '/f/2.png', label: "it's 2:00 \\ ok" },
  ];

  it('scales, labels, concatenates and tiles the frames', () => {
    expect(sheetFilter(inputs, { cols: 3, rows: 2, tileWidth: 320 }, '/fonts/Rubik.ttf')).toBe(
      "[0:v]scale=320:-2,setsar=1,format=rgb24,drawtext=fontfile='/fonts/Rubik.ttf':expansion=none:text='1.50s hook'" +
        ':fontsize=14:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6:x=8:y=h-th-12[t0];' +
        String.raw`[1:v]scale=320:-2,setsar=1,format=rgb24,drawtext=fontfile='/fonts/Rubik.ttf':expansion=none:text='it s 2\:00 ok'` +
        ':fontsize=14:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6:x=8:y=h-th-12[t1];' +
        '[t0][t1]concat=n=2:v=1:a=0,tile=3x2:padding=6:margin=6:color=0x111111[sheet]'
    );
  });

  it('letterboxes frames into a fixed tile and drops labels without drawtext', () => {
    const filter = sheetFilter(inputs, { cols: 2, rows: 1, tileWidth: 480, tileHeight: 270 }, false);

    expect(filter).toContain('scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:-1:-1:color=0x111111');
    expect(filter).not.toContain('drawtext');
  });

  it('builds a one-frame command and survives the adapter quoting', () => {
    const args = sheetArgs(inputs, { cols: 2, rows: 1 }, '/out/sheet.png');

    expect(args.slice(0, 5)).toEqual(['-y', '-i', '/f/1.png', '-i', '/f/2.png']);
    expect(args.slice(-7)).toEqual(['-map', '[sheet]', '-frames:v', '1', '-update', '1', '/out/sheet.png']);
    expect(parseCommand(toCommand([...args, '/out dir/x.png']))).toEqual([...args, '/out dir/x.png']);
    expect(() => sheetArgs(inputs, { cols: 1, rows: 1 }, '/o.png')).toThrow(/holds 1..1 frames/);
  });

  it('parses a COLSxROWS layout', () => {
    expect(parseSheet('3x2')).toEqual({ cols: 3, rows: 2 });
    expect(parseSheet('0x2')).toBeNull();
    expect(parseSheet('three')).toBeNull();
  });

  it('keeps labels inside the filtergraph quoting', () => {
    expect(sanitizeLabel(`a'b"c\\d\n e`)).toBe('a b c d e');
  });
});
