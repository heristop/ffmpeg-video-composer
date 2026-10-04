import { Link } from 'react-router-dom';
import { Seo } from '@/presentation/components/Seo';
import { Code, DocSection, DocSubsection, JsonBlock } from '@/presentation/components/doc/DocBlocks';
import { examples } from '@/presentation/components/doc/examples';
import { DocPageHeader } from './DocLayout';

export const DocExamples = () => (
  <>
    <Seo
      title="Examples — template descriptor"
      description="Copy-paste LeClap template descriptors you can save as JSON and render with the CLI."
      path="/doc/examples"
    />

    <DocPageHeader kicker="Copy-paste" title="Example descriptors">
      Complete, runnable descriptors. Save any one as a <Code>.json</Code> file and render it with{' '}
      <Code>leclap render</Code>. Discover the complete catalog with <Code>leclap samples list</Code> or MCP{' '}
      <Code>list_samples</Code>; <Link to="/showcase">watch the showcase</Link> and inspect required media before
      rendering. Registered samples need the <Link to="/doc/effects">configured effect backend</Link>.
    </DocPageHeader>

    <DocSection id="examples" title="Examples" kicker={`${examples.length} templates`}>
      <div className="space-y-12">
        {examples.map((example) => (
          <DocSubsection key={example.id} id={example.id} title={example.title}>
            <p className="mb-4 max-w-[33rem] text-sm leading-6 text-gray-400">{example.blurb}</p>
            <JsonBlock code={example.json} />
          </DocSubsection>
        ))}
      </div>
    </DocSection>
  </>
);
