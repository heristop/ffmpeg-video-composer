// Renders an animation overlay thumbnail: a <video> for WebM (alpha VP9 doesn't show in <img>) or an
// <img> for APNG/WebP/GIF. Used for the upload preview. Library cards use AnimationThumb: the
// engine-rendered looping WebP (or its still poster when the OS asks for reduced motion).
import { cn } from '@/lib/utils';
import { isAnimationVideo } from './animationOverlay';

interface AnimationMediaProps {
  url: string;
  className?: string;
}

export const AnimationMedia = ({ url, className }: AnimationMediaProps) => {
  if (isAnimationVideo(url)) {
    return <video src={url} className={className} autoPlay loop muted playsInline aria-hidden draggable={false} />;
  }

  return <img src={url} alt="" loading="lazy" className={className} draggable={false} />;
};

interface AnimationThumbProps {
  /** Looping preview (animated WebP); falls back to the poster. */
  thumb?: string;
  /** Still frame at the effect's peak: shown under prefers-reduced-motion and while the thumb loads. */
  poster?: string;
  /** Shown when the thumbnails were not generated (e.g. a fresh checkout before gen:animation-thumbs). */
  fallback: string;
  className?: string;
}

// A library card's preview on the thumbnail's own dark stage (#1A1D24, the colour the thumbs are rendered
// on), so the card never shows a transparency checker and the poster covers the gap while the WebP loads.
export const AnimationThumb = ({ thumb, poster, fallback, className }: AnimationThumbProps) => {
  const still = poster ?? thumb;

  if (!still) {
    return (
      <span
        aria-hidden
        className={cn(
          'grid place-items-center bg-[radial-gradient(circle_at_30%_25%,#3a4150,#1A1D24_70%)] text-lg font-semibold text-white/70',
          className
        )}
      >
        {fallback.charAt(0)}
      </span>
    );
  }

  return (
    <picture
      className={cn('block bg-[#1A1D24] bg-cover bg-center', className)}
      style={{ backgroundImage: `url(${still})` }}
    >
      <source srcSet={still} media="(prefers-reduced-motion: reduce)" />
      <img
        src={thumb ?? still}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="block h-full w-full object-cover"
      />
    </picture>
  );
};

// A legacy sample's preview: the real overlay file playing on the same neutral stage the engine thumbs use
// (a dark card with a mid-grey rounded subject), so every sample shows its own animation, not a frame cut
// from a showcase video. The stage stays still under reduced motion; the overlay is hidden there.
export const SampleThumb = ({ url, className }: { url: string; className?: string }) => (
  <span aria-hidden className={cn('relative block bg-[#1A1D24]', className)}>
    <span className="absolute inset-[22%_26%] rounded-lg bg-[#5a5f6b]" />
    <AnimationMedia url={url} className="absolute inset-0 h-full w-full object-contain motion-reduce:hidden" />
  </span>
);
