import { Children, isValidElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code, JsonBlock, Prose } from './DocBlocks';

const REPO = 'https://github.com/heristop/leclap/blob/main/';
const DOC_PAGES: Record<string, string> = {
  'template-configuration.md': '/doc/reference',
  'engine-configuration.md': '/doc/engine',
  'effects-configuration.md': '/doc/effects',
  'creative-direction.md': '/doc/creative-direction',
  'template-descriptor.schema.json': '/doc/schema',
};

export function referenceHref(href: string): string {
  if (/^(?:[a-z]+:|\/|#)/i.test(href)) return href;
  const [file, anchor] = href.split('#');
  const page = DOC_PAGES[file.replace(/^\.\//, '')];

  if (page) return page + (anchor ? `#${anchor}` : '');
  // Canonical source documents live in docs/; normalize their relative links against that directory.
  return new URL(href, `${REPO}docs/`).toString();
}

const textOf = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children);

      return typeof child === 'string' || typeof child === 'number' ? String(child) : '';
    })
    .join('');

export function referenceHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const components: Components = {
  h1: () => null,
  a: ({ href, children }) => <a href={referenceHref(href ?? '')}>{children}</a>,
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto rounded-xl border border-divider">
      <table className="w-full border-collapse text-left text-sm [&_th]:bg-surface-2 [&_th]:p-3 [&_td]:border-t [&_td]:border-divider [&_td]:p-3 [&_td]:align-top">
        {children}
      </table>
    </div>
  ),
  pre: ({ children }) => {
    const element = Children.toArray(children)[0];
    const props = isValidElement<{ className?: string; children?: ReactNode }>(element) ? element.props : undefined;
    const language = props?.className?.replace('language-', '') ?? '';
    const code = textOf(props?.children ?? children).replace(/\n$/, '');

    if (language === 'json' || language === 'jsonc') return <JsonBlock code={code} />;

    return (
      <pre
        className="max-w-full overflow-x-auto rounded-xl border border-divider bg-surface-2 p-4 text-sm"
        data-language={language}
      >
        <code>{code}</code>
      </pre>
    );
  },
  code: ({ children }) => <Code>{children}</Code>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary pl-4">{children}</blockquote>,
};

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: { id?: string } };
}

// Allocate duplicate-safe anchors while parsing, so React rerenders cannot change them.
function referenceHeadings() {
  return (tree: MarkdownNode) => {
    const usedIds = new Map<string, number>();
    const nodeText = (node: MarkdownNode): string => node.value ?? (node.children ?? []).map(nodeText).join('');
    function visit(node: MarkdownNode) {
      if (node.type === 'heading') {
        const slug = referenceHeadingId(nodeText(node));
        const count = usedIds.get(slug) ?? 0;
        usedIds.set(slug, count + 1);
        node.data ??= {};
        node.data.hProperties = { id: count === 0 ? slug : `${slug}-${count}` };
      }

      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}

const headingTags = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;

const heading =
  (level: 2 | 3 | 4 | 5 | 6): Components['h2'] =>
  ({ children, node }) => {
    const id = node?.properties.id ?? referenceHeadingId(textOf(children));
    const Tag = headingTags[level];

    return (
      <div id={id} data-toc-level={level === 2 ? '2' : undefined} className="scroll-mt-12 pt-4 xl:scroll-mt-4">
        <Tag
          className={
            level === 2
              ? 'font-display text-2xl font-bold text-foreground'
              : 'font-display text-xl font-semibold text-foreground'
          }
        >
          <a href={`#${id}`}>{children}</a>
        </Tag>
      </div>
    );
  };
const articleComponents: Components = {
  ...components,
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
};

export const ReferenceArticle = ({ source }: { source: string }) => (
  <Prose className="max-w-none space-y-5 [&>p]:max-w-[33rem] [&>ul]:max-w-[33rem] [&>ol]:max-w-[33rem]">
    <Markdown remarkPlugins={[remarkGfm, referenceHeadings]} components={articleComponents} skipHtml>
      {source}
    </Markdown>
  </Prose>
);
