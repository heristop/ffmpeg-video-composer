// A scene's animation files (APNG / WebM / GIF) in the program monitor's playback: each plays the actual file
// at its resting placement (the edit canvas's geometry, rotation, mirror and opacity) inside an animation
// wrapper the clock samples with animationVisibilityAt (its start, its duration, its `motion` entrance).
import type { CSSProperties, RefObject } from 'react';
import { flipCssTransform } from '@leclap/creative-kit/editor';
import type { AnimationOverlay, EditorSection, Orientation } from '../templateEditorModel';
import { AnimationMedia } from '../editor/AnimationMedia';
import { resolveOverlayRect } from './imageAnimationDrag';
import { previewScale } from './sugarPreviewGeometry';

/** The animation files a scene composites, in paint order (shared with the paint loop's sampling). */
export const sceneAnimations = (section: EditorSection): AnimationOverlay[] =>
  'animations' in section ? (section.animations ?? []) : [];

function boxStyle(animation: AnimationOverlay, orientation: Orientation, previewH: number): CSSProperties {
  const rect = resolveOverlayRect(animation.position, animation.scale, null, orientation);
  const k = previewScale(previewH, orientation);
  const transform = [animation.rotation ? `rotate(${animation.rotation}deg)` : '', flipCssTransform(animation.flip)]
    .filter(Boolean)
    .join(' ');

  return {
    left: rect.left * k,
    top: rect.top * k,
    width: rect.width * k,
    height: rect.height * k,
    transform: transform || undefined,
    opacity: animation.opacity ?? 1,
  };
}

interface ProgramAnimationsProps {
  animations: AnimationOverlay[];
  orientation: Orientation;
  previewH: number;
  wrappers: RefObject<Array<HTMLDivElement | null>>;
}

export const ProgramAnimations = ({ animations, orientation, previewH, wrappers }: ProgramAnimationsProps) => (
  <>
    {animations.map((animation, index) => (
      <div
        key={animation.id ?? index}
        ref={(el) => {
          wrappers.current[index] = el;
        }}
        className="absolute inset-0"
      >
        <div aria-hidden className="absolute" style={boxStyle(animation, orientation, previewH)}>
          <AnimationMedia url={animation.url} className="absolute inset-0 h-full w-full object-fill select-none" />
        </div>
      </div>
    ))}
  </>
);
