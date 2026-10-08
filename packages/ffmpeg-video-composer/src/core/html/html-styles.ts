// The cascade of an HTML layer, reduced to what its subset needs: every rule whose selector matches an
// element (ordered by specificity, then source order), then the element's own `style` attribute, folded
// into one inline style per element.

import { parseDeclarations, type CssCompound, type CssDeclaration, type CssRule, type Stylesheet } from './css-parse';
import { toLayerStyle, type LayerStyle } from './css-properties';
import type { HtmlElementNode, HtmlNode } from './html-parse';
import type { HtmlFinding } from './html-sanitise';

export interface StyledElement {
  tag: string;
  attrs: Partial<Record<string, string>>;
  style: LayerStyle;
  children: StyledNode[];
}

export type StyledNode = StyledElement | string;

interface Subject {
  tag: string;
  classes: string[];
}

function subjectOf(element: HtmlElementNode): Subject {
  return { tag: element.tag, classes: (element.attrs.class ?? '').split(/\s+/).filter(Boolean) };
}

function matchesCompound(compound: CssCompound, subject: Subject): boolean {
  if (compound.tag !== undefined && compound.tag !== subject.tag) return false;

  return compound.classes.every((name) => subject.classes.includes(name));
}

// Descendant selectors only: the last compound is the element, the others appear among its ancestors in
// order (nearest first, matched greedily, which is exact when every combinator is a descendant one).
function matches(rule: CssRule, subject: Subject, ancestors: Subject[]): boolean {
  const compounds = rule.selector.compounds;

  const last = compounds.at(-1);

  if (!last || !matchesCompound(last, subject)) return false;

  let next = compounds.length - 2;

  for (let index = ancestors.length - 1; index >= 0 && next >= 0; index--) {
    if (matchesCompound(compounds[next], ancestors[index])) next--;
  }

  return next < 0;
}

function ruleDeclarations(element: HtmlElementNode, ancestors: Subject[], sheet: Stylesheet): CssDeclaration[] {
  const subject = subjectOf(element);
  const matched = sheet.rules
    .filter((rule) => matches(rule, subject, ancestors))
    .sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order);

  return matched.flatMap((rule) => rule.declarations);
}

interface Walk {
  sheet: Stylesheet;
  findings: HtmlFinding[];
  seen: Set<string>;
}

function styleElement(element: HtmlElementNode, ancestors: Subject[], walk: Walk): StyledElement {
  const fromRules = toLayerStyle(ruleDeclarations(element, ancestors, walk.sheet), 'css');
  const inline = toLayerStyle(parseDeclarations(element.attrs.style ?? ''), 'html');
  const style = { ...fromRules.style, ...inline.style };

  for (const finding of [...fromRules.findings, ...inline.findings]) {
    if (walk.seen.has(finding.message)) continue;

    walk.seen.add(finding.message);
    walk.findings.push(finding);
  }

  const lineage = [...ancestors, subjectOf(element)];
  const attrs = Object.fromEntries(Object.entries(element.attrs).filter(([name]) => name !== 'style'));

  return { tag: element.tag, attrs, style, children: styleNodes(element.children, lineage, walk) };
}

function styleNodes(nodes: HtmlNode[], ancestors: Subject[], walk: Walk): StyledNode[] {
  return nodes.map((node) => (node.kind === 'text' ? node.text : styleElement(node, ancestors, walk)));
}

/** The sanitised tree with each element's computed inline style, and the CSS it had to drop. */
export function styleTree(nodes: HtmlNode[], sheet: Stylesheet): { nodes: StyledNode[]; findings: HtmlFinding[] } {
  const walk: Walk = { sheet, findings: [], seen: new Set() };

  return { nodes: styleNodes(nodes, [], walk), findings: walk.findings };
}
