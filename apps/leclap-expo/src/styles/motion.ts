// Shared timing and spring tokens. Touch feedback is critically damped; Clappy reactions
// are short, finite sequences, and engine progress uses the fastest timing.
export const motion = {
  duration: {
    instant: 120,
    fast: 200,
    base: 280,
    slow: 380,
    ring: 360, // the overlay's arc withTiming duration
    breath: 1500, // the overlay's breathing-logo loop
    halo: 1900, // the overlay's halo loop
  },
  spring: {
    tap: { damping: 34, stiffness: 500, mass: 0.6 }, // critically damped, interruptible feedback
    enter: { damping: 20, stiffness: 180, mass: 0.8 },
    playhead: { damping: 25, stiffness: 120 }, // smooth scrub
  },
  // Delay between successive words/lines in a KineticHeading reveal (ms).
  stagger: 60,
  clappy: { anticipate: 130, react: 160, settle: 220 },
};

export type MotionSpring = keyof typeof motion.spring;
