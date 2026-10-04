// Deep-replace every `{{ key }}` placeholder in a partial's sections with the matching ref variable.
// Keys absent from `variables` are left untouched, so a partial may still reference global template
// variables (resolved later by the engine). Values are inserted verbatim and never re-scanned.
export function applyVariables<T>(node: T, variables: Record<string, string>): T {
  if (typeof node === 'string') {
    return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
    ) as unknown as T;
  }

  if (Array.isArray(node)) {
    return node.map((item) => applyVariables(item, variables)) as unknown as T;
  }

  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, applyVariables(value, variables)])) as T;
  }

  return node;
}
