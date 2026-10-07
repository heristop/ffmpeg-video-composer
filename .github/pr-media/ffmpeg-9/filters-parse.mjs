// Counts the filters the engine's `-filters` parser finds, with the pre-fix and the fixed pattern.
import { execFileSync } from 'node:child_process';
const OLD = /^\s[.A-Z|]{3}\s+(\w+)\s+\S+->\S+/;
const NEW = /^\s[.A-Z|]{2,3}\s+(\w+)\s+\S+->\S+/;
for (const [label, bin] of process.argv.slice(2).map((a) => a.split('='))) {
  const out = execFileSync(bin, ['-hide_banner', '-filters'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const lines = out.split('\n');
  const count = (re) => lines.filter((l) => re.test(l)).length;
  const has = (re, name) => lines.some((l) => re.exec(l)?.[1] === name);
  console.log(`${label}: sample line ${JSON.stringify(lines.find((l) => /\stonemap\s/.test(l)))}`);
  console.log(
    `  pre-fix parser: ${count(OLD)} filters (tonemap found: ${has(OLD, 'tonemap')}, zscale found: ${has(OLD, 'zscale')})`
  );
  console.log(
    `  fixed parser:   ${count(NEW)} filters (tonemap found: ${has(NEW, 'tonemap')}, zscale found: ${has(NEW, 'zscale')})`
  );
}
