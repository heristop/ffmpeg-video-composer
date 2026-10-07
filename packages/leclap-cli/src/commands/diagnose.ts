import { defineCommand } from 'citty';
import pc from 'picocolors';
import { FFmpegDetector } from 'ffmpeg-video-composer';
import { fail, hint, step } from '../ui.js';
import { wordmark, statusRow, ok, dot } from '../theme.js';
import { capabilityFixes, capabilityReport, capabilityRow } from '../diagnose-capabilities.js';

// `ffprobe` is only reported for static: false when ffmpeg-static has no ffprobe to probe media with.
type ImplStatus = { available: boolean; version?: string; ffprobe?: boolean };

type FFmpegStatus = { system: ImplStatus; static: ImplStatus; wasm: ImplStatus };

// One uniform presentation per backend: green ✓ when present, a dim ✗ when not — availability is the
// only thing colour encodes. (The engine's own diagnostics paint each backend a different hue; we
// suppress that and render our own calm, aligned row instead.)
function impl(name: string, status: ImplStatus): string {
  if (!status.available) return pc.dim(`✗ ${name}`);

  const backend = `${ok} ${name} ${pc.dim(status.version ?? '')}`.trimEnd();

  if (status.ffprobe === false) return `${backend} ${pc.dim('(no ffprobe)')}`;

  return backend;
}

// Renders run on system FFmpeg, else on ffmpeg-static — which, without an ffprobe, can't probe media,
// so templates with transitions, music, whole-video overlays or video clips stop before encoding.
function verdict(ff: FFmpegStatus): string {
  if (!ff.system.available && ff.static.available && ff.static.ffprobe === false) {
    return fail('Setup required for templates with transitions, music, overlays or video clips.');
  }

  if (ff.system.available || ff.static.available || ff.wasm.available) return `${ok} ${pc.bold('Ready to render.')}`;

  return fail('Setup required before you can render.');
}

// `--json`: the capability report alone, machine-readable — the MCP get_capabilities payload.
async function runJson(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await capabilityReport(), null, 2)}\n`);
}

async function runHuman(): Promise<void> {
  process.stdout.write(wordmark());

  const report = await FFmpegDetector.runFullDiagnostics(false);
  const sys = report.systemInfo;
  const ff = report.ffmpegStatus;
  const capabilities = await capabilityReport();

  // `systemInfo.os` already carries the arch (e.g. "darwin arm64"), so don't append it again.
  console.log(statusRow('system', pc.dim(`${sys.os}  ${dot}  node ${sys.nodeVersion}  ${dot}  ${sys.memoryGB}GB`)));
  console.log(
    statusRow(
      'ffmpeg',
      [impl('system', ff.system), impl('static', ff.static), impl('wasm', ff.wasm)].join(`  ${dot}  `)
    )
  );
  console.log(capabilityRow(capabilities));
  console.log('');

  // The engine prefixes recommendations with decorative emoji; strip a leading symbol so they sit
  // cleanly under the `›` marker in the refined layout.
  const suggestions = [
    ...report.recommendations.map((rec) => rec.replace(/^[^\p{L}\p{N}]+/u, '')),
    ...capabilityFixes(capabilities),
  ];

  if (suggestions.length > 0) {
    console.log(hint('Suggestions'));

    for (const suggestion of suggestions) console.log(step(suggestion));
    console.log('');
  }

  console.log(verdict(ff));
}

export const diagnose = defineCommand({
  meta: { name: 'diagnose', description: 'Check your FFmpeg setup and what it can render' },
  args: {
    json: {
      type: 'boolean',
      description: 'Print the FFmpeg capability report as JSON (features with fixes, fonts, encoders)',
      default: false,
    },
  },
  async run({ args }) {
    try {
      await (args.json ? runJson() : runHuman());
    } catch (error) {
      console.error(fail(`Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  },
});
