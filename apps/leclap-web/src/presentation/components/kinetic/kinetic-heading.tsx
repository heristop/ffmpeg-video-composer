import { type ElementType } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { kineticMotion } from './motion';
import { alignJustify, type HeadingAlign } from './kinetic-heading.logic';
import { revealDelay, splitWords } from './split-text.logic';

type DisplayLevel = 'mega' | 'hero' | 'xl' | 'l' | 'm' | 's';

// Each level maps to the Kinetic Editorial display scale added in index.css (@theme).
const LEVEL_SIZE: Record<DisplayLevel, string> = {
  mega: 'var(--text-display-mega)',
  hero: 'var(--text-display-hero)',
  xl: 'var(--text-display-xl)',
  l: 'var(--text-display-l)',
  m: 'var(--text-display-m)',
  s: 'var(--text-display-s)',
};

function headingReveal(reduced: boolean, revealOnView: boolean) {
  return reduced || !revealOnView ? { animate: { opacity: 1, y: 0 } } : { whileInView: { opacity: 1, y: 0 } };
}

function headingTransition(reduced: boolean, index: number, stagger: number, delay: number) {
  return {
    duration: reduced ? 0 : kineticMotion.duration.base,
    delay: reduced ? 0 : revealDelay(index, stagger, delay),
    ease: [0.16, 1, 0.3, 1] as const,
  };
}

export interface KineticHeadingProps {
  text: string;
  level?: DisplayLevel;
  as?: ElementType;
  uppercase?: boolean;
  /** `responsive` centres on mobile and left-aligns at `lg+` (the `text-center lg:text-left` case). */
  align?: HeadingAlign;
  stagger?: number;
  /** Hold the whole reveal for this long (s) before the first word rises — lets a multi-line
      hero start line two where line one's stagger ends. */
  delay?: number;
  /** Play the word-by-word reveal when the heading scrolls into view (once) instead of on mount.
      Use for below-the-fold section titles so the staggered entrance is actually seen. */
  revealOnView?: boolean;
  className?: string;
}

// The oversized Oswald hero type, revealed word-by-word on mount — each word rises in staggered, the
// signature "kinetic" entrance. Near-black ink on light (foreground); brand/gradient is reserved for
// fills/edges/meters, not big type. Honours reduced-motion (renders settled). The `as` prop keeps the
// heading semantic (h1/h2/…) while the words animate as inline-block spans.
export function KineticHeading({
  text,
  level = 'l',
  as: Tag = 'h2',
  uppercase = false,
  align = 'left',
  stagger = kineticMotion.stagger,
  delay = 0,
  revealOnView = false,
  className,
}: KineticHeadingProps) {
  const words = splitWords(text);
  const reduced = useReducedMotion() ?? false;
  // Reduced motion renders settled; otherwise reveal either on mount (`animate`) or once the heading
  // scrolls into view (`whileInView`) for below-the-fold section titles.
  const revealProps = headingReveal(reduced, revealOnView);

  return (
    <Tag
      aria-label={text}
      className={cn(
        'flex flex-wrap font-display font-bold tracking-tight text-foreground',
        alignJustify(align),
        uppercase && 'uppercase',
        className
      )}
      style={{ fontSize: LEVEL_SIZE[level], lineHeight: 0.98, columnGap: '0.24em' }}
    >
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          aria-hidden="true"
          className="inline-block"
          initial={reduced ? false : { opacity: 0, y: '0.5em' }}
          {...revealProps}
          viewport={revealOnView ? { once: true, amount: 0.5 } : undefined}
          transition={headingTransition(reduced, index, stagger, delay)}
        >
          {word}
        </motion.span>
      ))}
    </Tag>
  );
}

export default KineticHeading;
