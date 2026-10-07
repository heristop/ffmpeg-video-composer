// Music-cover props drawn around their own origin (placed by x/y/s/rot): pets, fruit, party, outdoors.
import { C, LEAF, SPARKLE, f, list, str, type Shape } from './music-covers-primitives.ts';

export const cat: Shape = (l) => {
  const color = str(l, 'color', C.ink);

  return (
    `<g fill="${color}"><path d="M-38 0 C-48 -40 -30 -82 0 -84 C30 -82 48 -40 38 0Z"/><circle cy="-104" r="25"/>` +
    `<path d="M-23 -112 L-19 -138 L-5 -124Z M23 -112 L19 -138 L5 -124Z"/></g>` +
    `<path d="M30 -4 C78 -4 76 -46 58 -54" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>`
  );
};

export const rose: Shape = (l) => {
  const [petal, light, stem] = [str(l, 'petal', C.pink), str(l, 'light', C.pink), str(l, 'stem', C.green)];
  const ring = [0, 72, 144, 216, 288]
    .map((a) => {
      const r = (a * Math.PI) / 180;

      return `<circle cx="${f(Math.cos(r) * 18)}" cy="${f(Math.sin(r) * 18)}" r="22" fill="${petal}"/>`;
    })
    .join('');

  return (
    `<path d="M0 30 C12 90 -12 140 0 214" fill="none" stroke="${stem}" stroke-width="7" stroke-linecap="round"/>` +
    `<path transform="translate(2 116) rotate(-50) scale(1.8)" d="${LEAF}" fill="${stem}"/><path transform="translate(-4 160) rotate(60) scale(1.5)" d="${LEAF}" fill="${stem}"/>` +
    `${ring}<circle r="22" fill="${light}"/><path d="M0 -12 C14 -12 14 8 0 8 C-8 8 -8 -4 0 -4" fill="none" stroke="${petal}" stroke-width="4" stroke-linecap="round"/>`
  );
};

export const banana: Shape = (l) =>
  `<path d="M-84 -26 Q0 74 92 -34 Q98 -44 88 -46 Q0 28 -72 -36Z" fill="${str(l, 'color', C.yellow)}" stroke="${str(l, 'edge', C.amber)}" stroke-width="5" stroke-linejoin="round"/>` +
  `<rect x="-94" y="-46" width="16" height="14" rx="3" fill="${C.brown}" transform="rotate(-30 -86 -39)"/><circle cx="90" cy="-42" r="4" fill="${C.brown}"/>`;

export const swirl: Shape = (l) => {
  const spiral = (offset: number) => {
    let d = '';

    for (let t = 0; t <= Math.PI * 4.8; t += 0.15) {
      const r = 6 + t * 9;
      d += `${d ? ' L' : 'M'}${f(r * Math.cos(t + offset))} ${f(r * Math.sin(t + offset))}`;
    }

    return d;
  };

  return (
    `<path d="${spiral(0)}" fill="none" stroke="${str(l, 'color', C.lav)}" stroke-width="16" stroke-linecap="round"/>` +
    `<path d="${spiral(Math.PI)}" fill="none" stroke="${str(l, 'accent', C.pink)}" stroke-width="16" stroke-linecap="round"/>`
  );
};

export const discoBall: Shape = (l, ctx) => {
  const [color, shade, beam] = [str(l, 'color', C.lav2), str(l, 'shade', C.dusk), str(l, 'beam', C.pink)];
  const [clip, grad] = [ctx.uid('disco'), ctx.uid('discog')];
  const r = 88;
  let grid = '';

  for (let y = -r + 16; y < r; y += 16) grid += `<line x1="${-r}" y1="${y}" x2="${r}" y2="${y}"/>`;

  for (let k = 1; k < 5; k += 1) grid += `<ellipse rx="${f(r * Math.cos((k * Math.PI) / 10))}" ry="${r}" fill="none"/>`;

  let facets = '';

  for (let i = 0; i < 14; i += 1) {
    const [x, y] = [-70 + ctx.rnd() * 90, -70 + ctx.rnd() * 90];
    facets += `<rect x="${f(x)}" y="${f(y)}" width="12" height="12" fill="${C.cream}" opacity="${f(0.4 + ctx.rnd() * 0.5)}"/>`;
  }

  const beams = [
    [-260, 150, -190, 200],
    [250, 120, 200, 190],
    [-240, -60, -250, 10],
    [260, -40, 250, 30],
  ]
    .map(([x1, y1, x2, y2]) => `<path d="M0 0 L${x1} ${y1} L${x2} ${y2}Z" fill="${beam}" opacity="0.18"/>`)
    .join('');

  return (
    `${beams}<line x1="0" y1="-220" x2="0" y2="-92" stroke="${C.cream}" stroke-width="3"/><rect x="-10" y="-100" width="20" height="14" rx="3" fill="${C.cream}"/>` +
    `<radialGradient id="${grad}" cx="0.35" cy="0.3"><stop offset="0" stop-color="${C.cream}"/><stop offset="0.45" stop-color="${color}"/><stop offset="1" stop-color="${shade}"/></radialGradient>` +
    `<clipPath id="${clip}"><circle r="${r}"/></clipPath><circle r="${r}" fill="url(#${grad})"/>` +
    `<g clip-path="url(#${clip})"><g stroke="${shade}" stroke-width="2.4" stroke-opacity="0.7">${grid}</g>${facets}</g>` +
    `<path transform="translate(-42 -48) scale(1.6)" d="${SPARKLE}" fill="${C.cream}"/>`
  );
};

export const target: Shape = (l) => {
  const [ring, dot, arrow, accent] = [
    str(l, 'ring', C.lav),
    str(l, 'dot', C.pink),
    str(l, 'arrow', C.ink2),
    str(l, 'accent', C.yellow),
  ];

  return (
    `<circle r="114" fill="${ring}" opacity="0.16"/><circle r="84" fill="none" stroke="${ring}" stroke-width="16"/><circle r="48" fill="none" stroke="${ring}" stroke-width="16"/><circle r="22" fill="${dot}"/>` +
    `<g transform="rotate(-33)"><rect x="-262" y="-8" width="214" height="16" rx="4" fill="${arrow}"/><path d="M-64 -28 L-14 0 L-64 28Z" fill="${arrow}"/>` +
    `<path d="M-262 -8 L-292 -38 L-252 -38 L-226 -8Z M-262 8 L-292 38 L-252 38 L-226 8Z" fill="${accent}"/></g>` +
    `<rect x="-232" y="-122" width="30" height="30" fill="${dot}" transform="rotate(20 -217 -107)"/><path d="M118 70 L150 70 L134 42Z" fill="${accent}"/>`
  );
};

export const tree: Shape = (l, { rnd }) => {
  const trunk = str(l, 'trunk', C.ink2);
  const colors = list<string>(l, 'colors');
  let crown = '';

  for (let i = 0; i < 16; i += 1) {
    const [a, d] = [rnd() * Math.PI * 2, Math.sqrt(rnd()) * 74];
    const color = colors[i % colors.length] ?? C.orange;
    crown += `<circle cx="${f(Math.cos(a) * d * 1.25)}" cy="${f(-196 + Math.sin(a) * d * 0.8)}" r="${f(30 + rnd() * 18)}" fill="${color}"/>`;
  }

  return (
    `<path d="M-14 0 C-8 -60 -10 -110 -4 -150 L-40 -196 L-32 -202 L2 -164 L10 -214 L20 -212 L14 -150 L50 -188 L56 -180 L16 -128 C14 -80 18 -40 16 0Z" fill="${trunk}"/>` +
    `<g opacity="0.95">${crown}</g>`
  );
};

export const crane: Shape = (l) => {
  const [color, line] = [str(l, 'color', C.yellow), str(l, 'line', C.ink2)];
  const blocks = list<string>(l, 'blocks');
  let lattice = '';

  for (let y = 0; y > -276; y -= 28) lattice += `<path d="M-14 ${y} L14 ${y - 28}" />`;

  for (let x = -60; x < 268; x += 24) lattice += `<path d="M${x} -260 L${x + 12} -276 L${x + 24} -260" />`;

  return (
    `<g fill="none" stroke="${color}" stroke-width="5"><rect x="-14" y="-276" width="28" height="276"/><rect x="-62" y="-276" width="332" height="16"/>${lattice}</g>` +
    `<path d="M-14 -276 L0 -322 L14 -276" fill="none" stroke="${color}" stroke-width="5"/>` +
    `<path d="M0 -322 L268 -276 M0 -322 L-62 -276" stroke="${color}" stroke-width="2.5"/>` +
    `<rect x="-84" y="-262" width="36" height="30" fill="${line}"/><rect x="14" y="-260" width="26" height="24" rx="3" fill="${color}"/>` +
    `<rect x="196" y="-262" width="18" height="8" fill="${line}"/><line x1="205" y1="-254" x2="205" y2="-138" stroke="${line}" stroke-width="2.5"/>` +
    `<rect x="182" y="-138" width="46" height="32" rx="3" fill="${blocks[0] ?? C.pink}"/>` +
    `<rect x="110" y="-44" width="62" height="44" rx="3" fill="${blocks[1] ?? C.lav}"/><rect x="176" y="-44" width="62" height="44" rx="3" fill="${blocks[0] ?? C.pink}"/>` +
    `<rect x="142" y="-88" width="62" height="44" rx="3" fill="${blocks[2] ?? C.cream}"/><rect x="-60" y="0" width="340" height="10" fill="${line}"/>`
  );
};

export const palm: Shape = (l) => {
  const frond = str(l, 'frond', C.ink2);
  const fronds = [-170, -132, -88, -40, 0, 34]
    .map(
      (a) =>
        `<path transform="translate(46 -230) rotate(${a})" d="M0 0 C34 -24 90 -22 128 24 C90 2 42 2 0 8Z" fill="${frond}"/>`
    )
    .join('');

  return `<path d="M-12 0 C-6 -80 10 -160 40 -232 L54 -226 C24 -160 12 -80 12 0Z" fill="${str(l, 'trunk', C.brown)}"/>${fronds}<circle cx="38" cy="-220" r="8" fill="${frond}"/><circle cx="54" cy="-216" r="8" fill="${frond}"/>`;
};

export const cocktail: Shape = (l) => {
  const [glass, drink, umbrella] = [str(l, 'glass', C.cream), str(l, 'drink', C.pink), str(l, 'umbrella', C.lav)];

  return (
    `<line x1="-18" y1="-150" x2="-52" y2="-218" stroke="${C.cream}" stroke-width="5" stroke-linecap="round"/>` +
    `<g transform="translate(32 -172) rotate(24)"><line x1="0" y1="0" x2="0" y2="50" stroke="${C.cream}" stroke-width="3"/><path d="M-38 0 A38 38 0 0 1 38 0Z" fill="${umbrella}"/><path d="M0 0 L-13 -36 M0 0 L13 -36" stroke="${C.cream}" stroke-width="2"/></g>` +
    `<path d="M-74 -172 L74 -172 L0 -90Z" fill="${glass}" opacity="0.45"/><path d="M-60 -160 L60 -160 L0 -96Z" fill="${drink}"/>` +
    `<rect x="-3.5" y="-92" width="7" height="84" fill="${glass}"/><ellipse cy="-6" rx="38" ry="8" fill="${glass}"/>` +
    `<circle cx="-70" cy="-172" r="20" fill="${C.orange}"/><circle cx="-70" cy="-172" r="13" fill="${C.amber}"/>`
  );
};
