// The two optional "bring your own look" groups of Generate with AI, side by side: match a reference,
// and import a brand kit. Both end up as binding rules in the prompt.
import type { ReferenceStyle } from '@/infrastructure/style/analyze-reference';
import { BrandKitSection } from './BrandKitSection';
import { ReferenceStyleSection } from './ReferenceStyleSection';

interface BindingSectionsProps {
  referenceAttached: boolean;
  onAttachReference: (style: ReferenceStyle) => void;
  onDetachReference: () => void;
  brand: { name: string } | null;
  onAttachBrand: (kit: { name: string; rules: string }) => void;
  onDetachBrand: () => void;
  disabled: boolean;
}

export const BindingSections = (props: BindingSectionsProps) => (
  <>
    <ReferenceStyleSection
      attached={props.referenceAttached}
      onAttach={props.onAttachReference}
      onDetach={props.onDetachReference}
      disabled={props.disabled}
    />
    <BrandKitSection
      attached={props.brand?.name ?? null}
      onAttach={props.onAttachBrand}
      onDetach={props.onDetachBrand}
      disabled={props.disabled}
    />
  </>
);
