// Music-cover backdrops drawn in canvas coordinates: cities, confetti, water, awnings, notes, pixel art.
import { C, SIZE, f, list, note, num, str, type Shape } from './music-covers-primitives.ts';

export const skyline: Shape = (l, { rnd }) => {
  const base = num(l, 'base', 360);
  const [left, right] = [num(l, 'left', -10), num(l, 'right', SIZE + 10)];
  const [minH, maxH] = [num(l, 'minH', 60), num(l, 'maxH', 200)];
  const [color, light, lit] = [str(l, 'color', C.ink2), str(l, 'light', C.yellow), num(l, 'lit', 0.3)];
  let out = '';

  for (let x = left; x < right;) {
    const w = Math.min(24 + rnd() * 44, right - x);
    const h = minH + rnd() * (maxH - minH);
    out += `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h)}" fill="${color}"/>`;

    for (let wy = base - h + 10; wy < base - 12; wy += 14) {
      for (let wx = x + 6; wx < x + w - 8; wx += 11) {
        if (rnd() < lit) out += `<rect x="${f(wx)}" y="${f(wy)}" width="5" height="7" fill="${light}" opacity="0.85"/>`;
      }
    }

    x += w + 2;
  }

  return `${out}<rect x="${left}" y="${base}" width="${right - left}" height="${SIZE - base}" fill="${color}"/>`;
};

export const rooftops: Shape = (l, { rnd }) => {
  const base = num(l, 'base', 340);
  const [color, roof, lit] = [str(l, 'color', C.ink2), str(l, 'roof', C.night), str(l, 'lit', C.amber)];
  let out = '';

  for (let x = -10; x < SIZE + 10;) {
    const w = 70 + rnd() * 50;
    const top = base - (50 + rnd() * 60);
    out += `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(base - top)}" fill="${color}"/>`;
    out += `<path d="M${f(x)} ${f(top)} L${f(x + 10)} ${f(top - 26)} L${f(x + w - 10)} ${f(top - 26)} L${f(x + w)} ${f(top)}Z" fill="${roof}"/>`;
    out += `<rect x="${f(x + w * 0.7)}" y="${f(top - 42)}" width="10" height="18" fill="${roof}"/>`;

    for (let dx = 18; dx < w - 18; dx += 26) {
      const on = rnd() < 0.45;
      out += `<rect x="${f(x + dx)}" y="${f(top - 18)}" width="10" height="12" rx="5" fill="${on ? lit : color}"/>`;
      out += `<rect x="${f(x + dx)}" y="${f(top + 14)}" width="10" height="16" fill="${rnd() < 0.35 ? lit : roof}" opacity="0.9"/>`;
    }

    x += w + 4;
  }

  return `${out}<rect x="0" y="${base}" width="${SIZE}" height="${SIZE - base}" fill="${color}"/>`;
};

export const confetti: Shape = (l, { rnd }) => {
  const colors = list<string>(l, 'colors');
  const bottom = num(l, 'bottom', 360);
  let out = '';

  for (let i = 0; i < num(l, 'count', 50); i += 1) {
    const [x, y] = [f(rnd() * SIZE), f(rnd() * bottom)];
    const color = colors[i % colors.length] ?? C.pink;

    if (i % 4 === 0) {
      out += `<circle cx="${x}" cy="${y}" r="${f(2.5 + rnd() * 2.5)}" fill="${color}"/>`;
      continue;
    }

    out += `<rect x="${x}" y="${y}" width="${f(7 + rnd() * 7)}" height="${f(4 + rnd() * 3)}" rx="1.5" fill="${color}" transform="rotate(${f(rnd() * 180)} ${x} ${y})"/>`;
  }

  return out;
};

export const waves: Shape = (l) => {
  const [y, amp, rows] = [num(l, 'y', 280), num(l, 'amp', 8), num(l, 'rows', 3)];
  const color = str(l, 'color', C.lav);
  let out = '';

  for (let k = 0; k < rows; k += 1) {
    const yk = y + k * 24;
    let d = `M0 ${SIZE} L0 ${yk}`;

    for (let x = 0; x <= SIZE; x += 8) d += ` L${x} ${f(yk + amp * Math.sin((x / 64) * Math.PI * 2 + k * 1.7))}`;

    out += `<path d="${d} L${SIZE} ${SIZE}Z" fill="${color}" opacity="${k === 0 ? 0.85 : 0.45}"/>`;
  }

  return out;
};

export const awning: Shape = (l) => {
  const stripes = list<string>(l, 'stripes');
  const depth = num(l, 'depth', 70);
  let out = `<rect x="0" y="${depth}" width="${SIZE}" height="${depth * 0.5}" fill="${C.ink}" opacity="0.12"/>`;

  for (let i = 0; i < 8; i += 1) {
    const color = stripes[i % stripes.length] ?? C.pink;
    out += `<rect x="${i * 64}" y="0" width="64" height="${depth}" fill="${color}"/><path d="M${i * 64} ${depth} a32 32 0 0 0 64 0Z" fill="${color}"/>`;
  }

  return out;
};

export const rect: Shape = (l) =>
  `<rect x="${num(l, 'x', 0)}" y="${num(l, 'y', 0)}" width="${num(l, 'w', SIZE)}" height="${num(l, 'h', SIZE)}" rx="${num(l, 'rx', 0)}" fill="${str(l, 'color', C.ink2)}"/>`;

export const notes: Shape = (l) => {
  const points = list<number>(l, 'points');
  const [color, size] = [str(l, 'color', C.lav), num(l, 'size', 1)];
  let out = '';

  for (let i = 0; i + 1 < points.length; i += 2) out += note(points[i], points[i + 1], size, color, i % 4 === 2);

  return out;
};

export const pixelNight: Shape = (l, { rnd }) => {
  const px = (x: number, y: number, s: number, color: string) =>
    `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}"/>`;
  const bitmap = (rows: string[], x0: number, y0: number, s: number, color: string) =>
    rows
      .flatMap((row, r) => Array.from(row, (cell, c) => (cell === '#' ? px(x0 + c * s, y0 + r * s, s, color) : '')))
      .join('');
  const moon = ['..####..', '.####...', '####....', '####....', '####....', '####....', '.####...', '..####..'];
  const glyphs: Record<string, string[]> = {
    '2': ['###', '..#', '###', '#..', '###'],
    '0': ['###', '#.#', '#.#', '#.#', '###'],
    ':': ['.', '#', '.', '#', '.'],
  };
  const [frame, digits, star] = [str(l, 'frame', C.lav), str(l, 'digits', C.pink), str(l, 'star', C.cream)];
  let out = '';

  for (let i = 0; i < 22; i += 1) {
    out += px(Math.floor(rnd() * 64) * 8, Math.floor(rnd() * 20) * 8, i % 5 === 0 ? 8 : 4, star);
  }

  out += bitmap(moon, 352, 40, 13, str(l, 'moon', C.yellow));
  out += `<rect x="96" y="172" width="320" height="152" fill="${C.ink}"/>`;
  out += `<rect x="96" y="172" width="320" height="12" fill="${frame}"/><rect x="96" y="312" width="320" height="12" fill="${frame}"/>`;
  out += `<rect x="96" y="172" width="12" height="152" fill="${frame}"/><rect x="404" y="172" width="12" height="152" fill="${frame}"/>`;
  out += `<rect x="120" y="196" width="12" height="12" fill="${frame}" opacity="0.5"/>`;

  let x = 152;

  for (const char of '2:00') {
    const rows = glyphs[char] ?? [];
    out += bitmap(rows, x + 4, 212, 16, C.night) + bitmap(rows, x, 208, 16, digits);
    x += (rows[0]?.length ?? 1) * 16 + 16;
  }

  return out;
};
