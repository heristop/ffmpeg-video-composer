// Turns a rendered doc page into Markdown and builds the "take this page elsewhere" links used by the
// docs Copy-page menu. Pages combine JSX and canonical Markdown, so we serialise the live DOM at
// click time — the output always matches what the reader sees. The link/prompt builders and the per-block
// formatters are pure and unit-tested; the DOM walk that feeds them is exercised in the browser.

export type AiProvider = 'chatgpt' | 'claude';
export type McpEditor = 'cursor' | 'vscode';

// Keep inlined page content well under common URL ceilings when handing a page to a chat assistant.
const MAX_INLINE_MARKDOWN = 6000;

// The MCP server the editor deep-links install: `npx` resolves the published `@leclap/mcp` package, so
// the one-click install needs no checkout.
const MCP_NAME = 'leclap';
const MCP_CONFIG = { command: 'npx', args: ['-y', '@leclap/mcp'] };

const AI_ENDPOINT: Record<AiProvider, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
};

export function truncateMarkdown(markdown: string, url: string, max = MAX_INLINE_MARKDOWN): string {
  if (markdown.length <= max) return markdown;

  return `${markdown.slice(0, max)}\n\n…(truncated — full page at ${url})`;
}

export function chatPrompt(title: string, url: string, markdown: string): string {
  const body = truncateMarkdown(markdown, url);

  return `I'm reading the LeClap docs page "${title}" (${url}). Here is its content:\n\n${body}\n\nHelp me understand it and answer my questions about it.`;
}

export function aiChatUrl(provider: AiProvider, title: string, url: string, markdown: string): string {
  return `${AI_ENDPOINT[provider]}?q=${encodeURIComponent(chatPrompt(title, url, markdown))}`;
}

export function mcpInstallUrl(editor: McpEditor): string {
  if (editor === 'cursor') {
    const config = btoa(JSON.stringify(MCP_CONFIG));

    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_NAME}&config=${encodeURIComponent(config)}`;
  }

  const payload = JSON.stringify({ name: MCP_NAME, ...MCP_CONFIG });

  return `vscode:mcp/install?${encodeURIComponent(payload)}`;
}

// ── Block formatters ─────────────────────────────────────────────────────────────

// A code span fenced past the longest backtick run inside it (the CommonMark rule), padded when the
// content starts or ends with a tick so the fence can't fuse with it.
export function inlineCode(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${text}${pad}${fence}`;
}

// A command pill: the command a reader would copy, then what it does.
export function commandItemMd(command: string, label: string): string {
  const item = `- ${inlineCode(command)}`;

  return label ? `${item} — ${label}` : item;
}

// One DefList row — a flag, an env var, an MCP tool: name (meta) — meaning.
export function definitionMd(term: string, meta: string, description: string): string {
  const head = meta ? `${inlineCode(term)} (${meta})` : inlineCode(term);

  return description ? `- ${head} — ${description}` : `- ${head}`;
}

// A Callout or Tip. Serialised as plain text the label ran straight into the body ("TipUse absolute
// paths"), so it becomes a bold lead-in instead.
export function calloutMd(label: string, body: string): string {
  if (!body) return '';

  return label ? `> **${label}:** ${body}` : `> ${body}`;
}

// ── DOM → Markdown ───────────────────────────────────────────────────────────────
// Browser-only. Walks the rendered doc content into block-level Markdown, handling the elements our
// DocBlocks actually emit (headings, prose, inline code, JSON blocks, field tables, definition lists,
// command pills, callouts, chips).

// Interactive / non-content nodes (the Copy-page toolbar, copy buttons, PM switchers, scripts). A
// command pill is a button too, but it carries content — it opts back in with `data-md-command`.
const SKIP_TAGS = new Set(['button', 'script', 'style']);

// `Node.textContent` is typed `string | null`; normalise it to a plain string in one place. Routing the
// null through an explicitly-typed param also keeps both tsc and the lint's nullability view in agreement.
const textOf = (value: string | null): string => value ?? '';
const collapse = (text: string | null): string => textOf(text).replace(/\s+/g, ' ').trim();

const resolveHref = (href: string | null): string => {
  if (!href) return '';

  if (href.startsWith('#')) return href;

  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return href;
  }
};

// Serialise one inline child element (code, emphasis, link, line break) to Markdown.
const inlineChildMd = (child: HTMLElement): string => {
  const tag = child.tagName.toLowerCase();

  if (tag === 'code') return `\`${collapse(child.textContent)}\``;

  if (tag === 'strong' || tag === 'b') return `**${inlineMd(child).trim()}**`;

  if (tag === 'em' || tag === 'i') return `_${inlineMd(child).trim()}_`;

  if (tag === 'br') return '\n';

  if (tag === 'a') {
    const text = inlineMd(child).trim();

    // DocSection headings carry a bare "#" permalink anchor — drop it.
    if (!text || text === '#') return '';

    return `[${text}](${resolveHref(child.getAttribute('href'))})`;
  }

  return inlineMd(child);
};

// Serialise an element's inline content (text, code, emphasis, links) to Markdown.
function inlineMd(node: Node): string {
  let out = '';

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';

      continue;
    }

    if (child instanceof HTMLElement) out += inlineChildMd(child);
  }

  return out;
}

// KineticHeading splits its title into one span per word with no text between them, so its
// textContent reads "Thetemplatedescriptor"; its aria-label carries the title as written.
const headingText = (el: HTMLElement): string =>
  el.getAttribute('aria-label') ?? collapse(el.textContent).replace(/\s*#$/, '');

// JsonBlock renders each line as a grid row: an aria-hidden line-number span + the content span.
// Take the last span per row so the gutter numbers don't leak into the fence.
const preText = (pre: HTMLElement): string => {
  const rows = pre.querySelectorAll('code > div');

  if (rows.length === 0) return textOf(pre.textContent);

  return [...rows]
    .map((row) => {
      const spans = [...row.querySelectorAll(':scope > span')];

      return spans.at(-1)?.textContent ?? '';
    })
    .join('\n');
};

// A field cell stacks the name and its description in one <td>; join such block pieces with a dash
// so they don't run together ("name — description" rather than "namedescription").
const cellText = (cell: HTMLElement): string => {
  const parts = [...cell.children].map((child) => collapse(child.textContent)).filter(Boolean);
  const text = parts.length > 1 ? parts.join(' — ') : collapse(cell.textContent);

  return text.replace(/\|/g, String.raw`\|`);
};

const tableMd = (table: HTMLElement): string => {
  const headers = [...table.querySelectorAll('thead th')].map((th) => collapse(th.textContent));
  const bodyRows = [...table.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => cellText(td))
  );

  if (headers.length === 0 && bodyRows.length === 0) return '';

  const width = headers.length > 0 ? headers.length : (bodyRows[0]?.length ?? 0);
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  const body = bodyRows.map((cells) => `| ${cells.join(' | ')} |`).join('\n');

  return [head, sep, body].filter(Boolean).join('\n');
};

const listMd = (list: HTMLElement): string =>
  [...list.querySelectorAll(':scope > li')].map((li) => `- ${collapse(inlineMd(li))}`).join('\n');

// DefList rows are `dt` + an optional mono meta `dd` + the meaning `dd`.
const definitionOf = (term: HTMLElement): string => {
  const defs: HTMLElement[] = [];
  let next = term.nextElementSibling;

  while (next instanceof HTMLElement && next.tagName === 'DD') {
    defs.push(next);
    next = next.nextElementSibling;
  }

  const meta = defs.length > 1 ? collapse(defs[0].textContent) : '';
  const meaning = defs.at(-1);

  return definitionMd(collapse(term.textContent), meta, meaning ? collapse(inlineMd(meaning)) : '');
};

const dlMd = (list: HTMLElement): string =>
  [...list.querySelectorAll('dt')].map((term) => definitionOf(term)).join('\n');

// Callout / Tip: a label row, then the body.
const asideMd = (aside: HTMLElement): string => {
  const label = aside.firstElementChild;
  const body = [...aside.children].slice(1);

  if (!label) return '';

  if (body.length === 0) return calloutMd('', collapse(inlineMd(label)));

  return calloutMd(collapse(label.textContent), body.map((child) => collapse(inlineMd(child))).join(' '));
};

// Blocks serialised whole, by tag; anything else is a container the walk descends into.
const BLOCKS: Partial<Record<string, (el: HTMLElement) => string>> = {
  pre: (el) => `\`\`\`${el.dataset.language ?? 'json'}\n${preText(el)}\n\`\`\``,
  table: tableMd,
  ul: listMd,
  ol: listMd,
  dl: dlMd,
  aside: asideMd,
};

// Markdown for one block-level element, or null when it's a container whose children carry the blocks.
const blockMd = (el: HTMLElement): string | null => {
  const tag = el.tagName.toLowerCase();
  const { mdCommand, mdLabel } = el.dataset;

  if (mdCommand !== undefined) return commandItemMd(mdCommand, mdLabel ?? '');

  if (SKIP_TAGS.has(tag)) return '';

  if (/^h[1-4]$/.test(tag)) {
    const text = headingText(el);

    return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
  }

  // Decorative uppercase eyebrows/kickers restate the heading that follows — drop them.
  if (tag === 'p') return el.className.includes('uppercase') ? '' : inlineMd(el).trim();

  const block = BLOCKS[tag];

  return block ? block(el) : null;
};

// Append the Markdown for one element (and, for containers, its descendants) to `blocks`.
const walk = (el: HTMLElement, blocks: string[]): void => {
  const md = blockMd(el);

  if (md === null) {
    for (const child of el.childNodes) {
      if (child instanceof HTMLElement) walk(child, blocks);
    }

    return;
  }

  if (md) blocks.push(md);
};

export function elementToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  walk(root, blocks);

  return blocks.join('\n\n');
}

export function pageTitle(root: HTMLElement): string {
  const h1 = root.querySelector('h1');

  return h1 ? headingText(h1).trim() : document.title;
}

export function pageMarkdown(root: HTMLElement, url: string): string {
  return `${elementToMarkdown(root)}\n\n---\nSource: ${url}\n`;
}
