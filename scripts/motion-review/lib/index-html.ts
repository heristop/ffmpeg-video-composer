import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ManifestEntry, RunManifest } from './types.ts';

// The review page: a static index.html at the output root with one column per run (before, after, …)
// and one row per sheet key, so the same fixture × background × format sits side by side. Plain HTML
// and CSS, no scripts, relative image paths: the folder can be zipped or attached as is.

const RUN_ORDER = ['before', 'after'];

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function readRuns(out: string): RunManifest[] {
  const runs = readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(out, entry.name, 'manifest.json')))
    .map((entry) => JSON.parse(readFileSync(path.join(out, entry.name, 'manifest.json'), 'utf8')) as RunManifest);
  const rank = (label: string): number => {
    const index = RUN_ORDER.indexOf(label);

    return index === -1 ? RUN_ORDER.length : index;
  };

  return runs.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

function cell(entry: ManifestEntry | undefined): string {
  if (!entry) return '<td class="empty">not in this run</td>';

  const notes = entry.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('');
  const body =
    entry.status === 'ok' && entry.sheet
      ? `<a href="${escapeHtml(entry.sheet)}"><img loading="lazy" src="${escapeHtml(entry.sheet)}" alt=""></a>`
      : `<p class="status ${entry.status}">${escapeHtml(entry.error ?? entry.status)}</p>`;

  return `<td>${body}<p class="meta">${entry.status} · ${entry.ms} ms</p>${notes ? `<ul>${notes}</ul>` : ''}</td>`;
}

function rowKeys(runs: RunManifest[]): ManifestEntry[] {
  const seen = new Map<string, ManifestEntry>();

  for (const entry of runs.flatMap((run) => run.entries)) if (!seen.has(entry.key)) seen.set(entry.key, entry);

  return [...seen.values()].sort(
    (a, b) => a.group.localeCompare(b.group) * -1 || a.key.localeCompare(b.key, 'en', { numeric: true })
  );
}

function table(runs: RunManifest[], rows: ManifestEntry[]): string {
  const head = runs
    .map((run) => `<th>${escapeHtml(run.label)}<span>${escapeHtml(run.engine)} · ${run.createdAt}</span></th>`)
    .join('');
  const body = rows
    .map((row) => {
      const cells = runs.map((run) => cell(run.entries.find((entry) => entry.key === row.key))).join('');

      return `<tr id="${escapeHtml(row.key)}"><th>${escapeHtml(row.title)}<span>${escapeHtml(row.kind)} · ${escapeHtml(row.key)}</span></th>${cells}</tr>`;
    })
    .join('\n');

  return `<table><thead><tr><th>sheet</th>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

function showcase(out: string): string {
  const dir = path.join(out, 'showcase');

  if (!existsSync(dir)) return '';

  const images = readdirSync(dir)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => {
      const src = escapeHtml(`showcase/${file}`);

      return `<figure><a href="${src}"><img loading="lazy" src="${src}" alt=""></a><figcaption>${escapeHtml(file)}</figcaption></figure>`;
    })
    .join('\n');

  return `<h2>Showcase baseline</h2><p>Sheets cut from the committed showcase renders (real APNG assets).</p><div class="grid">${images}</div>`;
}

const STYLE = `
:root{--bg:#f6f5f2;--fg:#1d1f24;--muted:#6b6f78;--line:#d9d6cf;--bad:#b3261e;--skip:#8a6d00}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--fg:#e8e6e1;--muted:#9a9ea8;--line:#2c2f37;--bad:#ff8a80;--skip:#e0c25c}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
table{border-collapse:collapse;width:100%}th,td{border-top:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}
th span{display:block;color:var(--muted);font-weight:400;font-size:12px}tbody th{width:16em}
img{width:100%;max-width:960px;display:block}.meta{color:var(--muted);font-size:12px;margin:4px 0}
ul{margin:0;padding-left:18px;color:var(--muted);font-size:12px}.status.failed{color:var(--bad)}.status.skipped{color:var(--skip)}
.empty{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
figure{margin:0}figcaption{color:var(--muted);font-size:12px}`;

/** (Re)write `<out>/index.html` from every run manifest found under `out`. */
export function writeIndex(out: string): string {
  const runs = readRuns(out);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motion review</title><style>${STYLE}</style></head><body>
<h1>Motion review</h1><p>Six moments per sheet over the effect's life (templates: across the whole video). Rows marked "pointer, not rendered" use an asset that is still a Git LFS pointer.</p>
${table(runs, rowKeys(runs))}
${showcase(out)}
</body></html>
`;
  const file = path.join(out, 'index.html');

  writeFileSync(file, html);

  return file;
}
