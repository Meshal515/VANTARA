// Markdown table of a live sweep: one row per source, one column per journey step, and the media hosts
// that still lack an extractor (ordered by how many sources need them).
import {readFileSync} from 'node:fs';

const rows = readFileSync(process.argv[2] ?? 'live-sweep.jsonl', 'utf8').split('\n')
  .filter((line) => line.startsWith('{')).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const steps = ['install', 'catalogue', 'details', 'episodes', 'videoLinks'];
const cell = (step) => !step ? '—' : step.result === 'PASS' ? '✅' : `❌ ${String(step.reason ?? '').slice(0, 60)}`;
const out = ['## Live repository sweep', '', `| Plugin | ${steps.join(' | ')} | links | missing extractors |`, `|---|${steps.map(() => '---').join('|')}|---|---|`];
const missing = new Map();
let sourceCount = 0;
let extracted = 0;
let mediaReachable = 0;
for (const row of rows) {
  const sources = row.sources?.length ? row.sources : [{}];
  for (const source of sources) {
    const cells = steps.map((name) => cell(name === 'install' ? row.install : source[name]));
    for (const host of source.missingExtractors ?? []) missing.set(host, (missing.get(host) ?? 0) + 1);
    sourceCount += 1;
    if ((source.links ?? 0) > 0) extracted += 1;
    // The device probe fetched actual media bytes; this is still not decoded-frame evidence.
    if ((source.playable ?? 0) > 0) mediaReachable += 1;
    out.push(`| ${row.plugin} | ${cells.join(' | ')} | ${source.links ?? 0} | ${(source.missingExtractors ?? []).join(', ')} |`);
  }
}
out.push('', `**Source journeys: ${sourceCount}; with extracted links: ${extracted}; with reachable media bytes: ${mediaReachable}.**`, '', '**Media-byte reachability does NOT certify playback in VANTARA.**', '');
if (missing.size) out.push('### Missing extractors by demand', '', ...[...missing].sort((a, b) => b[1] - a[1]).map(([host, n]) => `- ${host}: ${n}`));
console.log(out.join('\n'));
