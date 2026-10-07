// Per-format findings, merged: a descriptor that declares several formats is validated once per format,
// and a finding every format shares is reported once, as is; one that only some formats raise carries
// them in its message ("[portrait, square] …"), so an author knows which composition to fix.

import type { FormatName } from './marker';

interface Finding {
  path: string;
  code: string;
  message: string;
}

export type FormatFindings<T> = readonly (readonly [FormatName, readonly T[]])[];

export function mergeFormatFindings<T extends Finding>(perFormat: FormatFindings<T>): T[] {
  const groups = new Map<string, { finding: T; formats: FormatName[] }>();

  for (const [format, findings] of perFormat) {
    for (const finding of findings) {
      const key = `${finding.code}\u0000${finding.path}\u0000${finding.message}`;
      const group = groups.get(key) ?? { finding, formats: [] };

      if (!group.formats.includes(format)) group.formats.push(format);
      groups.set(key, group);
    }
  }

  return [...groups.values()].map(({ finding, formats }) =>
    formats.length === perFormat.length
      ? finding
      : { ...finding, message: `[${formats.join(', ')}] ${finding.message}` }
  );
}
