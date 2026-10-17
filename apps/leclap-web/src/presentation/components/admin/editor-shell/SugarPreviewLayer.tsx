// WYSIWYG rendering + direct manipulation of the text-sugar fields (caption / titleCard /
// lowerThird) on the center SectionCanvas. Layout comes from the pure preview modules
// (captionPreview / titleCardPreview / lowerThirdPreview), which mirror the engine's
// drawtext/drawbox geometry; gestures translate to the descriptor-legal fields via the pure
// sugarCanvasEditing helpers:
//   - click selects the block (drives the left inspector),
//   - double-click / Enter inline-edits the clicked LINE (kicker/headline/…, title/…, caption text),
//   - dragging snaps to the engine's allowed slots (titleCard align, lowerThird/caption position) —
//     free x/y needs the "Detach into text elements" action,
//   - the caption (the only sugar with a fontsize field) gets corner resize handles,
//   - Delete/Backspace clears the block.
// The wrapping layer is pointer-events-none so dragging regular overlays through it keeps working;
// each sugar piece re-enables its own pointer events. The layer sits in the engine's z-order: above
// the backdrop and media overlays, below the draggable text overlays.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { resolvePreviewColor } from '@leclap/creative-kit/editor';
import { cn } from '@/lib/utils';
import { displayFromTokens, tokensFromDisplay } from '@/lib/variableSyntax';
import { useColorVariables } from '@/presentation/components/ui';
import { FloatingVariableSuggestions, useVariableAutocomplete } from '../editor/variableAutocomplete';
import type { EditorCaption, LowerThird, Orientation, TitleCard } from '../templateEditorModel';
import { fontSizeFromResize } from '../overlayGeometry';
import { rgba } from './sectionCanvasColor';
import { captionPreview } from './captionPreview';
import { titleCardPreview } from './titleCardPreview';
import { lowerThirdPreview } from './lowerThirdPreview';
import { commitSugarLine, sugarDragPatch, sugarLineKeys, sugarLineText } from './sugarCanvasEditing';
import { textEffectCss } from './textEffectCss';
import type { SugarKind } from './sectionElements';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';
import {
  previewScale,
  type SugarAnchorX,
  type SugarAnchorY,
  type SugarBand,
  type SugarBar,
  type SugarTextLine,
} from './sugarPreviewGeometry';

type AnySugar = EditorCaption | TitleCard | LowerThird;

// Track the live height of the canvas frame so the sugar geometry rescales with the monitor. An
// effect + ResizeObserver (not a one-shot read) because the frame is CSS-sized and 0px on first
// paint; SSR renders nothing, which is fine for a preview layer. Exported for the program monitor's
// playback surface, which sizes its overlay typography off the same live frame height.
export function useFrameHeight(frameRef: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = frameRef.current;
    let observer: ResizeObserver | null = null;

    if (el) {
      const measure = () => {
        setHeight(el.getBoundingClientRect().height);
      };

      measure();
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }

    return () => {
      observer?.disconnect();
    };
  }, [frameRef]);

  return height;
}

// CSS left/right/top/bottom (+ centering transforms) for a sugar box's anchors — the drawtext
// x/y expressions rendered as absolute positioning. `shift` adds the in-flight drag offset.
function anchorStyle(x: SugarAnchorX, y: SugarAnchorY, shift?: { dx: number; dy: number }): CSSProperties {
  const style: CSSProperties = { position: 'absolute' };
  const transforms: string[] = [];

  if (x.side === 'center') {
    style.left = '50%';
    transforms.push('translateX(-50%)');
  }

  if (x.side === 'left') style.left = x.px;

  if (x.side === 'right') style.right = x.px;

  if (y.edge === 'center') {
    style.top = '50%';
    transforms.push('translateY(-50%)');
  }

  if (y.edge === 'top') style.top = y.px;

  if (y.edge === 'bottom') style.bottom = y.px;

  if (shift) transforms.push(`translate(${shift.dx}px, ${shift.dy}px)`);

  if (transforms.length > 0) style.transform = transforms.join(' ');

  return style;
}

// In-flight drag: which block follows the pointer, by how much.
type DragOffset = { kind: SugarKind; dx: number; dy: number } | null;

// Corner-resize support (caption only — the one sugar carrying a fontsize field).
interface ResizeSupport {
  onResizeStart: (clientX: number, clientY: number, body: HTMLElement | null) => void;
  onResizeMove: (clientX: number, clientY: number) => void;
}

// Everything a piece needs to run its gestures; built once per sugar kind by the layer.
interface PieceGestures {
  label: string;
  active: boolean;
  onSelect: (lineIndex: number) => void;
  onStartEdit: (lineIndex: number) => void;
  onDragMove: (dx: number, dy: number) => void;
  onDragEnd: (clientX: number, clientY: number, moved: boolean) => void;
  onClear: () => void;
}

// Shared pointer/keyboard gesture wiring for a sugar piece (a text line or the band): select on
// press, drag with pointer capture (snap on release), double-click/Enter to edit, Delete/Backspace
// to clear the block. Modeled on OverlayBox so sugar feels like any other canvas element.
function usePieceGestures(
  gestures: PieceGestures,
  lineIndex: number,
  bodyRef: RefObject<HTMLElement | null>,
  resize?: ResizeSupport
) {
  const modeRef = useRef<'move' | 'resize' | null>(null);
  const startRef = useRef<{ x: number; y: number; moved: boolean }>({ x: 0, y: 0, moved: false });

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    gestures.onSelect(lineIndex);
    modeRef.current = 'move';
    startRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (modeRef.current === null) return;
    e.stopPropagation();

    if (modeRef.current === 'resize') {
      resize?.onResizeMove(e.clientX, e.clientY);

      return;
    }

    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    // A 3px slop keeps plain clicks (and double-clicks) from registering as drags.
    if (!startRef.current.moved && Math.hypot(dx, dy) < 3) return;

    startRef.current.moved = true;
    gestures.onDragMove(dx, dy);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const mode = modeRef.current;
    modeRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

    if (mode !== 'move') return;

    gestures.onDragEnd(e.clientX, e.clientY, startRef.current.moved);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    modeRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    gestures.onDragEnd(e.clientX, e.clientY, false);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLElement>) => {
    e.stopPropagation();
    gestures.onStartEdit(lineIndex);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      gestures.onStartEdit(lineIndex);

      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      gestures.onSelect(lineIndex);

      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // stopPropagation so the shell's delete-scene shortcut never fires from a sugar block.
      e.preventDefault();
      e.stopPropagation();
      gestures.onClear();
    }
  };

  const onResizeHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resize) return;

    e.stopPropagation();
    gestures.onSelect(lineIndex);
    modeRef.current = 'resize';
    resize.onResizeStart(e.clientX, e.clientY, bodyRef.current);
    bodyRef.current?.setPointerCapture(e.pointerId);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onKeyDown,
    onResizeHandleDown,
  };
}

// Inline line editor: local value, commit on blur/Enter, discard on Escape (the cancelled flag stops
// the following blur from committing the abandoned text). Local state — not live commit — because a
// blank commit clears the sugar and would unmount this textarea mid-edit.
//
// Edits happen in DISPLAY space (`{{ name }}` shows as `#name`), and typing `#` opens the same
// variable autocomplete the panel's VariableTextField has; the commit converts known `#name`s back
// to canonical tokens. The popover is a body portal (FloatingVariableSuggestions) because the
// canvas frame clips and transforms its children.
const SugarLineEditor = ({
  initial,
  ariaLabel,
  variables,
  onCommit,
  onCancel,
}: {
  initial: string;
  ariaLabel: string;
  variables: string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(() => displayFromTokens(initial));
  const cancelledRef = useRef(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // Restore the caret after a token insert replaced the value programmatically.
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      ref.current.focus();
      pendingCaret.current = null;
    }
  });

  const autocomplete = useVariableAutocomplete({
    variables: variables.map((name) => ({ name, scope: 'global' as const })),
    elementRef: ref,
    onInsert: (next, caret) => {
      pendingCaret.current = caret;
      setValue(next);
    },
  });

  const commit = (text: string) => {
    onCommit(tokensFromDisplay(text, new Set(variables)));
  };

  return (
    <>
      <textarea
        ref={(element) => {
          ref.current = element;
          setAnchor(element);
        }}
        autoFocus
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autocomplete.sync();
        }}
        onClick={() => {
          autocomplete.sync();
        }}
        onBlur={() => {
          if (cancelledRef.current) return;

          commit(value);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onKeyUp={(e) => {
          e.stopPropagation();
          autocomplete.syncFromKeyUp(e.key);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();

          // The picker's protocol wins while it is open — Escape here closes the popover WITHOUT
          // cancelling the inline edit, and Enter inserts instead of committing.
          if (autocomplete.handleKeyDown(e)) return;

          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit(value);

            return;
          }

          if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            onCancel();
          }
        }}
        rows={1}
        className="min-w-[3ch] resize-none bg-transparent outline-none [field-sizing:content] [font:inherit] [color:inherit]"
      />
      <FloatingVariableSuggestions autocomplete={autocomplete} totalCount={variables.length} anchor={anchor} />
    </>
  );
};

// Four corner resize handles, matching OverlayBox's affordance.
const ResizeHandles = ({ onHandleDown }: { onHandleDown: (e: ReactPointerEvent<HTMLDivElement>) => void }) => (
  <>
    {(['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'] as const).map((pos) => (
      <div
        key={pos}
        aria-hidden
        onPointerDown={onHandleDown}
        className={cn(
          'absolute h-3 w-3 cursor-nwse-resize rounded-full border-2 border-brand-500 bg-surface shadow',
          pos
        )}
      />
    ))}
  </>
);

interface SugarLineProps {
  line: SugarTextLine;
  lineIndex: number;
  gestures: PieceGestures;
  editing: boolean;
  /** Preview px per engine px — scales the line's raw TextEffect to the frame. */
  effectScale: number;
  shift?: { dx: number; dy: number };
  resize?: ResizeSupport;
  editor: {
    initial: string;
    ariaLabel: string;
    variables: string[];
    onCommit: (value: string) => void;
    onCancel: () => void;
  };
}

// One drawtext line: the real font family/size/colour, plus the drawbox-style background when the
// line carries a box (caption bar, badge pill). lineHeight 1 approximates drawtext's glyph-box y.
const SugarLine = ({ line, lineIndex, gestures, editing, effectScale, shift, resize, editor }: SugarLineProps) => {
  const bodyRef = useRef<HTMLElement | null>(null);
  const g = usePieceGestures(gestures, lineIndex, bodyRef, resize);
  // Resolve '{{ variable }}' colour tokens so a token-coloured line previews as its current colour.
  const { variables: colorVars } = useColorVariables();

  return (
    <span
      ref={(el) => {
        bodyRef.current = el;
      }}
      role="button"
      tabIndex={0}
      aria-label={gestures.label}
      aria-pressed={gestures.active}
      onPointerDown={editing ? undefined : g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onDoubleClick={g.onDoubleClick}
      onKeyDown={editing ? undefined : g.onKeyDown}
      style={{
        ...anchorStyle(line.x, line.y, shift),
        fontSize: line.fontPx,
        fontFamily: `'${line.fontFamily}', sans-serif`,
        color: resolvePreviewColor(line.color, colorVars),
        lineHeight: 1,
        whiteSpace: 'pre',
        ...(line.box
          ? {
              backgroundColor: rgba(resolvePreviewColor(line.box.color, colorVars), line.box.opacity),
              padding: line.box.paddingPx,
            }
          : {}),
        ...textEffectCss(line.effect, effectScale, colorVars),
      }}
      className={cn(
        'pointer-events-auto touch-none outline-none',
        editing ? 'cursor-text' : 'cursor-move',
        shift && 'opacity-80',
        gestures.active && 'rounded-[0.2em] ring-2 ring-brand-500/60'
      )}
    >
      {editing ? <SugarLineEditor {...editor} /> : displayFromTokens(line.text)}
      {gestures.active && !editing && resize && <ResizeHandles onHandleDown={g.onResizeHandleDown} />}
    </span>
  );
};

// A solid accent bar (drawbox t=fill). Decorative only — too small to be a useful click target.
const SugarBarBox = ({ bar, shift }: { bar: SugarBar; shift?: { dx: number; dy: number } }) => {
  const { variables: colorVars } = useColorVariables();

  return (
    <div
      aria-hidden
      style={{
        ...anchorStyle(bar.x, { edge: 'top', px: bar.topPx }, shift),
        width: bar.widthPx,
        height: bar.heightPx,
        backgroundColor: resolvePreviewColor(bar.color, colorVars),
      }}
      className={cn(shift && 'opacity-80')}
    />
  );
};

// The full-width legibility band behind a lower third (drawbox x=0 w=iw) — the block's natural
// click/drag target, selectable and draggable like the lines it carries.
const SugarBandBox = ({
  band,
  gestures,
  shift,
}: {
  band: SugarBand;
  gestures: PieceGestures;
  shift?: { dx: number; dy: number };
}) => {
  const bodyRef = useRef<HTMLElement | null>(null);
  const g = usePieceGestures(gestures, 0, bodyRef);
  const { variables: colorVars } = useColorVariables();

  return (
    <div
      ref={(element) => {
        bodyRef.current = element;
      }}
      role="button"
      tabIndex={0}
      aria-label={gestures.label}
      aria-pressed={gestures.active}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onDoubleClick={g.onDoubleClick}
      onKeyDown={g.onKeyDown}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: band.topPx,
        height: band.heightPx,
        backgroundColor: rgba(resolvePreviewColor(band.color, colorVars), band.opacity),
        ...(shift ? { transform: `translate(${shift.dx}px, ${shift.dy}px)` } : {}),
      }}
      className={cn(
        'pointer-events-auto cursor-move touch-none outline-none',
        shift && 'opacity-80',
        gestures.active && 'ring-2 ring-brand-500/60'
      )}
    />
  );
};

interface SugarPreviewLayerProps {
  caption?: EditorCaption;
  titleCard?: TitleCard;
  lowerThird?: LowerThird;
  orientation: Orientation;
  frameRef: RefObject<HTMLDivElement | null>;
  selection: SectionSelectionState;
  onSelectElement: (ref: ElementRef | null) => void;
  // Optional so read-only hosts (the program monitor's scene renderer) can omit the edit wiring —
  // without them double-click/Enter simply do nothing.
  onBeginEdit?: () => void;
  onEndEdit?: () => void;
  onChangeCaption?: (caption: EditorCaption | undefined) => void;
  onChangeTitleCard?: (titleCard: TitleCard | undefined) => void;
  onChangeLowerThird?: (lowerThird: LowerThird | undefined) => void;
  // Variable names in scope for the inline editors' `#` autocomplete (same list the panel editors
  // receive). Optional so read-only hosts can omit it.
  variables?: string[];
}

export const SugarPreviewLayer = ({
  caption,
  titleCard,
  lowerThird,
  orientation,
  frameRef,
  selection,
  onSelectElement,
  onBeginEdit,
  onEndEdit,
  onChangeCaption,
  onChangeTitleCard,
  onChangeLowerThird,
  variables = [],
}: SugarPreviewLayerProps) => {
  const { t } = useTranslation('admin');
  const previewH = useFrameHeight(frameRef);
  const [drag, setDrag] = useState<DragOffset>(null);
  // Caption resize bookkeeping: the grab centre, the pointer's grab distance from it, and the
  // grab-time engine fontsize; the travel ratio scales the font, like OverlayBox's radial resize.
  const resizeRef = useRef<{ cx: number; cy: number; dist: number; fontsize: number } | null>(null);

  if (previewH <= 0) return null;

  const captionLine = captionPreview(caption, previewH, orientation);
  const card = titleCardPreview(titleCard, previewH, orientation);
  const third = lowerThirdPreview(lowerThird, previewH, orientation);

  if (!captionLine && !card && !third) return null;

  const sugarOf = (kind: SugarKind): AnySugar | undefined => {
    if (kind === 'caption') return caption;

    if (kind === 'titleCard') return titleCard;

    return lowerThird;
  };

  const changeOf = (kind: SugarKind): ((value?: AnySugar) => void) | undefined => {
    if (kind === 'caption') return onChangeCaption as ((value?: AnySugar) => void) | undefined;

    if (kind === 'titleCard') return onChangeTitleCard as ((value?: AnySugar) => void) | undefined;

    return onChangeLowerThird as ((value?: AnySugar) => void) | undefined;
  };

  const isActive = (kind: SugarKind): boolean => selection.element?.kind === kind;
  const editingIndex = (kind: SugarKind): number | null =>
    selection.element?.kind === kind && selection.editing ? selection.element.index : null;

  const gesturesFor = (kind: SugarKind, label: string): PieceGestures => ({
    label,
    active: isActive(kind),
    onSelect: (lineIndex) => {
      onSelectElement({ kind, index: lineIndex });
    },
    onStartEdit: (lineIndex) => {
      onSelectElement({ kind, index: lineIndex });
      onBeginEdit?.();
    },
    onDragMove: (dx, dy) => {
      setDrag({ kind, dx, dy });
    },
    onDragEnd: (clientX, clientY, moved) => {
      setDrag(null);

      if (!moved) return;

      const rect = frameRef.current?.getBoundingClientRect();
      const sugar = sugarOf(kind);
      const change = changeOf(kind);

      if (!rect || !sugar || !change) return;

      const point = {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };
      change(sugarDragPatch(kind, sugar, point));
    },
    onClear: () => {
      onSelectElement(null);
      changeOf(kind)?.();
    },
  });

  const shiftFor = (kind: SugarKind) => (drag?.kind === kind ? { dx: drag.dx, dy: drag.dy } : undefined);

  // Commit/cancel for the inline editor of one line; a blank commit may clear the whole block.
  const editorFor = (kind: SugarKind, lineIndex: number) => {
    const sugar = sugarOf(kind);
    const lineKey = sugarLineKeys(kind)[lineIndex] ?? sugarLineKeys(kind)[0];

    return {
      initial: sugar ? sugarLineText(kind, sugar, lineKey) : '',
      ariaLabel: t('overlay.editText'),
      variables,
      onCommit: (value: string) => {
        onEndEdit?.();
        const current = sugarOf(kind);
        const change = changeOf(kind);

        if (!current || !change) return;

        const next = commitSugarLine(kind, current, lineKey, value);
        change(next);

        if (!next) onSelectElement(null);
      },
      onCancel: () => {
        onEndEdit?.();
      },
    };
  };

  // Children follow the engine draw order (caption → titleCard → lowerThird, registry orders 50/55/58).
  return (
    <SugarPieces
      captionLine={captionLine}
      card={card}
      third={third}
      gesturesFor={gesturesFor}
      editingIndex={editingIndex}
      shiftFor={shiftFor}
      editorFor={editorFor}
      caption={caption}
      onChangeCaption={onChangeCaption}
      previewH={previewH}
      orientation={orientation}
      resizeRef={resizeRef}
    />
  );
};

interface SugarPiecesProps {
  captionLine: ReturnType<typeof captionPreview>;
  card: ReturnType<typeof titleCardPreview>;
  third: ReturnType<typeof lowerThirdPreview>;
  gesturesFor: (kind: SugarKind, label: string) => PieceGestures;
  editingIndex: (kind: SugarKind) => number | null;
  shiftFor: (kind: SugarKind) => { dx: number; dy: number } | undefined;
  editorFor: (kind: SugarKind, lineIndex: number) => SugarLineProps['editor'];
  caption: EditorCaption | undefined;
  onChangeCaption?: (caption: EditorCaption | undefined) => void;
  previewH: number;
  orientation: Orientation;
  resizeRef: RefObject<{ cx: number; cy: number; dist: number; fontsize: number } | null>;
}

// The rendered sugar pieces in engine draw order. Split from SugarPreviewLayer so the layer keeps the
// gesture/selection wiring while this owns only the draw — including the caption's corner resize
// handles (the one sugar with a fontsize field; its grab size is recovered from the preview px).
const SugarPieces = ({
  captionLine,
  card,
  third,
  gesturesFor,
  editingIndex,
  shiftFor,
  editorFor,
  caption,
  onChangeCaption,
  previewH,
  orientation,
  resizeRef,
}: SugarPiecesProps) => {
  const { t } = useTranslation('admin');

  const captionResize: ResizeSupport | undefined =
    captionLine && onChangeCaption && caption
      ? {
          onResizeStart: (clientX, clientY, body) => {
            const rect = body?.getBoundingClientRect();
            const cx = rect ? rect.left + rect.width / 2 : clientX;
            const cy = rect ? rect.top + rect.height / 2 : clientY;
            const fontsize = Math.round(captionLine.fontPx / previewScale(previewH, orientation));
            resizeRef.current = { cx, cy, dist: Math.hypot(clientX - cx, clientY - cy) || 1, fontsize };
          },
          onResizeMove: (clientX, clientY) => {
            const start = resizeRef.current;

            if (!start) return;

            const dist = Math.hypot(clientX - start.cx, clientY - start.cy);
            onChangeCaption({ ...caption, fontsize: fontSizeFromResize(start.fontsize, start.dist, dist) });
          },
        }
      : undefined;

  const titleCardLineIndex = (key: string): number => sugarLineKeys('titleCard').indexOf(key);
  const lowerThirdLineIndex = (key: string): number => sugarLineKeys('lowerThird').indexOf(key);
  // Preview px per engine px, shared by every line's TextEffect (shadow offsets / outline width).
  const effectScale = previewScale(previewH, orientation);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {captionLine && (
        <SugarLine
          line={captionLine}
          lineIndex={0}
          gestures={gesturesFor('caption', t('element.caption'))}
          editing={editingIndex('caption') !== null}
          effectScale={effectScale}
          shift={shiftFor('caption')}
          resize={captionResize}
          editor={editorFor('caption', 0)}
        />
      )}
      {card && (
        <>
          {card.lines.map((line) => (
            <SugarLine
              key={line.key}
              line={line}
              lineIndex={titleCardLineIndex(line.key)}
              gestures={gesturesFor('titleCard', t('element.titleCard'))}
              editing={editingIndex('titleCard') === titleCardLineIndex(line.key)}
              effectScale={effectScale}
              shift={shiftFor('titleCard')}
              editor={editorFor('titleCard', titleCardLineIndex(line.key))}
            />
          ))}
          {card.bar && <SugarBarBox bar={card.bar} shift={shiftFor('titleCard')} />}
        </>
      )}
      {third && (
        <>
          {third.band && (
            <SugarBandBox
              band={third.band}
              gestures={gesturesFor('lowerThird', t('element.lowerThird'))}
              shift={shiftFor('lowerThird')}
            />
          )}
          {third.bar && <SugarBarBox bar={third.bar} shift={shiftFor('lowerThird')} />}
          {third.lines.map((line) => (
            <SugarLine
              key={line.key}
              line={line}
              lineIndex={lowerThirdLineIndex(line.key)}
              gestures={gesturesFor('lowerThird', t('element.lowerThird'))}
              editing={editingIndex('lowerThird') === lowerThirdLineIndex(line.key)}
              effectScale={effectScale}
              shift={shiftFor('lowerThird')}
              editor={editorFor('lowerThird', lowerThirdLineIndex(line.key))}
            />
          ))}
        </>
      )}
    </div>
  );
};
