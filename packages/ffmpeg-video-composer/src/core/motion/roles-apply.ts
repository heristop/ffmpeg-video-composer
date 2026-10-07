// Applies motion roles to the elements that declare one: kinetic blocks, graphics, drawtext filters
// (reveal, exit, animate keys), title cards, lower thirds and the camera. An element that sets no ease gets
// `$role.<name>` (resolved by the token pass right after), plus the role's duration when it has one and the
// element sets none. An explicit ease keeps the element's own timing: a role never squeezes a spring the
// author picked. Elements without `role` are returned as the same objects.

import type { RoleTable } from './roles';

type Loose = Record<string, unknown>;

const DEFAULT_SUGAR_REVEAL = 'rise';
const GRAPHIC_MAX_DURATION = 3;
const CAMERA_TRACKS = ['zoom', 'x', 'y', 'rotate'] as const;
const ANIMATE_TRACKS = ['x', 'y', 'opacity', 'scale'] as const;

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function roleOf(element: unknown): string | undefined {
  const role = isObject(element) ? element.role : undefined;

  return typeof role === 'string' ? role : undefined;
}

interface Fields {
  ease: string;
  duration: string;
  maxDuration?: number;
}

/** The element with the role's ease (and duration, when the ease came from the role) filled in. */
function withRole(element: Loose, role: string, table: RoleTable, fields: Fields): Loose {
  if (element[fields.ease] !== undefined) return element;

  const out: Loose = { ...element, [fields.ease]: `$role.${role}` };
  const key = `role.${role}`;

  if (Object.hasOwn(table.durations, key) && element[fields.duration] === undefined) {
    const duration = table.durations[key];
    out[fields.duration] = fields.maxDuration === undefined ? duration : Math.min(duration, fields.maxDuration);
  }

  return out;
}

const EASE_FIELDS: Fields = { ease: 'ease', duration: 'duration' };
const EASING_FIELDS: Fields = { ease: 'easing', duration: 'duration' };

// A reveal/exit phase: a bare type becomes an object so it can carry the role's curve; `none` stays off.
function phaseWithRole(phase: unknown, role: string, table: RoleTable): unknown {
  if (phase === undefined || phase === 'none') return phase;

  const object = typeof phase === 'string' ? { type: phase } : phase;

  if (!isObject(object) || object.type === 'none') return phase;

  return withRole(object, role, table, EASING_FIELDS);
}

// Keys after the first that set no ease ease into place on the role's curve.
function tracksWithRole(tracks: Loose, axes: readonly string[], role: string): Loose {
  const out: Loose = { ...tracks };

  for (const axis of axes) {
    const keys = tracks[axis];

    if (!Array.isArray(keys)) continue;

    out[axis] = keys.map((key, index) =>
      index > 0 && isObject(key) && key.ease === undefined ? { ...key, ease: `$role.${role}` } : key
    );
  }

  return out;
}

function filterWithRole(filter: unknown, table: RoleTable): unknown {
  const role = roleOf(filter);

  if (!role || (filter as Loose).type !== 'drawtext') return filter;

  const record = filter as Loose;
  const out: Loose = { ...record };

  if (record.reveal !== undefined) out.reveal = phaseWithRole(record.reveal, role, table);

  if (record.exit !== undefined) out.exit = phaseWithRole(record.exit, role, table);

  if (isObject(record.animate)) out.animate = tracksWithRole(record.animate, ANIMATE_TRACKS, role);

  return out;
}

function sugarWithRole(sugar: unknown, table: RoleTable): unknown {
  const role = roleOf(sugar);

  if (!role) return sugar;

  const record = sugar as Loose;

  return { ...record, reveal: phaseWithRole(record.reveal ?? DEFAULT_SUGAR_REVEAL, role, table) };
}

function cameraWithRole(camera: unknown, table: RoleTable): unknown {
  const role = roleOf(camera);

  if (!role) return camera;

  return tracksWithRole(withRole(camera as Loose, role, table, EASE_FIELDS), CAMERA_TRACKS, role);
}

function elementsWithRole(list: unknown, map: (element: unknown) => unknown): unknown {
  return Array.isArray(list) ? list.map(map) : list;
}

function simpleWithRole(element: unknown, table: RoleTable, fields: Fields): unknown {
  const role = roleOf(element);

  return role ? withRole(element as Loose, role, table, fields) : element;
}

const GRAPHIC_FIELDS: Fields = { ...EASE_FIELDS, maxDuration: GRAPHIC_MAX_DURATION };

function sectionWithRoles(input: unknown, table: RoleTable): unknown {
  if (!isObject(input)) return input;

  const section: Loose = input;
  const out: Loose = { ...section };

  function set(key: string, value: unknown): void {
    if (section[key] !== undefined) out[key] = value;
  }

  set(
    'kinetic',
    elementsWithRole(section.kinetic, (block) => simpleWithRole(block, table, EASE_FIELDS))
  );
  set(
    'graphics',
    elementsWithRole(section.graphics, (graphic) => simpleWithRole(graphic, table, GRAPHIC_FIELDS))
  );
  set(
    'filters',
    elementsWithRole(section.filters, (filter) => filterWithRole(filter, table))
  );
  set('titleCard', sugarWithRole(section.titleCard, table));
  set('lowerThird', sugarWithRole(section.lowerThird, table));
  set('camera', cameraWithRole(section.camera, table));

  return out;
}

const ROLE_HOLDERS = ['kinetic', 'graphics', 'filters', 'titleCard', 'lowerThird', 'camera'] as const;

function declaresRole(section: unknown): boolean {
  if (!isObject(section)) return false;

  return ROLE_HOLDERS.some((key) => {
    const value = section[key];

    return Array.isArray(value) ? value.some((element) => roleOf(element)) : roleOf(value) !== undefined;
  });
}

/** Sections with every role-bearing element's ease/duration filled from its role; others untouched. */
export function applyMotionRoles(sections: unknown, table: RoleTable): unknown {
  if (!Array.isArray(sections) || !sections.some(declaresRole)) return sections;

  return sections.map((section) => (declaresRole(section) ? sectionWithRoles(section, table) : section));
}
