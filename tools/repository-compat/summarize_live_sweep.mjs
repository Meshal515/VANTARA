// Markdown table of a live sweep: one row per source, one column per journey step, and the media hosts
// that still lack an extractor (ordered by how many sources need them).
import {readFileSync} from 'node:fs';

const rows = readFileSync(process.argv[2] ?? 'live-sweep.jsonl', 'utf8').split('\n')
  .filter((line) => line.startsWith('{')).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const steps = ['install', 'catalogue', 'details', 'episodes', 'videoLinks'];
const cell = (step) => !step ? '—' : step.result === 'PASS' ? '✅' : `❌ ${String(step.reason ?? '').slice(0, 60)}`;
const out = ['## Live repository sweep', '', `| Plugin | ${steps.join(' | ')} | links | missing extractors |`, `|---|${steps.map(() => '---').join('|')}|---|---|`];
const missing = new Map();
let playable = 0;
for (const row of rows) {
  const sources = row.sources?.length ? row.sources : [{}];
  for (const source of sources) {
    const cells = steps.map((name) => cell(name === 'install' ? row.install : source[name]));
    for (const host of source.missingExtractors ?? []) missing.set(host, (missing.get(host) ?? 0) + 1);
    if ((source.links ?? 0) > 0) playable += 1;
    out.push(`| ${row.plugin} | ${cells.join(' | ')} | ${source.links ?? 0} | ${(source.missingExtractors ?? []).join(', ')} |`);
  }
}
out.push('', `**Sources with at least one playable link: ${playable} of ${rows.length}**`, '');
if (missing.size) out.push('### Missing extractors by demand', '', ...[...missing].sort((a, b) => b[1] - a[1]).map(([host, n]) => `- ${host}: ${n}`));
console.log(out.join('\n'));
