export function requirementSummary(
  clips: string[],
  fields: string[],
  contract: ReadonlyArray<{ name: string; type: string }> | undefined
): string {
  return [
    clips.length > 0 ? `clips: ${clips.join(', ')}` : 'no clips',
    fields.length > 0 ? `fields: ${fields.join(', ')}` : 'no fields',
    ...(contract ? [`declared fields: ${contract.map((field) => `${field.name} (${field.type})`).join(', ')}`] : []),
  ].join('; ');
}
