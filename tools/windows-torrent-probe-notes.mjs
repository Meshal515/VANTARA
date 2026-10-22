// يحوّل تقرير فحص ويندوز إلى ملاحظات GitHub (::notice) وملخص الخطوة؛ الملاحظات تُقرأ من الـAPI.
import { readFile, appendFile } from 'node:fs/promises';
const [path, part] = process.argv.slice(2);
let report;
try { report = JSON.parse(await readFile(path, 'utf8')); } catch (e) { console.log(`::error title=probe::لا تقرير: ${e.message}`); process.exit(0); }
const clean = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/::/g, ':');
const notes = [];
if (part === 'network') {
  const cell = x => !x ? '-' : 'status' in x ? `${x.status}/${x.ms}ms${x.cf ? '/CF' : ''}` : `ERR ${clean(x.error).slice(0, 70)}/${x.ms}ms`;
  const rows = report.network.map(n => `${n.name} | DoH ${cell(n.doh)} | SYS ${cell(n.system)}`);
  for (let i = 0; i < rows.length; i += 9) notes.push(['network', rows.slice(i, i + 9).join(' ;; ')]);
} else {
  for (const t of report.torrents) {
    if (t.skipped) { notes.push(['skip', `${t.name}: ${t.skipped}`]); continue; }
    const peers = Math.max(0, ...t.samples.map(s => s.peers ?? 0)), kbps = Math.max(0, ...t.samples.map(s => s.kbps ?? 0));
    const stages = t.stages.map(s => `${s.stage}@${s.t}`).join('>');
    notes.push(['torrent', `${t.name} | frame ${t.firstFrameMs} | seek ${t.seekMs} | ${t.failure ?? t.seekFailure ?? 'OK'} | peers ${peers} kbps ${kbps} | ${stages}`]);
  }
  notes.push(['switch', JSON.stringify(report.switch)]);
}
for (const [title, text] of notes.slice(0, 10)) console.log(`::notice title=${title}::${clean(text).slice(0, 3800)}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, notes.map(([t, x]) => `- **${t}**: ${x}`).join('\n') + '\n', 'utf8');
