import pc from 'picocolors';
import type { QcFinding, QcReport, QcStatus } from 'ffmpeg-video-composer';
import { bad, ok } from './theme.js';

// `leclap render --qc`: the engine probes (and decodes once) the finished video and reports findings.
// This prints them as a compact table and decides the exit status: any `fail` exits non-zero.

const MARKS: Record<QcStatus, string> = { pass: ok, warn: pc.yellow('!'), fail: bad };

function cell(value: QcFinding['value']): string {
  return value === null ? '-' : String(value);
}

function row(finding: QcFinding, width: number, valueWidth: number): string {
  const kind = pc.dim(finding.kind === 'format' ? 'format   ' : 'judgement');
  const value = cell(finding.value).padEnd(valueWidth);
  const expected = finding.expected === null ? '' : pc.dim(` expected ${cell(finding.expected)}`);

  return `  ${MARKS[finding.status]} ${finding.check.padEnd(width)}  ${kind}  ${value}${expected}  ${pc.dim(finding.reason)}`;
}

/** The QC table: a verdict line, then one row per finding. */
export function formatQcTable(report: QcReport): string {
  const width = Math.max(...report.findings.map((finding) => finding.check.length));
  const valueWidth = Math.max(...report.findings.map((finding) => cell(finding.value).length));
  const verdict = report.verified ? `${ok} verified` : `${bad} not verified`;
  const failed = failedChecks(report);
  const tail = failed.length > 0 ? pc.red(`  ${failed.length} failed`) : '';

  return [`QC ${verdict}${tail}`, ...report.findings.map((finding) => row(finding, width, valueWidth))].join('\n');
}

/** Names of the failing checks; `--qc` exits non-zero when there is any. */
export function failedChecks(report: QcReport | undefined): string[] {
  return (report?.findings ?? []).filter((finding) => finding.status === 'fail').map((finding) => finding.check);
}

/** Prints the table (unless quiet) and returns whether the render must exit non-zero. */
export function reportQc(report: QcReport | undefined, quiet: boolean): boolean {
  if (!report) return false;

  if (!quiet) console.log(`\n${formatQcTable(report)}`);

  return failedChecks(report).length > 0;
}
