/**
 * تتبّع عمل سينما بهويته (معرّف IMDb) عبر كل مصدر عربي، من هذه الآلة عبر curl
 * بنفس محركات الـPWA ونفس المطابقة التي في التطبيق:
 *
 *   الهوية ← الأسماء ← الاستعلامات ← ردّ المصدر ← النسخ المرشحة بدرجتها وسبب
 *   رفضها ← المطابقة ← الحلقات ← السيرفرات ← الاستخراج ← فحص أول البايتات.
 *
 *   node tools/pwa/trace-identity.mjs series tt1586680 [موسم] [حلقة]
 *   node tools/pwa/trace-identity.mjs movie tt1927068
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { createHostResolver } from '../../apps/web/pwa/sources/hosts.js';
import { detail, search } from '../../apps/web/lib/cinema-meta.js';
import { matchCriteria, mergeWork } from '../../apps/web/lib/cinema-identity.js';
import { explainCopies, queriesFor } from '../../apps/web/lib/cinema-match.js';
import { REJECT_AR, STATE, STATE_AR, errorState } from '../../apps/web/lib/source-states.js';

useLinkedom();
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const [type, id, seasonArg, episodeArg] = process.argv.slice(2);
const season = type === 'series' ? Number(seasonArg ?? 1) : null;
const episode = type === 'series' ? Number(episodeArg ?? 1) : -1;
const t = (p, ms = 30_000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms}`)), ms))]);
const curlFetch = async (url) => {
  const body = execFileSync('curl', ['-sL', '-m', '30', '-A', UA, url]).toString();
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

function probe(s) {
  const ref = s.referer ? ['-H', `Referer: ${s.referer}`] : [];
  try {
    if (s.type === 'hls') {
      const body = execFileSync('curl', ['-s', '-L', '-m', '20', '-A', UA, ...ref, s.url]).toString().slice(0, 3000);
      if (!body.startsWith('#EXTM3U')) return { ok: false, text: `HLS ✗ ${JSON.stringify(body.slice(0, 60))}` };
      const res = [...body.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => m[1]);
      return { ok: true, text: `HLS ✓ ${res.length ? `${res.join('/')}p` : 'media'}` };
    }
    const out = execFileSync('curl', ['-s', '-L', '-m', '20', '-A', UA, ...ref, '-r', '0-4095', '-D', '-', '-o', '/dev/null', s.url]).toString();
    const status = [...out.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].pop()?.[1];
    const ctype = [...out.matchAll(/^content-type:\s*(\S+)/gim)].pop()?.[1] ?? '';
    const ok = /^20[06]$/.test(status ?? '') && /video|octet-stream|mp4/i.test(ctype);
    return { ok, text: `MP4 ${status} ${ctype}` };
  } catch (e) {
    return { ok: false, text: `✗ ${String(e?.message ?? e).slice(0, 60)}` };
  }
}

const card = (await search(id, { fetchImpl: curlFetch }).catch(() => [])).find((r) => r.id === id) ?? { id, type };
const work = mergeWork(card, await detail(type, id, { fetchImpl: curlFetch }));
if (!work) throw new Error(`no Cinemeta detail for ${type}/${id}`);
const peers = await search(work.title, { fetchImpl: curlFetch });
const crit = matchCriteria(work, { season, results: peers });
const queries = queriesFor(crit.title, crit);
console.log(`# ${work.title} (${work.year}${work.endYear ? `–${work.endYear}` : ''}) · ${type} · ${id}${season ? ` · الموسم ${season} الحلقة ${episode}` : ''}`);
console.log(`الأسماء: ${[crit.title, ...crit.aliases].join(' | ')}${crit.weakAliases.length ? ` · ضعيفة: ${crit.weakAliases.join(' | ')}` : ''}`);
console.log(`إخوة الاسم: ${crit.sharedNames?.length ? `${crit.primary ? 'الأشهر' : 'ليس الأشهر'} · سنواتهم ${crit.namesakeYears.join('، ')}` : 'لا أحد'}`);
console.log(`الاستعلامات: ${queries.join(' | ')}\n`);

const defs = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources.filter((d) => d.content === 'cinema' || process.argv.includes(`--with=${d.id}`));
const fetch = liveFetcher();
const summary = [];
for (const def of defs) {
  const engine = ENGINES[def.engine].create(def, { fetch, hosts: createHostResolver(fetch) });
  console.log(`## ${def.id}`);
  const seen = new Map();
  let state = null;
  let matched = [];
  for (const q of queries) {
    const t0 = Date.now();
    try {
      const items = (await t(engine.search(q), 25_000)).map((it) => ({ ...it, sourceId: def.id }));
      for (const it of items) seen.set(it.url, it);
      const judged = explainCopies(items, crit);
      matched = judged.filter((j) => j.ok).sort((a, b) => b.score - a.score);
      console.log(`  «${q}» → ${items.length} نتيجة · ${Date.now() - t0}ms · مطابق ${matched.length}`);
      for (const j of judged.slice(0, 8)) console.log(`     ${j.ok ? '✓' : '✗'} ${j.score.toFixed(2)} ${j.copy.title}${j.ok ? '' : ` — ${REJECT_AR[j.reason] ?? j.reason}`}`);
      state = matched.length ? STATE.MATCHED : STATE.SOURCE_RESPONDED_NO_MATCH;
      if (matched.length) break;
    } catch (e) {
      state ??= errorState(e?.message);
      console.log(`  «${q}» → ${STATE_AR[errorState(e?.message)]}: ${String(e?.message ?? e).slice(0, 90)}`);
    }
  }
  if (!matched.length) {
    console.log(`  ⇒ ${state} (${STATE_AR[state]})\n`);
    summary.push([def.id, state, '-', '-', '-']);
    continue;
  }
  const copy = matched[0].copy;
  console.log(`  النسخة: ${copy.title} ${copy.url}`);
  let row = [def.id, STATE.MATCHED, 0, 0, '-'];
  try {
    const eps = await t(engine.episodes(copy));
    const ep = episode < 0 ? eps[0] : eps.find((e) => Number(e.number) === episode) ?? (eps.length === 1 && episode === 1 ? eps[0] : null);
    console.log(`  الحلقات: ${eps.length}${ep ? ` · المطلوبة ${ep.url}` : ' · المطلوبة غير موجودة'}`);
    if (!ep) {
      summary.push([def.id, STATE.NO_SERVER_CANDIDATES, 0, 0, 'لا حلقة']);
      console.log(`  ⇒ ${STATE.NO_SERVER_CANDIDATES}\n`);
      continue;
    }
    const servers = await t(engine.servers(ep));
    let extracted = 0;
    let playable = 0;
    let best = 0;
    for (const sv of servers) {
      if (sv.unsupported) {
        console.log(`    ${String(sv.name).padEnd(16)} غير مدعوم`);
        continue;
      }
      try {
        const streams = (await t(engine.streams(sv), 25_000)) ?? [];
        if (!streams.length) {
          console.log(`    ${String(sv.name).padEnd(16)} الاستخراج فارغ`);
          continue;
        }
        extracted++;
        const p = probe(streams[0]);
        if (p.ok) {
          playable++;
          best = Math.max(best, streams[0].quality ?? sv.quality ?? 0);
        }
        console.log(`    ${String(sv.name).padEnd(16)} q=${streams[0].quality ?? sv.quality ?? '-'} ${p.text}`);
      } catch (e) {
        console.log(`    ${String(sv.name).padEnd(16)} ✗ ${String(e?.message ?? e).slice(0, 80)}`);
      }
    }
    const st = playable ? STATE.PLAYABLE : !servers.length ? STATE.NO_SERVER_CANDIDATES : extracted ? STATE.ZERO_PLAYABLE : STATE.RESOLVER_FAILED;
    row = [def.id, st, servers.length, playable, best ? `${best}p` : '-'];
    console.log(`  ⇒ ${st} (${STATE_AR[st]}) · سيرفرات ${servers.length} · مستخرج ${extracted} · يعمل ${playable}\n`);
  } catch (e) {
    row = [def.id, errorState(e?.message), 0, 0, String(e?.message ?? e).slice(0, 40)];
    console.log(`  ⇒ ${row[1]}: ${String(e?.message ?? e).slice(0, 90)}\n`);
  }
  summary.push(row);
}
console.log('| المصدر | الحالة | سيرفرات | تعمل | أعلى جودة |');
console.log('|---|---|---|---|---|');
for (const r of summary) console.log(`| ${r.join(' | ')} |`);
