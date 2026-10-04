import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { typeLabel, type FieldRow, type JsonSchemaNode } from './schemaFields';

type ReferenceNode = Omit<JsonSchemaNode, 'properties' | 'items' | 'anyOf' | 'oneOf'> & {
  $ref?: string;
  $defs?: Record<string, ReferenceNode>;
  properties?: Record<string, ReferenceNode>;
  items?: ReferenceNode;
  anyOf?: ReferenceNode[];
  oneOf?: ReferenceNode[];
  additionalProperties?: boolean | ReferenceNode;
  multipleOf?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};

function referenceProperty(node: ReferenceNode, key: string): ReferenceNode | undefined {
  return node.properties?.[key];
}

const boundLabels = {
  minimum: '≥',
  maximum: '≤',
  exclusiveMinimum: '>',
  exclusiveMaximum: '<',
  minLength: 'length ≥',
  maxLength: 'length ≤',
  minItems: 'items ≥',
  maxItems: 'items ≤',
} as const;

export function fullConstraints(node: ReferenceNode): string {
  const constraints: string[] = [];

  if (node.enum) constraints.push(`one of ${node.enum.join(', ')}`);

  for (const key of Object.keys(boundLabels) as (keyof typeof boundLabels)[]) {
    if (node[key] !== undefined) constraints.push(`${boundLabels[key]} ${node[key]}`);
  }

  if (node.multipleOf !== undefined) constraints.push(`multiple of ${node.multipleOf}`);

  if (node.pattern) constraints.push(`pattern ${node.pattern}`);

  if (node.additionalProperties === false) constraints.push('unknown keys rejected');

  if (node.default !== undefined) constraints.push(`default ${JSON.stringify(node.default)}`);

  return constraints.join(' · ');
}

function resolveReference(root: ReferenceNode, reference: string): ReferenceNode | null {
  const target = reference
    .slice(2)
    .split('/')
    .reduce<unknown>((value, key) => {
      if (!value || typeof value !== 'object') return null;

      return (value as Record<string, unknown>)[key.replaceAll('~1', '/').replaceAll('~0', '~')];
    }, root);

  if (target && typeof target === 'object') return target;

  return null;
}

export function recursiveFieldRows(node: ReferenceNode, prefix: string, root: ReferenceNode = node): FieldRow[] {
  const rows: FieldRow[] = [];
  function walk(current: ReferenceNode, name: string, required: boolean, refs: ReadonlySet<string>) {
    rows.push({
      name,
      type: current.$ref ? 'reference' : typeLabel(current),
      constraints: fullConstraints(current),
      description: current.description ?? '',
      required,
    });

    if (current.$ref) {
      if (refs.has(current.$ref) || !current.$ref.startsWith('#/')) return;
      const target = resolveReference(root, current.$ref);

      if (target) {
        walk(target, `${name} (expanded)`, required, new Set([...refs, current.$ref]));
      }

      return;
    }
    walkChildren(current, name, refs);
  }
  function walkChildren(current: ReferenceNode, name: string, refs: ReadonlySet<string>) {
    for (const [key, child] of Object.entries(current.properties ?? {})) {
      walk(child, `${name}.${key}`, current.required?.includes(key) ?? false, refs);
    }

    if (current.items) walk(current.items, `${name}[]`, false, refs);

    if (typeof current.additionalProperties === 'object') {
      walk(current.additionalProperties, `${name}[key]`, false, refs);
    }

    for (const [index, variant] of (current.anyOf ?? current.oneOf ?? []).entries()) {
      const discriminant = referenceProperty(variant, 'type')?.const;
      walk(
        variant,
        `${name} (${discriminant === undefined ? `variant ${index + 1}` : `type=${discriminant}`})`,
        false,
        refs
      );
    }
  }
  walk(node, prefix, false, new Set());

  return rows;
}

export function fullReferenceGroups(): { name: string; rows: FieldRow[] }[] {
  const root = templateDescriptorJsonSchema as ReferenceNode;
  const groups = Object.entries(root.properties ?? {})
    .filter(([name]) => name !== 'sections')
    .map(([name, node]) => ({ name, rows: recursiveFieldRows(node, name, root) }));
  const sections = referenceProperty(root, 'sections')?.items;

  for (const node of sections?.anyOf ?? sections?.oneOf ?? []) {
    const type = referenceProperty(node, 'type')?.const;
    groups.push({ name: `sections: ${type}`, rows: recursiveFieldRows(node, `sections[${type}]`, root) });
  }

  return groups;
}
