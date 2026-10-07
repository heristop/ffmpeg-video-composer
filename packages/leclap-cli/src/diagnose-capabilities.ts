// The capability half of `leclap diagnose`: probe the FFmpeg renders will run on (system first, then
// ffmpeg-static, as the engine picks it) and say, per feature, whether it really renders and what to do
// when it does not. `--json` prints the engine's report unchanged — the same JSON as the MCP
// `get_capabilities` tool.
import pc from 'picocolors';
import {
  FFmpegAvailability,
  FFmpegDetector,
  probeCapabilities,
  type CapabilityReport,
  type FeatureStatus,
} from 'ffmpeg-video-composer';
import { statusRow, ok, dot } from './theme.js';

/** The binary the engine renders with: `ffmpeg` on PATH, else the ffmpeg-static path. */
export async function renderBinary(): Promise<string> {
  const detection = await FFmpegDetector.detect();

  if (detection.availability === FFmpegAvailability.STATIC && detection.path) return detection.path;

  return 'ffmpeg';
}

export async function capabilityReport(): Promise<CapabilityReport> {
  return probeCapabilities({ binary: await renderBinary() });
}

function unusable(report: CapabilityReport): Array<[string, FeatureStatus]> {
  return Object.entries(report.features).filter(([, status]) => status.usable !== 'yes');
}

/** One status row: how many features render, and the ones that do not. */
export function capabilityRow(report: CapabilityReport): string {
  const missing = unusable(report);
  const total = Object.keys(report.features).length;
  const summary = `${ok} ${total - missing.length}/${total} features`;
  const names = missing.map(([id, status]) => (status.usable === 'no' ? pc.dim(`✗ ${id}`) : pc.dim(`? ${id}`)));

  return statusRow('features', [summary, ...names].join(`  ${dot}  `));
}

/** The fix for every feature this FFmpeg cannot run, for the Suggestions list. */
export function capabilityFixes(report: CapabilityReport): string[] {
  return unusable(report).flatMap(([id, status]) => (status.fix ? [`${id}: ${status.fix}`] : []));
}
