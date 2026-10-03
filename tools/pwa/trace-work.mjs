/**
 * تتبّع عمل واحد عبر كل سيرفراته في محرك الـPWA (نفس المحركات، والطلب من هذه
 * الآلة عبر curl): بحث ← حلقات ← كل سيرفر ← رابط ← أول بايتات/قائمة HLS.
 *
 *   node tools/pwa/trace-work.mjs arabseed "spider-man across the spider-verse" [حلقة]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { createHostResolver } from '../../apps/web/pwa/sources/hosts.js';

useLinkedom();
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const [sourceId, query, epArg] = process.argv.slice(2);
const def = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources.find((d) => d.id === sourceId);
const fetch = liveFetcher();
const engine = ENGINES[def.engine].create(def, { fetch, hosts: createHostResolver(fetch) });
const t = (p, ms = 30_000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms}`)), ms))]);

function probe(s) {
  const ref = s.referer ? ['-H', `Referer: ${s.referer}`] : [];
  if (s.type === 'hls') {
    const body = execFileSync('curl', ['-s', '-L', '-m', '20', '-A', UA, ...ref, s.url]).toString().slice(0, 3000);
    if (!body.startsWith('#EXTM3U')) return `HLS ✗ ${JSON.stringify(body.slice(0, 80))}`;
    const res = [...body.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => m[1]);
    return `HLS ✓ ${res.length ? res.join('/') + 'p' : 'media'}`;
  }
  const out = execFileSync('sh', ['-c', `curl -s -L -m 20 -A '${UA}' ${s.referer ? `-H 'Referer: ${s.referer}'` : ''} -r 0-4095 -D - -o /dev/null ${JSON.stringify(s.url)}; true`]).toString();
  const status = [...out.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].pop()?.[1];
  const type = [...out.matchAll(/^content-type:\s*(\S+)/gim)].pop()?.[1];
  const len = [...out.matchAll(/^content-range:\s*\S+ \S+\/(\d+)/gim)].pop()?.[1] ?? [...out.matchAll(/^content-length:\s*(\d+)/gim)].pop()?.[1];
  return `MP4 ${status} ${type} ${len ? (Number(len) / 1e6).toFixed(1) + 'MB' : ''}`;
}

const items = await t(engine.search(query));
console.log('بحث:', items.slice(0, 5).map((i) => i.title).join(' | '));
const item = items[0];
const eps = await t(engine.episodes(item));
console.log('حلقات:', eps.length, eps.slice(0, 3).map((e) => e.number ?? e.name));
const ep = epArg ? eps.find((e) => Number(e.number) === Number(epArg)) : eps[0];
const servers = await t(engine.servers(ep));
console.log('سيرفرات:', servers.length);
for (const sv of servers) {
  const started = Date.now();
  try {
    if (sv.unsupported) { console.log(`  ${sv.name.padEnd(18)} غير مدعوم`); continue; }
    const streams = await t(engine.streams(sv), 25_000);
    if (!streams?.length) { console.log(`  ${sv.name.padEnd(18)} فارغ (${Date.now() - started}ms) ${sv.url ?? sv.key ?? ''}`); continue; }
    for (const s of streams.slice(0, 2)) console.log(`  ${sv.name.padEnd(18)} ${s.type} q=${s.quality ?? '-'} → ${probe(s)}  ${s.url.slice(0, 90)}`);
  } catch (e) {
    console.log(`  ${sv.name.padEnd(18)} ✗ ${String(e?.message ?? e).slice(0, 100)} ${sv.url ?? ''}`);
  }
}
