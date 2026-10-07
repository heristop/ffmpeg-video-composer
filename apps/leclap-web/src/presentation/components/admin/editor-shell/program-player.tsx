// The live program monitor's playback surface: mounts the scene(s) under the playhead and lets the
// rAF clock paint them. Two-tier design (the load-bearing performance discipline):
//   - COARSE (React state): which scenes are mounted — flips only at boundaries / transition windows.
//   - FINE (raw DOM writes at 60fps): overlay reveal/exit opacity+transform, Ken Burns backdrop
//     transform, transition blend styles, all written straight to refs — zero re-renders per frame.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from '../templateEditorModel';
import { editableExit, editableReveal } from './overlay-timing';
import { sceneClockAt, transitionAt, kenburnsTransformAt, type Segment } from './program-timeline.logic';
import { overlayVisibilityAt, type OverlayVisibility } from './overlay-visibility.logic';
import { animationVisibilityAt, imageVisibilityAt, layerVisibilityAt } from './element-visibility.logic';
import { sceneAnimations } from './program-animations';
import { transitionBlendAt, type BlendLayerStyle } from './transition-blend.logic';
import { useFrameHeight } from './SugarPreviewLayer';
import { ProgramScene, sceneImages, sceneLayers, type ProgramSceneHandles, type VisualSection } from './program-scene';
import type { ProgramClock } from './use-program-clock';
import { previewEnvOf } from './fx-preview/preview-env';
import { FRAME_FIT_CLASS, FRAME_STAGE_CLASS } from './frame-fit';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

interface Mounted {
  active: number; // original section index under the playhead
  incoming: number | null; // next scene, mounted early during a transition window
}

const sameMount = (a: Mounted, b: Mounted): boolean => a.active === b.active && a.incoming === b.incoming;

// Write one blend layer's sampled styles; empty strings clear leftovers from the previous frame.
function writeBlend(el: HTMLDivElement | null, style: BlendLayerStyle): void {
  if (!el) return;

  el.style.opacity = style.opacity === undefined ? '' : String(style.opacity);
  el.style.transform = style.transform ?? '';
  el.style.clipPath = style.clipPath ?? '';
  el.style.filter = style.filter ?? '';
}

// Write one sampled visibility onto an animation wrapper element.
function writeVisibility(el: HTMLDivElement | null, vis: OverlayVisibility): void {
  if (!el) return;

  el.style.opacity = String(vis.opacity);
  el.style.transform = `translate(${vis.translateX.toFixed(2)}px, ${vis.translateY.toFixed(2)}px)`;
}

// Paint one mounted scene at its local clock: backdrop Ken Burns + per-overlay reveal/exit +
// per-image show-window/motion + per-layer reveal.
function paintScene(
  handles: ProgramSceneHandles | null,
  section: VisualSection,
  localT: number,
  duration: number
): void {
  if (!handles) return;

  const kenburns = kenburnsTransformAt(section.motion, duration > 0 ? localT / duration : 0);

  if (handles.backdrop) handles.backdrop.style.transform = kenburns ?? '';

  for (const [i, overlay] of section.overlays.entries()) {
    const el = handles.overlays[i];

    if (!el) continue;

    writeVisibility(
      el,
      overlayVisibilityAt(editableReveal(overlay.reveal), editableExit(overlay.exit), localT, duration)
    );
  }

  paintMedia(handles, section, localT, duration);
}

// The scene's non-text elements: stills, animation files and background layers.
function paintMedia(handles: ProgramSceneHandles, section: VisualSection, localT: number, duration: number): void {
  // Still-image / shape overlays: show window + `motion` entrance (element-visibility.logic).
  for (const [i, image] of sceneImages(section).entries()) {
    writeVisibility(handles.images[i] ?? null, imageVisibilityAt(image, localT, duration));
  }

  // Animation files: delayed by `start`, cut after `duration` (element-visibility.logic).
  for (const [i, animation] of sceneAnimations(section).entries()) {
    writeVisibility(handles.animations[i] ?? null, animationVisibilityAt(animation, localT, duration));
  }

  // Background layers: gradient layers animate their reveal; solid layers pop at the delay.
  for (const [i, layer] of sceneLayers(section).entries()) {
    writeVisibility(handles.layers[i] ?? null, layerVisibilityAt(layer, localT, duration));
  }
}

// Paint the active scene (and, during a transition window, the idling incoming scene) for one clock
// tick, writing blend styles straight to the container refs. Split from the tick handler so each stays
// simple; the handler owns only the coarse mount decision.
function paintTick(
  refs: {
    containers: Map<number, HTMLDivElement | null>;
    handles: Map<number, ProgramSceneHandles | null>;
  },
  state: EditorState,
  at: NonNullable<ReturnType<typeof sceneClockAt>>,
  trans: ReturnType<typeof transitionAt>,
  want: Mounted
): void {
  const active = state.sections[at.index] as VisualSection | undefined;

  if (!active) return;

  paintScene(refs.handles.get(at.index) ?? null, active, at.localT, at.segment.duration);

  if (!trans || want.incoming === null) {
    writeBlend(refs.containers.get(at.index) ?? null, {});

    return;
  }

  const incoming = state.sections[want.incoming] as VisualSection | undefined;

  // The incoming scene idles at its first frame until the boundary flips the mount.
  if (incoming) paintScene(refs.handles.get(want.incoming) ?? null, incoming, 0, 1);

  const blend = transitionBlendAt(trans.family, trans.progress);
  writeBlend(refs.containers.get(at.index) ?? null, blend.outgoing);
  writeBlend(refs.containers.get(want.incoming) ?? null, blend.incoming);
}

// Feeds one mounted scene's effect layer its local time while that scene is the one under the playhead.
function sceneTime(clock: ProgramClock, timeline: Segment[], index: number) {
  return (paint: (t: number) => void) =>
    clock.subscribe((t) => {
      const at = sceneClockAt(timeline, t);

      if (at?.index === index) paint(at.localT);
    });
}

interface ProgramPlayerProps {
  state: EditorState;
  clock: ProgramClock;
  timeline: Segment[];
}

export const ProgramPlayer = ({ state, clock, timeline }: ProgramPlayerProps) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const previewH = useFrameHeight(frameRef);
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState<Mounted>(() => ({
    active: timeline[0]?.index ?? -1,
    incoming: null,
  }));

  // Latest data for the paint closure without re-subscribing per render.
  const dataRef = useRef({ state, timeline, mounted });
  dataRef.current = { state, timeline, mounted };

  const containers = useRef(new Map<number, HTMLDivElement | null>());
  const handles = useRef(new Map<number, ProgramSceneHandles | null>());

  useEffect(() => {
    return clock.subscribe((t) => {
      const { state: s, timeline: line, mounted: mount } = dataRef.current;
      const at = sceneClockAt(line, t);

      if (!at) return;

      const trans = transitionAt(line, t);
      const want: Mounted = { active: at.index, incoming: trans?.toIndex ?? null };

      // Boundary crossed: remount and let the NEXT tick paint the fresh refs.
      if (!sameMount(want, mount)) {
        dataRef.current.mounted = want;
        setMounted(want);

        return;
      }

      paintTick({ containers: containers.current, handles: handles.current }, s, at, trans, want);
    });
  }, [clock]);

  const scenes = useMemo(() => {
    const indices = mounted.incoming === null ? [mounted.active] : [mounted.active, mounted.incoming];

    return indices
      .map((index) => ({ index, section: state.sections[index] as VisualSection | undefined }))
      .filter((entry): entry is { index: number; section: VisualSection } => Boolean(entry.section));
  }, [mounted, state.sections]);

  if (timeline.length === 0) return null;

  return (
    <div className={`${FRAME_STAGE_CLASS} overflow-hidden`}>
      <div
        ref={frameRef}
        className={`relative overflow-hidden rounded-xl border border-foreground/10 bg-black ${FRAME_FIT_CLASS[state.orientation]}`}
      >
        {/* Incoming (second entry) stacks above the active scene for the blend window. */}
        {scenes.map(({ index, section }) => (
          <div
            key={index}
            ref={(el) => {
              containers.current.set(index, el);
            }}
            className="absolute inset-0"
          >
            <ProgramScene
              ref={(h) => {
                handles.current.set(index, h);
              }}
              section={section}
              orientation={state.orientation}
              frameRef={frameRef}
              previewH={previewH}
              globalTreatment={{ look: state.globalLook, grade: state.globalGrade }}
              fx={{ env: previewEnvOf(state, section, reduced), subscribe: sceneTime(clock, timeline, index) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
