// Per-overlay box rendered on the center SectionCanvas: positioned by its [0,1] fractions, styled
// with the real font/size/color, owning its own move/resize pointer capture and (when editing) an
// inline textarea. Extracted from the legacy OverlayCanvas so the canvas half lives on its own.
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TFunction } from 'i18next';
import { Type } from '@/presentation/components/icons';
import { findFont } from '@leclap/creative-kit/fonts';
import {
  resolveAccentBar,
  resolvePreviewColor,
  DEFAULT_BOX_PADDING,
  type ColorVariableMap,
} from '@leclap/creative-kit/editor';
import { displayFromTokens, tokensFromDisplay } from '@/lib/variableSyntax';
import { cn } from '@/lib/utils';
import { useColorVariables } from '@/presentation/components/ui';
import type { TextOverlay, Orientation } from '../templateEditorModel';
import { previewFontPx, refVideoHeight } from '../overlayGeometry';
import { FloatingVariableSuggestions, useVariableAutocomplete } from '../editor/variableAutocomplete';
import { rgba } from './sectionCanvasColor';
import { textEffectCss } from './textEffectCss';

// 2% keyboard nudge step for a selected, non-editing overlay.
const NUDGE = 0.02;

// Arrow-key → [dx, dy] fraction offsets. Partial so an unmapped key reads `undefined`.
const NUDGE_OFFSETS: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [-NUDGE, 0],
  ArrowRight: [NUDGE, 0],
  ArrowUp: [0, -NUDGE],
  ArrowDown: [0, NUDGE],
};

interface OverlayBoxProps {
  overlay: TextOverlay;
  index: number;
  t: TFunction<'admin'>;
  orientation: Orientation;
  active: boolean;
  editing: boolean;
  // Variable names in scope for the inline editor's `#` autocomplete (same list the panel gets).
  variables?: string[];
  editRef: React.Ref<HTMLTextAreaElement>;
  frameRect: () => DOMRect | undefined;
  onSelect: (index: number) => void;
  onEdit: () => void;
  onMove: (index: number, clientX: number, clientY: number) => void;
  onResizeStart: (index: number, clientX: number, clientY: number) => void;
  onResize: (index: number, clientX: number, clientY: number) => void;
  onNudge: (index: number, dx: number, dy: number) => void;
  onDelete: (index: number) => void;
  onCommitText: (text: string) => void;
  onCaret: (start: number, end: number) => void;
  onEndEdit: () => void;
}

export const OverlayBox = (props: OverlayBoxProps) => {
  const { overlay, index, t, orientation, active, editing, frameRect } = props;
  const modeRef = useRef<'move' | 'resize' | null>(null);
  // Capture the pointer on the stable box element (not the tiny resize handle, which re-renders on
  // every fontsize change mid-drag and would lose the capture — making resize "do nothing").
  const bodyRef = useRef<HTMLDivElement>(null);

  const onBodyPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) return;
    e.stopPropagation();
    props.onSelect(index);
    modeRef.current = 'move';
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (modeRef.current === null) return;
    e.stopPropagation();

    if (modeRef.current === 'resize') {
      props.onResize(index, e.clientX, e.clientY);

      return;
    }
    props.onMove(index, e.clientX, e.clientY);
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>) => {
    modeRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    props.onSelect(index);
    modeRef.current = 'resize';
    props.onResizeStart(index, e.clientX, e.clientY);
    bodyRef.current?.setPointerCapture(e.pointerId);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    handleBoxKey(e, index, props.onNudge, props.onDelete);
  };

  const previewH = frameRect()?.height ?? 0;
  // Resolve '{{ variable }}' colour tokens against the editor's global scope so the WYSIWYG box
  // shows the token's current colour (matching the engine's compile-time formatColor).
  const { variables: colorVars } = useColorVariables();

  return (
    <div
      ref={bodyRef}
      role="button"
      tabIndex={0}
      aria-label={overlayLabel(overlay, index, t)}
      aria-pressed={active}
      onPointerDown={onBodyPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onSelect(index);
        props.onEdit();
      }}
      onKeyDown={onKeyDown}
      style={boxStyle(overlay, previewH, orientation, colorVars)}
      className={cn(
        'absolute max-w-[92%] cursor-move touch-none whitespace-pre-wrap text-center leading-tight outline-none',
        active && 'rounded-[0.2em] ring-2 ring-brand-500'
      )}
    >
      <BoxContent
        overlay={overlay}
        editing={editing}
        t={t}
        variables={props.variables ?? []}
        editRef={props.editRef}
        onCommitText={props.onCommitText}
        onCaret={props.onCaret}
        onEndEdit={props.onEndEdit}
      />
      <OverlayAccentBar overlay={overlay} vars={colorVars} />
      {active && !editing && <ResizeHandles onHandlePointerDown={onHandlePointerDown} />}
    </div>
  );
};

interface BoxContentProps {
  overlay: TextOverlay;
  editing: boolean;
  t: TFunction<'admin'>;
  variables: string[];
  editRef: React.Ref<HTMLTextAreaElement>;
  onCommitText: (text: string) => void;
  onCaret: (start: number, end: number) => void;
  onEndEdit: () => void;
}

// Forwarded + local ref in one callback: the parent keeps its editRef while the autocomplete reads
// the caret through a RefObject it can dereference.
function assignEditRef(editRef: React.Ref<HTMLTextAreaElement>, el: HTMLTextAreaElement | null): void {
  if (typeof editRef === 'function') {
    editRef(el);

    return;
  }

  if (editRef) editRef.current = el;
}

// The text body: an editing textarea, the overlay text, or a muted placeholder when empty. The
// textarea edits in DISPLAY space (`{{ name }}` shows as `#name`) and live-commits the canonical
// tokens; typing `#` opens the same variable autocomplete as the panel's VariableTextField, in a
// body portal (the canvas frame clips and transforms its children).
const BoxContent = ({ overlay, editing, t, variables, editRef, onCommitText, onCaret, onEndEdit }: BoxContentProps) => {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const known = new Set(variables);

  // Restore the caret after a token insert replaced the value programmatically.
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && localRef.current) {
      localRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      localRef.current.focus();
      pendingCaret.current = null;
    }
  });

  const autocomplete = useVariableAutocomplete({
    variables: variables.map((name) => ({ name, scope: 'global' as const })),
    elementRef: localRef,
    onInsert: (next, caret) => {
      pendingCaret.current = caret;
      onCommitText(tokensFromDisplay(next, known));
    },
  });

  if (editing) {
    return (
      <>
        <textarea
          ref={(el) => {
            localRef.current = el;
            setAnchor(el);
            assignEditRef(editRef, el);
          }}
          autoFocus
          aria-label={t('overlay.editText')}
          value={displayFromTokens(overlay.text)}
          placeholder={t('overlay.textPlaceholder')}
          onChange={(e) => {
            onCommitText(tokensFromDisplay(e.target.value, known));
            onCaret(e.target.selectionStart, e.target.selectionEnd);
            autocomplete.sync();
          }}
          onSelect={(e) => {
            onCaret(e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
          }}
          onClick={() => {
            autocomplete.sync();
          }}
          onBlur={onEndEdit}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onKeyUp={(e) => {
            e.stopPropagation();
            autocomplete.syncFromKeyUp(e.key);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();

            // The picker's protocol wins while it is open — Enter inserts the highlighted variable
            // instead of ending the edit; Escape only closes the popover.
            if (autocomplete.handleKeyDown(e)) return;

            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onEndEdit();
            }
          }}
          rows={1}
          // `field-sizing: content` makes the textarea hug its text so the box (and its selection ring)
          // wraps the overlay content; min-w keeps the placeholder readable while empty.
          className="min-w-[3ch] resize-none bg-transparent text-center outline-none [field-sizing:content] [font:inherit] [color:inherit] placeholder:opacity-45"
        />
        <FloatingVariableSuggestions autocomplete={autocomplete} totalCount={variables.length} anchor={anchor} />
      </>
    );
  }

  // Empty, not editing: a hint chip that PREVIEWS the overlay's own typography — it inherits the box's
  // font face and scales with its font size (clamped to a legible floor) — so changing the font or
  // dragging the resize handles gives visible feedback even before any text is typed, while a tiny
  // placed-but-blank overlay stays a grabbable target.
  if (overlay.text.trim() === '') {
    return (
      <span className="pointer-events-none flex items-center gap-1 whitespace-nowrap text-[max(0.5em,11px)] leading-none font-medium tracking-normal normal-case opacity-60">
        <Type className="h-[1em] w-[1em]" aria-hidden />
        {t('overlay.doubleClickToEdit')}
      </span>
    );
  }

  return <span>{displayFromTokens(overlay.text)}</span>;
};

// Four corner resize handles. Each shares one pointerdown that arms a resize.
const ResizeHandles = ({
  onHandlePointerDown,
}: {
  onHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) => (
  <>
    {(['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'] as const).map((pos) => (
      <div
        key={pos}
        aria-hidden
        onPointerDown={onHandlePointerDown}
        className={cn(
          'absolute h-3 w-3 cursor-nwse-resize rounded-full border-2 border-brand-500 bg-surface shadow',
          pos
        )}
      />
    ))}
  </>
);

// Inline style for an overlay box: position, the real font face, the WYSIWYG-scaled font size, color,
// and an optional padded background box at the author's opacity. Colour fields may hold '{{ variable }}'
// tokens — they resolve against `vars` (the editor's global scope) the way the engine's formatColor
// does at compile time. Exported so the live program monitor (program-scene) renders playback overlays
// with the exact same typography math as the edit canvas.
export function boxStyle(
  overlay: TextOverlay,
  previewH: number,
  orientation: Orientation,
  vars?: ColorVariableMap
): CSSProperties {
  const fontcolor = resolvePreviewColor(overlay.fontcolor, vars);
  const base: CSSProperties = {
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    transform: 'translate(-50%, -50%)',
    fontFamily: findFont(overlay.font)?.cssFamily ?? 'inherit',
    fontSize: `${previewFontPx(overlay.fontsize, previewH, orientation)}px`,
    // Watermark-style text alpha rides on the color (mirrors the `#rrggbb@a` drawtext lowering).
    color: overlay.textOpacity === undefined ? fontcolor : rgba(fontcolor, overlay.textOpacity),
    // Drop shadow / outline preview, scaled like the fontsize (drawtext px → preview px).
    ...textEffectCss(overlay.effect, previewH / refVideoHeight(orientation), vars),
  };

  if (!overlay.box) return base;

  // The author's boxPadding (drawtext boxborderw, video px) scaled to preview px like the fontsize —
  // uniform and square-cornered because that is exactly what drawtext renders (no corner radius).
  const padding = (overlay.boxPadding ?? DEFAULT_BOX_PADDING) * (previewH / refVideoHeight(orientation));

  return {
    ...base,
    backgroundColor: rgba(resolvePreviewColor(overlay.boxcolor, vars), overlay.boxOpacity),
    padding: `${padding}px`,
  };
}

// The bar's horizontal placement per alignment, mirroring the kit's x expressions: the box centre
// is the preview's stand-in for the overlay's x anchor line (iw*fx), so 'center' centres the bar on
// it, 'left' hangs the bar rightward from it, 'right' ends the bar on it.
function accentBarAlignCss(align: 'left' | 'center' | 'right'): CSSProperties {
  if (align === 'left') return { left: '50%' };

  if (align === 'right') return { left: '50%', transform: 'translateX(-100%)' };

  return { left: '50%', transform: 'translateX(-50%)' };
}

// The bar's vertical placement: below hangs it one gap under the text box, above floats it one gap
// over — the same fontsize*0.25 gap the kit's drawbox y expression bakes in.
function accentBarPositionCss(position: 'below' | 'above'): CSSProperties {
  if (position === 'above') return { bottom: '100%', marginBottom: '0.25em' };

  return { top: '100%', marginTop: '0.25em' };
}

// CSS mirror of the kit's accent bar (overlayFilters accentBarFilters): a solid bar whose
// length/thickness are em of the overlay fontsize (thickness floored at 2 preview px), one small
// gap below or above the text. Sized in `em` so it inherits the box's WYSIWYG-scaled font size —
// the same em→px math as the fontsize itself; hidden while the overlay has no text (the kit drops
// empty overlays, bar included). Shared by the edit canvas box and the program monitor's playback
// overlays so both previews draw the same bar.
export const OverlayAccentBar = ({ overlay, vars }: { overlay: TextOverlay; vars?: ColorVariableMap }) => {
  if (!overlay.accent || overlay.text.trim() === '') return null;

  const bar = resolveAccentBar(overlay.accent);

  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        ...accentBarPositionCss(bar.position),
        ...accentBarAlignCss(bar.align),
        width: `${bar.length}em`,
        height: `max(2px, ${bar.thickness}em)`,
        backgroundColor: resolvePreviewColor(bar.color, vars),
        pointerEvents: 'none',
      }}
    />
  );
};

// Accessible label for an overlay box, using its text when present.
function overlayLabel(overlay: TextOverlay, index: number, t: TFunction<'admin'>): string {
  const text = overlay.text.trim();

  return text === '' ? t('overlay.label', { index: index + 1 }) : t('overlay.labelWithText', { text });
}

// Arrow keys nudge the selected box; Delete/Backspace removes it.
function handleBoxKey(
  e: ReactKeyboardEvent<HTMLDivElement>,
  index: number,
  onNudge: (index: number, dx: number, dy: number) => void,
  onDelete: (index: number) => void
): void {
  const offset = NUDGE_OFFSETS[e.key];

  if (offset) {
    e.preventDefault();
    onNudge(index, offset[0], offset[1]);

    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    onDelete(index);
  }
}
