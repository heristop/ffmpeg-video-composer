import { Seo } from '@/presentation/components/Seo';
import { ReferenceArticle } from '@/presentation/components/doc/ReferenceArticle';
import { DocPageHeader } from './DocLayout';
import templateSource from '../../../../../../docs/template-configuration.md?raw';
import effectsSource from '../../../../../../docs/effects-configuration.md?raw';
import engineSource from '../../../../../../docs/engine-configuration.md?raw';
import directionSource from '../../../../../../docs/creative-direction.md?raw';
import { FullFieldReference } from './full-field-reference';

const ReferencePage = ({
  title,
  description,
  path,
  source,
  fields = false,
}: {
  title: string;
  description: string;
  path: string;
  source: string;
  fields?: boolean;
}) => (
  <>
    <Seo title={`${title} — LeClap reference`} description={description} path={path} />
    <DocPageHeader kicker="Complete reference" title={title}>
      {description}
    </DocPageHeader>
    <ReferenceArticle source={source} />
    {fields ? <FullFieldReference /> : null}
  </>
);

export const DocReference = () => (
  <ReferencePage
    title="Template configuration"
    path="/doc/reference"
    description="Every native template feature, field, timing rule and example, with a complete schema-derived field index."
    source={templateSource}
    fields
  />
);
export const DocEffects = () => (
  <ReferencePage
    title="Registered effects"
    path="/doc/effects"
    description="Every built-in and example catalog effect: props, defaults, bounds, asset slots, timing, registration, preview and reproducibility."
    source={effectsSource}
  />
);
export const DocEngine = () => (
  <ReferencePage
    title="Engine configuration"
    path="/doc/engine"
    description="ProjectConfig, encoder tiers, configuration precedence, CLI bindings, MCP runtime settings and platform limits."
    source={engineSource}
  />
);
export const DocCreativeDirection = () => (
  <ReferencePage
    title="Creative direction"
    path="/doc/creative-direction"
    description="Turn a visual brief into explicit, validated motion settings; discover samples and inspect the rendered result."
    source={directionSource}
  />
);
