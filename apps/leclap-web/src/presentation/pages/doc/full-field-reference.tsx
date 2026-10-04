import { useState } from 'react';
import { DocSection, FieldTable, Prose } from '@/presentation/components/doc/DocBlocks';
import { fullReferenceGroups } from '@/presentation/components/doc/fullFieldReference';
import type { FieldRow } from '@/presentation/components/doc/schemaFields';

const FieldGroup = ({ name, rows }: { name: string; rows: FieldRow[] }) => {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="rounded-xl border border-divider p-4"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer font-mono text-sm font-semibold text-foreground">
        {name} · {rows.length} fields/variants
      </summary>
      {open ? (
        <div className="mt-4">
          <FieldTable rows={rows} />
        </div>
      ) : null}
    </details>
  );
};

export const FullFieldReference = () => (
  <DocSection id="complete-field-index" title="Complete field index">
    <Prose>
      <p>
        These tables come directly from the current descriptor schema and include nested fields, each union variant, all
        enum choices, numeric/string/array bounds, defaults and strict object rules. Required means required within its
        parent object; an optional parent does not become mandatory. Variant labels keep type-specific rules separate.
        Dynamic keys appear as [key]; recursive JSON references stop after one expansion. Cross-field and rendering
        rules are described above. Open only the group you need.
      </p>
    </Prose>
    {fullReferenceGroups().map((group) => (
      <FieldGroup key={group.name} {...group} />
    ))}
  </DocSection>
);
