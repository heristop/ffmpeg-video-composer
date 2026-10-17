// A self-contained Remotion starter (system font, no asset deps): a spring-popped wordmark, a drawn
// accent bar, and a fading tagline. The MCP renders composition "Intro" to a clip via render_remotion_clip.
export function remotionFiles(projectName: string): Record<string, string> {
  // A single-quoted TS string literal, to match the generated files' quote style.
  const escaped = projectName.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`);
  const wm = `'${escaped}'`;
  const intro = `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const BG = '#0d1b2a';
const ACCENT = '#5eead4';

interface IntroProps {
  wordmark?: string;
  tagline?: string;
}

export const Intro = ({ wordmark = ${wm}, tagline = 'MADE WITH LECLAP' }: IntroProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, durationInFrames: 24, config: { damping: 13, stiffness: 150, mass: 0.7 } });
  const scale = interpolate(pop, [0, 1], [0.82, 1]);
  const barW = interpolate(
    spring({ frame: frame - 12, fps, durationInFrames: 20, config: { damping: 18 } }),
    [0, 1],
    [0, 320]
  );
  const tag = spring({ frame: frame - 24, fps, durationInFrames: 18, config: { damping: 16 } });

  return (
    <AbsoluteFill
      style={{ backgroundColor: BG, justifyContent: 'center', alignItems: 'center', fontFamily: 'Helvetica, Arial, sans-serif' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, transform: \`scale(\${scale})\` }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 128, letterSpacing: -2, lineHeight: 1 }}>{wordmark}</div>
        <div style={{ width: barW, height: 10, background: ACCENT, borderRadius: 5 }} />
        <div style={{ opacity: tag, color: ACCENT, fontWeight: 600, fontSize: 26, letterSpacing: 6 }}>{tagline}</div>
      </div>
    </AbsoluteFill>
  );
};
`;

  const root = `import { Composition } from 'remotion';
import { Intro } from './Intro';

export const RemotionRoot = () => (
  <Composition
    id="Intro"
    component={Intro}
    durationInFrames={90}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{ wordmark: ${wm}, tagline: 'MADE WITH LECLAP' }}
  />
);
`;

  const index = `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
`;

  return {
    'remotion/Intro.tsx': intro,
    'remotion/Root.tsx': root,
    'remotion/index.ts': index,
  };
}
