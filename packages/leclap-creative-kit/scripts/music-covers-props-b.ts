// Music-cover props drawn around their own origin (placed by x/y/s/rot): neon, study, zen, loops, toys.
import { C, HEART, LEAF, arc, f, list, num, steam, str, type Shape } from './music-covers-primitives.ts';

export const neonCup: Shape = (l, ctx) => {
  const id = ctx.uid('neon');
  const color = str(l, 'color', C.pink);
  const d = 'M-60 -40 L60 -40 L50 30 Q48 50 28 50 L-28 50 Q-48 50 -50 30Z M58 -22 C94 -22 94 22 53 18 M-84 68 L84 68';
  const wisps = steam(0, -56, str(l, 'steam', C.lav2), 30);

  return (
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>` +
    `<g filter="url(#${id})" opacity="0.9"><path d="${d}" fill="none" stroke="${color}" stroke-width="14"/>${wisps}</g>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${C.cream}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>${wisps}`
  );
};

export const notebook: Shape = (l) => {
  const [page, line] = [str(l, 'page', C.cream), str(l, 'line', C.lav2)];
  let lines = '';

  for (let k = 0; k < 7; k += 1) {
    const y = -62 + k * 22;
    lines += `<line x1="-124" y1="${y}" x2="-22" y2="${y + 1}" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`;

    if (k < 4) {
      lines += `<line x1="22" y1="${y + 1}" x2="124" y2="${y}" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }

  return (
    `<rect x="-152" y="-104" width="304" height="208" rx="12" fill="${str(l, 'cover', C.ink2)}"/>` +
    `<path d="M-142 -94 L-4 -88 L-4 94 L-142 88Z" fill="${page}"/><path d="M4 -88 L142 -94 L142 88 L4 94Z" fill="${page}"/>` +
    `${lines}<path transform="translate(80 54) scale(1.8)" d="${HEART}" fill="${C.pink}"/>`
  );
};

export const pencil: Shape = (l) =>
  `<rect x="-110" y="-9" width="190" height="18" fill="${str(l, 'color', C.yellow)}"/><line x1="-110" y1="0" x2="80" y2="0" stroke="${C.amber}" stroke-width="2"/>` +
  `<path d="M80 -9 L112 0 L80 9Z" fill="#F2D3A2"/><path d="M102 -2.5 L112 0 L102 2.5Z" fill="${C.ink}"/>` +
  `<rect x="-124" y="-9" width="14" height="18" fill="#C9C4D6"/><rect x="-142" y="-9" width="20" height="18" rx="5" fill="${C.pink}"/>`;

export const cassette: Shape = (l) => {
  const reel = (cx: number) =>
    `<circle cx="${cx}" cy="-4" r="14" fill="${C.cream}"/><circle cx="${cx}" cy="-4" r="5" fill="${C.ink2}"/>`;

  return (
    `<rect x="-110" y="-70" width="220" height="140" rx="12" fill="${str(l, 'color', C.pink)}"/>` +
    `<rect x="-92" y="-58" width="184" height="28" rx="5" fill="${str(l, 'label', C.cream)}"/>` +
    `<rect x="-66" y="-22" width="132" height="36" rx="18" fill="${C.ink2}"/>${reel(-36)}${reel(36)}` +
    `<path d="M-70 70 L-56 42 L56 42 L70 70Z" fill="${C.ink2}" opacity="0.3"/>`
  );
};

export const ripples: Shape = (l) => {
  const color = str(l, 'color', C.lav);
  let out = '';

  for (let k = 1; k <= num(l, 'rings', 4); k += 1) {
    const r = 40 + k * 42;
    out += `<ellipse rx="${r}" ry="${f(r * 0.26)}" fill="none" stroke="${color}" stroke-width="3" opacity="${f(1 - k * 0.15)}"/>`;
  }

  return out;
};

export const stones: Shape = (l) => {
  const colors = list<string>(l, 'colors');
  const sizes = [
    [92, 28],
    [70, 24],
    [52, 20],
    [34, 16],
  ];
  let [cy, out] = [0, ''];

  for (const [i, [rx, ry]] of sizes.entries()) {
    out += `<ellipse cy="${cy - ry}" rx="${rx}" ry="${ry}" fill="${colors[i] ?? C.ink2}"/>`;
    out += `<ellipse cx="${-rx * 0.3}" cy="${cy - ry * 1.45}" rx="${rx * 0.35}" ry="${ry * 0.22}" fill="${C.cream}" opacity="0.18"/>`;
    cy -= ry * 2 - 5;
  }

  return out;
};

export const leaf: Shape = (l) =>
  `<path transform="scale(1.6)" d="${LEAF}" fill="${str(l, 'color', C.green)}"/><line x1="0" y1="-22" x2="0" y2="34" stroke="${C.ink2}" stroke-opacity="0.35" stroke-width="2"/>`;

export const boombox: Shape = (l, { rnd }) => {
  const [color, panel, barColor] = [str(l, 'color', C.lav), str(l, 'panel', C.ink2), str(l, 'bars', C.yellow)];
  const speaker = (cx: number) =>
    `<circle cx="${cx}" cy="12" r="58" fill="${panel}"/><circle cx="${cx}" cy="12" r="40" fill="none" stroke="${C.cream}" stroke-opacity="0.35" stroke-width="3"/><circle cx="${cx}" cy="12" r="18" fill="${color}"/>`;
  let bars = '';

  for (let i = 0; i < 5; i += 1) {
    const h = 10 + rnd() * 26;
    bars += `<rect x="${-24 + i * 10}" y="${f(-18 - h)}" width="7" height="${f(h)}" fill="${barColor}"/>`;
  }

  return (
    `<path d="M-100 -82 L-100 -112 Q-100 -124 -88 -124 L88 -124 Q100 -124 100 -112 L100 -82" fill="none" stroke="${panel}" stroke-width="12"/>` +
    `<rect x="-60" y="-94" width="22" height="12" rx="3" fill="${C.pink}"/><rect x="-32" y="-94" width="22" height="12" rx="3" fill="${C.pink}"/>` +
    `<rect x="-162" y="-84" width="324" height="172" rx="22" fill="${color}"/>${speaker(-94)}${speaker(94)}` +
    `<rect x="-30" y="-64" width="60" height="50" rx="6" fill="${panel}"/>${bars}` +
    `<rect x="-30" y="-2" width="60" height="44" rx="6" fill="${panel}"/><circle cx="-12" cy="20" r="6" fill="${C.cream}"/><circle cx="12" cy="20" r="6" fill="${C.cream}"/>`
  );
};

export const loopArrows: Shape = (l) => {
  const r = 96;
  const head = (deg: number, color: string) => {
    const a = (deg * Math.PI) / 180;
    const [px, py] = [r * Math.cos(a), r * Math.sin(a)];
    const [tx, ty] = [-Math.sin(a), Math.cos(a)];
    const [nx, ny] = [Math.cos(a), Math.sin(a)];

    return `<path d="M${f(px + tx * 30)} ${f(py + ty * 30)} L${f(px + nx * 26)} ${f(py + ny * 26)} L${f(px - nx * 26)} ${f(py - ny * 26)}Z" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`;
  };
  const [color, accent, play] = [str(l, 'color', C.lav2), str(l, 'accent', C.pink), str(l, 'play', C.yellow)];

  return (
    `<path d="${arc(r, 196, 340)}" fill="none" stroke="${color}" stroke-width="24" stroke-linecap="round"/>${head(340, color)}` +
    `<path d="${arc(r, 16, 160)}" fill="none" stroke="${accent}" stroke-width="24" stroke-linecap="round"/>${head(160, accent)}` +
    `<path d="M-20 -30 L32 0 L-20 30Z" fill="${play}" stroke="${play}" stroke-width="10" stroke-linejoin="round"/>`
  );
};

export const infinity: Shape = (l, ctx) => {
  const id = ctx.uid('inf');

  return (
    `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${str(l, 'from', C.ink2)}"/><stop offset="1" stop-color="${str(l, 'to', C.dusk)}"/></linearGradient>` +
    `<path d="M0 0 C40 -74 150 -74 150 0 C150 74 40 74 0 0 C-40 -74 -150 -74 -150 0 C-150 74 -40 74 0 0Z" fill="none" stroke="url(#${id})" stroke-width="34" stroke-linecap="round"/>`
  );
};

export const grandPiano: Shape = (l) => {
  const [color, keys] = [str(l, 'color', C.ink2), str(l, 'keys', C.cream)];

  return (
    `<path d="M-120 -104 L130 -104 L-40 -192Z" fill="${color}"/><line x1="40" y1="-104" x2="-2" y2="-166" stroke="${color}" stroke-width="4"/>` +
    `<path d="M-130 -100 L70 -100 C120 -100 142 -92 142 -78 L142 -62 L-130 -62Z" fill="${color}"/>` +
    `<rect x="-154" y="-86" width="28" height="12" fill="${keys}"/>` +
    `<rect x="-124" y="-62" width="12" height="62" fill="${color}"/><rect x="120" y="-62" width="12" height="62" fill="${color}"/><rect x="10" y="-62" width="12" height="62" fill="${color}"/>` +
    `<rect x="-62" y="-62" width="6" height="52" fill="${color}"/><rect x="-72" y="-12" width="26" height="6" fill="${color}"/>` +
    `<rect x="-214" y="-50" width="56" height="12" rx="3" fill="${color}"/><rect x="-208" y="-38" width="7" height="38" fill="${color}"/><rect x="-170" y="-38" width="7" height="38" fill="${color}"/>`
  );
};

export const clouds: Shape = (l) => {
  const color = str(l, 'color', C.cream);

  return (
    `<g fill="${color}"><circle cx="-50" cy="0" r="30"/><circle cx="-14" cy="-22" r="38"/><circle cx="26" cy="-12" r="32"/><circle cx="56" cy="4" r="24"/>` +
    `<rect x="-80" y="0" width="160" height="28" rx="14"/></g>`
  );
};

export const kite: Shape = (l) => {
  const [a, b, tail] = [str(l, 'a', C.pink), str(l, 'b', C.lav), str(l, 'tail', C.yellow)];
  const bow = (x: number, y: number) => `<path d="M${x} ${y} l-14 -9 l0 18Z M${x} ${y} l14 -9 l0 18Z" fill="${tail}"/>`;

  return (
    `<line x1="0" y1="-10" x2="-330" y2="420" stroke="${C.cream}" stroke-width="2" opacity="0.8"/>` +
    `<path d="M0 90 C24 130 -26 150 0 190 S10 230 -14 262" fill="none" stroke="${tail}" stroke-width="3.5"/>${bow(8, 140)}${bow(-4, 205)}${bow(-12, 256)}` +
    `<path d="M0 -10 L0 -92 L-62 -10Z" fill="${a}"/><path d="M0 -10 L0 -92 L62 -10Z" fill="${b}"/>` +
    `<path d="M0 -10 L62 -10 L0 90Z" fill="${a}"/><path d="M0 -10 L-62 -10 L0 90Z" fill="${b}"/>` +
    `<path d="M0 -92 L0 90 M-62 -10 L62 -10" stroke="${C.cream}" stroke-width="3"/>`
  );
};

export const duck: Shape = (l) => {
  const color = str(l, 'color', C.yellow);

  return (
    `<path d="M-80 -10 C-92 -62 -72 -52 -52 -40 C-20 -60 40 -52 62 -30 C86 -10 80 30 40 40 L-50 40 C-82 35 -86 15 -80 -10Z" fill="${color}"/>` +
    `<circle cx="40" cy="-62" r="36" fill="${color}"/>` +
    `<path d="M70 -62 C96 -68 104 -52 96 -46 C88 -40 74 -44 68 -48Z" fill="${str(l, 'beak', C.orange)}"/>` +
    `<path d="M-32 -8 C-10 -30 26 -24 32 2 C16 16 -16 12 -32 -8Z" fill="${str(l, 'light', C.yellow)}"/>` +
    `<circle cx="52" cy="-72" r="6" fill="${C.ink}"/><circle cx="54" cy="-74" r="2" fill="${C.cream}"/><circle cx="60" cy="-50" r="7" fill="${C.pink}" opacity="0.55"/>`
  );
};

export const guitar: Shape = (l) => {
  const [color, neck] = [str(l, 'color', C.pink), str(l, 'neck', C.amber)];
  let frets = '';

  for (let y = -240; y < -80; y += 18) {
    frets += `<line x1="-9" y1="${y}" x2="9" y2="${y}" stroke="${C.ink2}" stroke-width="1.5" opacity="0.6"/>`;
  }

  const strings = [-6, -2, 2, 6]
    .map((x) => `<line x1="${x}" y1="-298" x2="${x}" y2="58" stroke="${C.cream}" stroke-width="1.2" opacity="0.85"/>`)
    .join('');

  return (
    `<path d="M-12 -250 L-15 -304 Q-12 -316 4 -310 L14 -250Z" fill="${neck}"/>` +
    `<path d="M0 -70 C20 -70 30 -95 45 -90 C60 -85 50 -55 55 -35 C60 -10 75 0 75 40 C75 90 40 110 0 110 C-40 110 -75 90 -75 40 C-75 0 -60 -10 -55 -35 C-52 -55 -65 -100 -45 -105 C-28 -108 -20 -70 0 -70Z" fill="${color}"/>` +
    `<path d="M-44 -30 C-30 -48 20 -46 30 -20 C40 10 30 50 6 64 C-26 66 -52 30 -44 -30Z" fill="${str(l, 'guard', C.cream)}"/>` +
    `<rect x="-9" y="-252" width="18" height="190" fill="${neck}"/>${frets}` +
    `<rect x="-18" y="-24" width="36" height="10" rx="3" fill="${C.ink2}"/><rect x="-18" y="6" width="36" height="10" rx="3" fill="${C.ink2}"/>` +
    `<rect x="-20" y="50" width="40" height="10" rx="3" fill="${C.ink2}"/><circle cx="46" cy="58" r="7" fill="${C.ink2}"/><circle cx="56" cy="34" r="7" fill="${C.ink2}"/>${strings}`
  );
};

export const elevator: Shape = (l) => {
  const [door, brass, button] = [str(l, 'door', C.lav2), str(l, 'brass', C.amber), str(l, 'button', C.yellow)];
  const ticks = [-150, -120, -90, -60, -30]
    .map((a) => {
      const r = (a * Math.PI) / 180;

      return `<line x1="${f(Math.cos(r) * 32)}" y1="${f(44 + Math.sin(r) * 32)}" x2="${f(Math.cos(r) * 40)}" y2="${f(44 + Math.sin(r) * 40)}" stroke="${C.cream}" stroke-width="3"/>`;
    })
    .join('');

  return (
    `<rect x="-200" y="290" width="400" height="20" fill="${C.ink2}" opacity="0.5"/>` +
    `<path d="M-50 44 A50 50 0 0 1 50 44Z" fill="${C.ink2}" stroke="${brass}" stroke-width="6"/>${ticks}` +
    `<circle cx="-22" cy="22" r="7" fill="${button}"/><line x1="0" y1="44" x2="26" y2="16" stroke="${brass}" stroke-width="4" stroke-linecap="round"/>` +
    `<rect x="-124" y="62" width="248" height="232" rx="6" fill="${brass}"/>` +
    `<rect x="-110" y="76" width="108" height="218" fill="${door}"/><rect x="2" y="76" width="108" height="218" fill="${door}"/>` +
    `<rect x="-90" y="96" width="68" height="178" fill="none" stroke="${C.cream}" stroke-opacity="0.4" stroke-width="3"/><rect x="22" y="96" width="68" height="178" fill="none" stroke="${C.cream}" stroke-opacity="0.4" stroke-width="3"/>` +
    `<rect x="140" y="140" width="44" height="96" rx="12" fill="${C.ink2}"/>` +
    `<circle cx="162" cy="166" r="15" fill="${button}"/><path d="M154 171 L162 159 L170 171Z" fill="${C.ink2}"/>` +
    `<circle cx="162" cy="210" r="15" fill="${C.cream}" opacity="0.45"/><path d="M154 205 L162 217 L170 205Z" fill="${C.ink2}"/>`
  );
};
