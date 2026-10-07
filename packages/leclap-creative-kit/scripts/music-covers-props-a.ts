// Music-cover props drawn around their own origin (placed by x/y/s/rot): lights, cups, instruments, desk.
import { C, HEART, f, glowCircle, num, steam, str, vinylDisc, type Shape } from './music-covers-primitives.ts';

export const glow: Shape = (l, ctx) =>
  glowCircle(ctx, num(l, 'r', 160), str(l, 'color', C.lav), num(l, 'opacity', 0.4));

export const moonShape: Shape = (l, ctx) => {
  const [r, phase, color] = [num(l, 'r', 36), num(l, 'phase', 0), str(l, 'color', C.cream)];
  const halo = glowCircle(ctx, r * 2.4, color, 0.35);

  if (phase <= 0) return `${halo}<circle r="${r}" fill="${color}"/>`;

  const id = ctx.uid('moon');

  return `${halo}<mask id="${id}"><circle r="${r}" fill="#fff"/><circle cx="${f(r * phase)}" cy="${f(-r * phase * 0.35)}" r="${r}" fill="#000"/></mask><circle r="${r}" fill="${color}" mask="url(#${id})"/>`;
};

export const sun: Shape = (l, ctx) => {
  const r = num(l, 'r', 70);

  return `${glowCircle(ctx, r * 2.1, str(l, 'halo', C.amber), 0.6)}<circle r="${r}" fill="${str(l, 'color', C.yellow)}"/>`;
};

export const eiffel: Shape = (l) => {
  const color = str(l, 'color', C.ink2);

  return (
    `<path d="M-50 0 Q-30 -40 -16 -80 L-7 -145 L-2 -195 L0 -207 L2 -195 L7 -145 L16 -80 Q30 -40 50 0 L32 0 Q0 -55 -32 0Z" fill="${color}"/>` +
    `<rect x="-22" y="-86" width="44" height="7" fill="${color}"/><rect x="-12" y="-150" width="24" height="6" fill="${color}"/>`
  );
};

export const mug: Shape = (l) => {
  const color = str(l, 'color', C.pink);
  const handle = `<path d="M34 -62 C64 -62 64 -18 34 -20" fill="none" stroke="${color}" stroke-width="11"/>`;

  return (
    `<g transform="scale(${l.flip ? -1 : 1} 1)">${handle}</g>` +
    `<rect x="-34" y="-78" width="68" height="78" rx="12" fill="${color}"/>` +
    `<rect x="-34" y="-54" width="68" height="10" fill="${str(l, 'band', C.cream)}" opacity="0.8"/>` +
    steam(0, -92, str(l, 'steam', C.cream))
  );
};

export const cup: Shape = (l) => {
  const color = str(l, 'color', C.cream);

  return (
    `<ellipse rx="80" ry="13" fill="${color}"/><ellipse cy="-2" rx="56" ry="7" fill="${C.ink}" opacity="0.12"/>` +
    `<path d="M46 -66 C82 -66 80 -26 40 -30" fill="none" stroke="${color}" stroke-width="10"/>` +
    `<path d="M-52 -78 L52 -78 Q50 -14 24 -8 L-24 -8 Q-50 -14 -52 -78Z" fill="${color}"/>` +
    `<ellipse cy="-77" rx="44" ry="7" fill="${str(l, 'coffee', C.brown)}"/>` +
    `<path transform="translate(0 -44) scale(1.3)" d="${HEART}" fill="${str(l, 'accent', C.pink)}"/>` +
    steam(0, -96, str(l, 'steam', C.cream), 26)
  );
};

export const table: Shape = (l) => {
  const color = str(l, 'color', C.ink2);

  return `<rect x="-210" y="0" width="420" height="16" rx="8" fill="${color}"/><rect x="-10" y="16" width="20" height="200" fill="${color}"/>`;
};

export const vinyl: Shape = (l) => vinylDisc(num(l, 'r', 100), str(l, 'label', C.pink));

export const turntable: Shape = (l) => {
  const base = str(l, 'base', C.night);

  return (
    `<rect x="-170" y="-130" width="340" height="250" rx="22" fill="${base}"/>` +
    `<g transform="translate(-34 -6)">${vinylDisc(108, str(l, 'label', C.pink))}</g>` +
    `<circle cx="120" cy="-92" r="16" fill="${C.cream}"/>` +
    `<path d="M120 -92 L128 6 L70 62" fill="none" stroke="${C.cream}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="56" y="54" width="22" height="14" rx="3" fill="${C.cream}" transform="rotate(-40 67 61)"/>` +
    `<circle cx="140" cy="94" r="7" fill="${C.pink}"/><circle cx="114" cy="94" r="7" fill="${C.lav2}"/>`
  );
};

export const trumpet: Shape = (l) => {
  const [color, shade] = [str(l, 'color', C.amber), str(l, 'shade', C.orange)];
  const valves = [-40, -16, 8]
    .map(
      (x) =>
        `<rect x="${x}" y="-34" width="14" height="62" rx="4" fill="${color}"/><rect x="${x - 3}" y="-44" width="20" height="10" rx="3" fill="${shade}"/><circle cx="${x + 7}" cy="-51" r="7" fill="${C.cream}"/>`
    )
    .join('');

  return (
    `<rect x="-80" y="4" width="130" height="34" rx="17" fill="none" stroke="${shade}" stroke-width="9"/>` +
    `<rect x="-130" y="-6" width="200" height="12" rx="6" fill="${color}"/>` +
    `<path d="M-150 -8 L-130 -4 L-130 4 L-150 8Z" fill="${color}"/><rect x="-157" y="-10" width="8" height="20" rx="3" fill="${shade}"/>` +
    `<path d="M60 -8 C90 -10 106 -30 120 -54 L120 54 C106 30 90 10 60 8Z" fill="${color}"/>` +
    `<ellipse cx="120" rx="10" ry="54" fill="${shade}"/>${valves}`
  );
};

export const bass: Shape = (l) => {
  const [color, shade] = [str(l, 'color', C.amber), str(l, 'shade', C.brown)];
  const strings = [-5.4, -1.8, 1.8, 5.4]
    .map((x) => `<line x1="${x}" y1="-268" x2="${x}" y2="96" stroke="${C.cream}" stroke-width="1.3" opacity="0.85"/>`)
    .join('');

  return (
    `<line x1="0" y1="130" x2="0" y2="156" stroke="${C.ink2}" stroke-width="5"/>` +
    `<path d="M0 -120 C45 -120 60 -95 55 -65 C50 -40 38 -30 42 -15 C46 0 75 10 75 60 C75 115 40 135 0 135 C-40 135 -75 115 -75 60 C-75 10 -46 0 -42 -15 C-38 -30 -50 -40 -55 -65 C-60 -95 -45 -120 0 -120Z" fill="${color}" stroke="${shade}" stroke-width="5"/>` +
    `<path d="M-28 14 c-8 12 8 22 0 36 M28 14 c8 12 -8 22 0 36" fill="none" stroke="${C.ink2}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M-12 82 L12 82 L6 126 L-6 126Z" fill="${C.ink2}"/><rect x="-22" y="58" width="44" height="7" rx="2" fill="${C.cream}"/>` +
    `<rect x="-8" y="-270" width="16" height="160" rx="4" fill="${C.ink2}"/><circle cy="-278" r="12" fill="${shade}"/>${strings}`
  );
};

export const lamp: Shape = (l) => {
  const [color, light] = [str(l, 'color', C.pink), str(l, 'light', C.yellow)];

  return (
    `<g transform="translate(46 -172) rotate(32)"><path d="M-36 40 L36 40 L120 170 L-120 170Z" fill="${light}" opacity="0.22"/>` +
    `<path d="M-18 -10 L18 -10 L38 40 L-38 40Z" fill="${color}"/><circle cy="40" r="10" fill="${light}"/></g>` +
    `<path d="M0 -8 L-32 -112 L46 -172" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="-32" cy="-112" r="8" fill="${C.cream}"/><ellipse cy="-5" rx="42" ry="9" fill="${color}"/>`
  );
};

export const plant: Shape = (l) => {
  const leaf = str(l, 'leaf', C.green);
  const fronds = [
    [-62, 70],
    [-34, 92],
    [-10, 100],
    [14, 94],
    [38, 82],
    [64, 66],
  ]
    .map(
      ([a, len]) =>
        `<path transform="translate(0 -66) rotate(${a})" d="M0 0 C18 -20 14 ${-len * 0.8} 0 ${-len} C-14 ${-len * 0.8} -18 -20 0 0Z" fill="${leaf}"/>`
    )
    .join('');

  return `${fronds}<path d="M-34 -60 L34 -60 L26 0 L-26 0Z" fill="${str(l, 'pot', C.cream)}"/><rect x="-38" y="-70" width="76" height="13" rx="4" fill="${str(l, 'pot', C.cream)}"/>`;
};

export const headphones: Shape = (l) => {
  const [color, cupColor] = [str(l, 'color', C.cream), str(l, 'cup', C.pink)];

  return (
    `<path d="M-82 14 A82 82 0 0 1 82 14" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/>` +
    `<rect x="-108" y="-4" width="42" height="80" rx="18" fill="${cupColor}"/><rect x="66" y="-4" width="42" height="80" rx="18" fill="${cupColor}"/>` +
    `<rect x="-74" y="6" width="12" height="60" rx="6" fill="${color}"/><rect x="62" y="6" width="12" height="60" rx="6" fill="${color}"/>`
  );
};

export const armchair: Shape = (l) => {
  const [color, shade] = [str(l, 'color', C.pink), str(l, 'shade', C.lav)];

  return (
    `<rect x="-72" y="-172" width="144" height="116" rx="30" fill="${color}"/>` +
    `<rect x="-68" y="-84" width="136" height="38" rx="12" fill="${shade}"/>` +
    `<rect x="-100" y="-112" width="38" height="84" rx="16" fill="${color}"/><rect x="62" y="-112" width="38" height="84" rx="16" fill="${color}"/>` +
    `<rect x="-94" y="-46" width="188" height="22" rx="8" fill="${shade}"/>` +
    `<rect x="-82" y="-24" width="9" height="24" fill="${C.ink}"/><rect x="73" y="-24" width="9" height="24" fill="${C.ink}"/>`
  );
};

export const pianoKeys: Shape = (l) => {
  const [w, h, n] = [num(l, 'w', 460), num(l, 'h', 110), num(l, 'n', 12)];
  const [white, black] = [str(l, 'white', C.cream), str(l, 'black', C.ink2)];
  const kw = w / n;
  const pattern = [1, 1, 0, 1, 1, 1, 0];
  let out = `<rect x="-6" y="-22" width="${w + 12}" height="${h + 28}" rx="8" fill="${black}"/>`;

  for (let i = 0; i < n; i += 1) {
    out += `<rect x="${f(i * kw + 1.5)}" y="0" width="${f(kw - 3)}" height="${h}" rx="3" fill="${white}"/>`;
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (pattern[i % 7]) {
      out += `<rect x="${f((i + 1) * kw - kw * 0.3)}" y="0" width="${f(kw * 0.6)}" height="${f(h * 0.6)}" rx="3" fill="${black}"/>`;
    }
  }

  return out;
};
