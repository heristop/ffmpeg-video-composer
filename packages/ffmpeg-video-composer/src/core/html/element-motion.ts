// Per-element motion inside an HTML layer: the elements tagged `data-motion="name"` (kept by the sanitiser,
// carried on LayerElement.props.motion by the layout), and the tree as it draws at one instant, each tagged
// element offset, turned, scaled and faded by its state on top of its own CSS. Pure; the frame planner
// decides which instants are drawn. The motion names never reach the rasteriser.

import type { LayerStyle } from './css-properties';
import { styleValue, type LayerChild, type LayerElement } from './html-element';

export interface ElementState {
  /** Offset from the laid-out position, in output pixels. */
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise. */
  rotate: number;
  opacity: number;
}

export const REST_STATE: ElementState = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

function collectTargets(element: LayerElement, names: string[]): void {
  if (element.props.motion !== undefined) names.push(element.props.motion);

  for (const child of element.props.children ?? []) {
    if (typeof child !== 'string') collectTargets(child, names);
  }
}

/** The motion names of the tagged elements in document order (pre-order), one entry per element. */
export function motionTargets(element: LayerElement): string[] {
  const names: string[] = [];

  collectTargets(element, names);

  return names;
}

function isRest(state: ElementState): boolean {
  return state.x === 0 && state.y === 0 && state.scale === 1 && state.rotate === 0 && state.opacity === 1;
}

function authoredOpacity(style: LayerStyle): number {
  const raw = styleValue(style, 'opacity')?.trim() ?? '1';
  const value = Number.parseFloat(raw);

  if (!Number.isFinite(value)) return 1;

  return raw.endsWith('%') ? value / 100 : value;
}

// The motion goes first, so the element turns and scales about its own centre after its authored transform.
function motionTransform(state: ElementState, authored: string | undefined): string {
  return [
    state.x === 0 && state.y === 0 ? '' : `translate(${state.x}px, ${state.y}px)`,
    state.rotate === 0 ? '' : `rotate(${state.rotate}deg)`,
    state.scale === 1 ? '' : `scale(${state.scale})`,
    authored ?? '',
  ]
    .filter((part) => part !== '')
    .join(' ');
}

function styled(style: LayerStyle, state: ElementState): LayerStyle {
  if (isRest(state)) return style;

  const out: LayerStyle = { ...style };
  const transform = motionTransform(state, styleValue(style, 'transform'));
  const opacity = Math.round(authoredOpacity(style) * state.opacity * 10_000) / 10_000;

  if (transform !== '') out.transform = transform;

  if (opacity !== 1) out.opacity = String(opacity);

  return out;
}

function applyNode(node: LayerElement, states: readonly ElementState[], cursor: { index: number }): LayerElement {
  const props = { ...node.props };

  delete props.motion;

  if (node.props.motion !== undefined) {
    props.style = styled(node.props.style, states[cursor.index] ?? REST_STATE);
    cursor.index++;
  }

  const children = node.props.children?.map((child): LayerChild =>
    typeof child === 'string' ? child : applyNode(child, states, cursor)
  );

  return { type: node.type, props: children ? { ...props, children } : props };
}

/** The tree with the i-th tagged element (document order) in `states[i]`, rest when missing; no motion names. */
export function applyMotionStates(element: LayerElement, states: readonly ElementState[]): LayerElement {
  return applyNode(element, states, { index: 0 });
}

/** The tree as authored, its motion names removed (what a still card draws). */
export function stripMotion(element: LayerElement): LayerElement {
  return applyMotionStates(element, []);
}
