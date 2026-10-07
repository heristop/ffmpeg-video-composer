// Music-cover scenery drawn in canvas coordinates: skies, weather and windows (see gen-music-covers.ts).
import { C, SIZE, LEAF, SPARKLE, f, list, num, seeded, str, type Shape } from './music-covers-primitives.ts';

// --- absolute shapes (canvas coordinates) ----------------------------------------------------------------

export const stars: Shape = (l, { rnd }) => {
  const [top, bottom] = [num(l, 'top', 0), num(l, 'bottom', 300)];
  const [left, right] = [num(l, 'left', 0), num(l, 'right', SIZE)];
  const color = str(l, 'color', C.cream);
  let out = '';

  for (let i = 0; i < num(l, 'count', 30); i += 1) {
    const [x, y] = [left + rnd() * (right - left), top + rnd() * (bottom - top)];
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + rnd() * 1.8)}" fill="${color}" opacity="${f(0.45 + rnd() * 0.55)}"/>`;
  }

  for (let i = 0; i < num(l, 'sparkles', 0); i += 1) {
    const [x, y] = [left + rnd() * (right - left), top + rnd() * (bottom - top)];
    out += `<path transform="translate(${f(x)} ${f(y)}) scale(${f(0.6 + rnd() * 0.7)})" d="${SPARKLE}" fill="${color}"/>`;
  }

  return out;
};

export const hills: Shape = (l) => {
  const rnd = seeded(num(l, 'seed', 1));
  const [base, amp] = [num(l, 'base', 300), num(l, 'amp', 20)];
  const [f1, f2, p1, p2] = [0.8 + rnd(), 2 + rnd() * 2, rnd() * 6, rnd() * 6];
  let d = `M0 ${SIZE}`;

  for (let x = 0; x <= SIZE; x += 8) {
    const t = (x / SIZE) * Math.PI * 2;
    d += ` L${x} ${f(base - amp * (0.6 * Math.sin(t * f1 + p1) + 0.4 * Math.sin(t * f2 + p2)))}`;
  }

  return `<path d="${d} L${SIZE} ${SIZE}Z" fill="${str(l, 'color', C.ink2)}"/>`;
};

export const pines: Shape = (l) => {
  const rnd = seeded(num(l, 'seed', 2));
  const [base, count] = [num(l, 'base', 300), num(l, 'count', 6)];
  const [minH, maxH] = [num(l, 'minH', 80), num(l, 'maxH', 150)];
  const color = str(l, 'color', C.ink2);
  let out = '';

  for (let i = 0; i < count; i += 1) {
    const x = ((i + 0.5) * SIZE) / count + (rnd() - 0.5) * 40;
    const h = minH + rnd() * (maxH - minH);
    const w = h * 0.5;

    for (let k = 0; k < 3; k += 1) {
      const top = base - h + k * h * 0.22;
      const bottom = top + h * 0.42;
      const half = w * (0.28 + 0.12 * k);
      out += `<path d="M${f(x)} ${f(top)} L${f(x + half)} ${f(bottom)} L${f(x - half)} ${f(bottom)}Z" fill="${color}"/>`;
    }

    out += `<rect x="${f(x - w * 0.06)}" y="${f(base - h * 0.16)}" width="${f(w * 0.12)}" height="${f(h * 0.16)}" fill="${color}"/>`;
  }

  return `${out}<rect x="0" y="${base}" width="${SIZE}" height="${SIZE - base}" fill="${color}"/>`;
};

export const snow: Shape = (l, { rnd }) => {
  const [top, bottom] = [num(l, 'top', 0), num(l, 'bottom', 340)];
  const color = str(l, 'color', C.cream);
  let out = '';

  for (let i = 0; i < num(l, 'count', 50); i += 1) {
    const [x, y] = [f(rnd() * SIZE), f(top + rnd() * (bottom - top))];

    if (i % 7 === 0) {
      const r = 6 + rnd() * 5;
      const arms = [0, 60, 120]
        .map((a) => `<line x1="${-r}" y1="0" x2="${r}" y2="0" transform="rotate(${a})"/>`)
        .join('');
      out += `<g transform="translate(${x} ${y})" stroke="${color}" stroke-width="1.8" stroke-linecap="round">${arms}</g>`;
      continue;
    }

    out += `<circle cx="${x}" cy="${y}" r="${f(1.2 + rnd() * 2.6)}" fill="${color}" opacity="${f(0.5 + rnd() * 0.5)}"/>`;
  }

  return out;
};

export const rain: Shape = (l, { rnd }) => {
  const [top, bottom] = [num(l, 'top', 0), num(l, 'bottom', 340)];
  const angle = (num(l, 'angle', 12) * Math.PI) / 180;
  const color = str(l, 'color', C.ice);
  let out = '';

  for (let i = 0; i < num(l, 'count', 60); i += 1) {
    const [x, y, len] = [rnd() * SIZE, top + rnd() * (bottom - top), 16 + rnd() * 18];
    out += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - Math.sin(angle) * len)}" y2="${f(y + Math.cos(angle) * len)}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" opacity="${f(0.3 + rnd() * 0.45)}"/>`;
  }

  return out;
};

export const windowShape: Shape = (l) => {
  const [x, y, w, h] = [num(l, 'wx', 60), num(l, 'wy', 30), num(l, 'ww', 390), num(l, 'wh', 290)];
  const frame = str(l, 'frame', C.cream);
  const bars = str(l, 'bars', 'cross');
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${frame}" stroke-width="10"/>`;
  const barLines: Record<string, string> = {
    cross: line(x + w / 2, y, x + w / 2, y + h) + line(x, y + h * 0.45, x + w, y + h * 0.45),
    vertical: line(x + w / 2, y, x + w / 2, y + h),
    grid:
      line(x + w / 3, y, x + w / 3, y + h) +
      line(x + (2 * w) / 3, y, x + (2 * w) / 3, y + h) +
      line(x, y + h * 0.4, x + w, y + h * 0.4),
    none: '',
  };
  const sill = l.sill
    ? `<rect x="${x - 24}" y="${y + h + 4}" width="${w + 48}" height="16" rx="4" fill="${frame}"/><rect x="${x - 16}" y="${y + h + 20}" width="${w + 32}" height="8" fill="${C.ink}" opacity="0.25"/>`
    : '';

  return (
    `<path fill-rule="evenodd" d="M0 0H${SIZE}V${SIZE}H0Z M${x} ${y}h${w}v${h}h${-w}Z" fill="${str(l, 'wall', C.ink2)}"/>` +
    `${barLines[bars] ?? ''}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${frame}" stroke-width="14"/>${sill}`
  );
};

export const frost: Shape = (l, ctx) => {
  const [x, y, w, h] = [num(l, 'wx', 60), num(l, 'wy', 30), num(l, 'ww', 390), num(l, 'wh', 290)];
  const color = str(l, 'color', C.cream);
  const id = ctx.uid('frost');
  let blobs = '';

  for (const [cx, cy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]) {
    for (let i = 0; i < 7; i += 1) {
      const [dx, dy] = [(ctx.rnd() - 0.5) * 110, (ctx.rnd() - 0.5) * 90];
      blobs += `<circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="${f(18 + ctx.rnd() * 34)}" fill="${color}" opacity="0.22"/>`;
    }
  }

  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#${id})">${blobs}</g>`;
};

export const leaves: Shape = (l, { rnd }) => {
  const colors = list<string>(l, 'colors');
  const [top, bottom] = [num(l, 'top', 0), num(l, 'bottom', 320)];
  let out = '';

  for (let i = 0; i < num(l, 'count', 14); i += 1) {
    const [x, y] = [f(20 + rnd() * (SIZE - 40)), f(top + 16 + rnd() * (bottom - top - 16))];
    const color = colors[i % colors.length] ?? C.orange;
    out += `<g transform="translate(${x} ${y}) rotate(${f(rnd() * 360)}) scale(${f(0.9 + rnd() * 0.9)})"><path d="${LEAF}" fill="${color}"/><line x1="0" y1="-12" x2="0" y2="14" stroke="${C.ink2}" stroke-opacity="0.3" stroke-width="1.4"/></g>`;
  }

  return out;
};
