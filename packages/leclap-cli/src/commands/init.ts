import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { starterMeta } from '../starter-direction.js';
import { success, fail, step, hint } from '../ui.js';
import { wordmark } from '../theme.js';
import { confirm } from '../prompt.js';
import { runStudioInit } from './studio-init.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

// Detect the package manager the user invoked us with. Every PM sets `npm_config_user_agent`
// (`<pm>/<version> …`) when it runs a binary — including `npx` / `pnpm dlx` / `yarn dlx` / `bunx` —
// so its first token is a reliable preference signal. Defaults to npm.
export function detectPackageManager(ua = process.env.npm_config_user_agent): PackageManager {
  const id = (ua ?? '').split('/')[0];

  return id === 'pnpm' || id === 'yarn' || id === 'bun' ? id : 'npm';
}

const INSTALL_CMD: Record<PackageManager, string> = {
  npm: 'npm install',
  pnpm: 'pnpm install',
  yarn: 'yarn',
  bun: 'bun install',
};

const RUN_CMD: Record<PackageManager, string> = {
  npm: 'npm run render',
  pnpm: 'pnpm render',
  yarn: 'yarn render',
  bun: 'bun run render',
};

// This cli's own version, read from the package.json next to the bundled entry (same pattern as
// src/index.ts). Used to pin `@leclap/cli` in the scaffold so a starter tracks the cli that made it.
function resolveCliVersion(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };

    return pkg.version;
  } catch {
    return undefined;
  }
}

export interface StarterOptions {
  /** Authoring brief embedded in template metadata; does not change rendering automatically. */
  creativeDirection?: string;
  /** Add a `.mcp.json` wiring `@leclap/mcp` so an agent can author + render in this project. */
  mcp?: boolean;
  /** Add a Remotion starter project (`remotion/`) for animated intros, rendered via the MCP. */
  remotion?: boolean;
  /** Absolute project dir — baked into `.mcp.json` env paths. Defaults to the project name. */
  projectDir?: string;
  /** This cli's own version, pinned as `^<version>` for `@leclap/cli`. Defaults to `latest`. */
  cliVersion?: string;
  /** Package manager to render install/run hints for. Defaults to npm. */
  packageManager?: PackageManager;
}

// A title card that renders with no external media — `BebasNeue.ttf` resolves from the engine's
// bundled fonts. `withIntro` prepends a project_video "intro" slot for a rendered Remotion clip.
function starterTemplate(withIntro: boolean, creativeDirection?: string) {
  const meta = starterMeta(withIntro, creativeDirection);
  const titleCard = {
    name: 'title',
    type: 'color_background',
    options: { backgroundColor: '#0d1b2a', duration: 3 },
    filters: [
      {
        type: 'drawtext',
        values: {
          text: { en: 'Hello, LeClap' },
          fontcolor: '#ffffff',
          fontsize: 96,
          x: '(w-text_w)/2',
          y: '(h-text_h)/2',
          fontfile: 'BebasNeue.ttf',
        },
      },
    ],
  };

  if (!withIntro) {
    return { meta, global: { orientation: 'landscape', musicEnabled: false }, sections: [titleCard] };
  }

  // The Remotion intro is supplied at compose time via userVideoPaths.intro.
  const intro = {
    name: 'intro',
    type: 'project_video',
    options: { duration: 3 },
    transition: { type: 'fade', duration: 0.5 },
  };

  return { meta, global: { orientation: 'landscape', musicEnabled: false }, sections: [intro, titleCard] };
}

function packageJson(projectName: string, opts: StarterOptions) {
  // Pin `@leclap/cli` to the scaffolding cli's own version. A caret on a known semver is required —
  // a bare `^0.1.0` excludes 0.2.0 (0.x carets only allow patch bumps), which left starters stuck on
  // the first release. `latest` is the fallback when the version isn't known (direct helper calls).
  const cliRange = opts.cliVersion ? `^${opts.cliVersion}` : 'latest';
  const devDependencies: Record<string, string> = { '@leclap/cli': cliRange };

  // The MCP is a local devDep only when Remotion is set up — render_remotion_clip dynamically imports
  // @remotion/* (the MCP's optional peer deps), which resolve only from the local install. Without
  // Remotion the MCP runs zero-install via `npx -y` (see mcpConfig), so it needs no entry here. Tracked
  // at `latest` since the cli can't know the MCP's published version.
  if (opts.mcp && opts.remotion) {
    devDependencies['@leclap/mcp'] = 'latest';
  }

  if (opts.remotion) {
    // `latest` so the starter isn't pinned to a fast-moving Remotion release that goes stale; React is
    // held at the major Remotion's peer range expects, so a floating React can't drift past it.
    devDependencies['@remotion/bundler'] = 'latest';
    devDependencies['@remotion/renderer'] = 'latest';
    devDependencies.remotion = 'latest';
    devDependencies.react = '^19.0.0';
    devDependencies['react-dom'] = '^19.0.0';
  }

  return {
    name: projectName,
    private: true,
    type: 'module',
    scripts: { render: 'leclap render template.json' },
    devDependencies,
  };
}

// pnpm skips dependency build scripts unless approved, and since pnpm 11 it reads approvals only from
// `allowBuilds` in pnpm-workspace.yaml (the package.json `pnpm` field is ignored) and fails the install
// on any unapproved one. Without `ffmpeg-static` the binary never downloads and renders fail; `esbuild`
// arrives with the Remotion bundler. npm / yarn / bun ignore this file and run the scripts anyway.
const PNPM_WORKSPACE = 'allowBuilds:\n  esbuild: true\n  ffmpeg-static: true\n';

// The project-scoped MCP server config (Claude Code / generic `.mcp.json` shape). Absolute env paths so
// it resolves regardless of the client's working directory.
function mcpConfig(projectDir: string, remotion: boolean) {
  const env: Record<string, string> = {
    LECLAP_MCP_MEDIA_DIR: projectDir,
    LECLAP_MCP_OUTPUT_DIR: path.join(projectDir, 'build'),
  };

  if (remotion) {
    env.LECLAP_MCP_REMOTION_ENTRY = path.join(projectDir, 'remotion', 'index.ts');
    // render_remotion_clip executes project-supplied JS, so the server registers it only behind
    // this explicit opt-in (default off). Without it the scaffolded workflow references a tool
    // that never appears in tools/list.
    env.LECLAP_MCP_ALLOW_REMOTION = '1';
  }

  // With Remotion the MCP is a local devDep (so it resolves the project's @remotion) — run the local
  // install. Without Remotion it has no local install, so fetch it zero-install via `npx -y`.
  const args = remotion ? ['@leclap/mcp'] : ['-y', '@leclap/mcp'];

  return { mcpServers: { leclap: { command: 'npx', args, env } } };
}

// A self-contained Remotion starter (system font, no asset deps): a spring-popped wordmark, a drawn
// accent bar, and a fading tagline. The MCP renders composition "Intro" to a clip via render_remotion_clip.
function remotionFiles(projectName: string): Record<string, string> {
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

function readme(projectName: string, opts: StarterOptions): string {
  const pm = opts.packageManager ?? 'npm';
  const install = INSTALL_CMD[pm];
  const run = RUN_CMD[pm];

  const mcpRunNote = opts.remotion
    ? ` For an animated intro, the agent calls \`render_remotion_clip { compositionId: "Intro" }\`
(rendered from \`remotion/\`) and passes the clip to \`compose_video\` via \`userVideoPaths.intro\`.

Run \`${install}\` first: with Remotion the MCP runs from the **local** install so it can resolve your
\`@remotion/*\` and render \`remotion/\`.`
    : ` The MCP runs zero-install via \`npx\` — no \`${install}\` needed for it.`;

  const mcpSection = opts.mcp
    ? `

## Author with an AI agent (MCP)

This project ships an \`.mcp.json\` wiring [\`@leclap/mcp\`](https://github.com/heristop/leclap).
Point your agent client (Claude Code, Cursor, …) at it, then ask the agent to author and \`compose_video\`.${mcpRunNote}

> The \`.mcp.json\` env paths are absolute (this machine). Regenerate or edit them if you move the project.`
    : '';

  const remotionSection = opts.remotion
    ? `

## Remotion intro

\`remotion/\` is a standalone [Remotion](https://www.remotion.dev) project (composition \`Intro\`).
Install deps, then the MCP renders it to a clip that \`template.json\`'s \`intro\` section composites.`
    : '';

  return `# ${projectName}

A LeClap video project. Edit \`template.json\`, drop any media into \`assets/\`, then render:

\`\`\`bash
${install}
${run}
\`\`\`

## Creative direction

Edit \`meta.creativeDirection\` in \`template.json\` before changing the composition. Record the audience,
visual hierarchy, typography, palette, motion, pacing, things to avoid and frames to review. This is
an authoring brief, not a render command: implement it explicitly in JSON settings or Remotion props.
Keep the rendered copy separate. Validate text bounds and inspect the entrance, settled hold and ending.
${mcpSection}${remotionSection}

See the descriptor reference: https://github.com/heristop/leclap
`;
}

// Pure: the file set for a new project, keyed by project-relative path. No IO.
export function starterFiles(projectName: string, opts: StarterOptions = {}): Record<string, string> {
  const projectDir = opts.projectDir ?? projectName;

  const files: Record<string, string> = {
    'template.json': `${JSON.stringify(starterTemplate(Boolean(opts.remotion), opts.creativeDirection), null, 2)}\n`,
    'package.json': `${JSON.stringify(packageJson(projectName, opts), null, 2)}\n`,
    'pnpm-workspace.yaml': PNPM_WORKSPACE,
    'README.md': readme(projectName, opts),
    'assets/.gitkeep': '',
  };

  if (opts.mcp) {
    files['.mcp.json'] = `${JSON.stringify(mcpConfig(projectDir, Boolean(opts.remotion)), null, 2)}\n`;
  }

  if (opts.remotion) {
    Object.assign(files, remotionFiles(projectName));
  }

  return files;
}

// Resolve a yes/no setup choice: an explicit flag wins; `--yes` (or a non-TTY context) takes the
// default; otherwise prompt (default Yes).
async function resolveChoice(flag: boolean | undefined, yes: boolean | undefined, message: string): Promise<boolean> {
  if (flag !== undefined) {
    return flag;
  }

  if (yes) {
    return true;
  }

  return confirm(message, true);
}

// Print the post-scaffold "Next steps" using the detected package manager's install + run commands.
function printNextSteps(name: string, pm: PackageManager, mcp: boolean): void {
  const created = success(`Created ${pc.bold(name)}`);
  console.log(`\n${created}\n`);
  console.log(hint('Next steps'));
  console.log(step(`cd ${name}`));
  console.log(step(INSTALL_CMD[pm]));
  console.log(step(RUN_CMD[pm]));

  if (mcp) {
    console.log(step('point your agent client at .mcp.json, then ask it to compose a video'));
  }

  console.log('');
}

export const init = defineCommand({
  meta: { name: 'init', description: 'Scaffold a starter LeClap project' },
  args: {
    name: {
      type: 'positional',
      description: 'Project directory to create',
      required: false,
      default: 'my-leclap-video',
    },
    mcp: { type: 'boolean', description: 'Add @leclap/mcp wiring (.mcp.json) — prompts by default' },
    remotion: { type: 'boolean', description: 'Add a Remotion starter for animated intros — prompts by default' },
    'creative-direction': {
      type: 'string',
      description: 'Authoring brief stored in template metadata (1..4000 characters; does not change render settings)',
    },
    yes: { type: 'boolean', alias: 'y', description: 'Accept all defaults (no prompts)' },
    studio: { type: 'string', description: 'Scaffold a production folder (brief, shot list, gates) instead' },
  },
  async run({ args }) {
    if (args.studio) return runStudioInit(args.studio);

    const name = args.name || 'my-leclap-video';
    const dir = path.resolve(process.cwd(), name);

    process.stdout.write(wordmark());

    try {
      const entries = await fs.readdir(dir);

      if (entries.length > 0) {
        console.error(fail(`${pc.bold(name)} already exists and is not empty`));
        process.exit(1);
      }
    } catch (error) {
      // ENOENT is the happy path (dir doesn't exist yet). Anything else — most importantly ENOTDIR,
      // when the target name already exists as a regular file — is a real error; surface it cleanly
      // instead of letting the later writes throw a raw stack.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(fail(`Cannot create ${pc.bold(name)}: ${(error as Error).message}`));
        process.exit(1);
      }
    }

    const remotion = await resolveChoice(args.remotion, args.yes, 'Add a Remotion starter for animated intros?');
    // A Remotion intro is rendered THROUGH the MCP (render_remotion_clip), so Remotion implies the MCP
    // wiring — otherwise the generated project has an intro slot with no renderer (and a README that
    // claims one exists). When Remotion is off, the MCP is still offered on its own.
    const mcp = remotion
      ? true
      : await resolveChoice(args.mcp, args.yes, 'Set up the LeClap MCP server for AI-agent authoring?');

    const packageManager = detectPackageManager();
    const files = starterFiles(path.basename(dir), {
      mcp,
      remotion,
      projectDir: dir,
      cliVersion: resolveCliVersion(),
      packageManager,
      creativeDirection: args['creative-direction'],
    });

    await Promise.all(
      Object.entries(files).map(async ([relative, contents]) => {
        const target = path.join(dir, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, contents);
      })
    );

    printNextSteps(name, packageManager, mcp);
  },
});
