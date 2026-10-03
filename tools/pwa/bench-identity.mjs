/**
 * قبل/بعد لمطابقة السينما على قائمة أعمال ثابتة، بنفس ردود المصادر للنسختين:
 *
 *   node tools/pwa/bench-identity.mjs [--base=<git-ref>] [--only=tt…]
 *
 * «قبل» = cinema-match.js ومصادر defs.json من `--base` (افتراضيًا origin/main) بالاسم
 * الذي كانت الصفحة تستعمله (اسم التفاصيل) والاستعلامات القديمة. «بعد» = الهوية
 * الجديدة وكل المصادر الحالية.
 * لكل عمل: هل وُجد (Discovery)، عدد السيرفرات، هل يعمل فعلًا (فحص أول
 * البايتات/قائمة HLS)، أعلى جودة تعمل، والوقت حتى أول تشغيل صالح. والمطابقة
 * الخاطئة (Self-Inflicted) تُحسب على أعمالٍ نعرف أن المصادر لا تحملها
 * (`expectNone`): أي نسخة تُطابق لها هي قفزة إلى عمل آخر بنفس الاسم.
 *
 * يعمل من هذه الآلة عبر curl: لا يقيس الـAPK على جهاز ولا الـPWA عبر الجالب.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { createHostResolver } from '../../apps/web/pwa/sources/hosts.js';
import { detail, search } from '../../apps/web/lib/cinema-meta.js';
import { matchCriteria, mergeWork } from '../../apps/web/lib/cinema-identity.js';
import { pickCopies, queriesFor } from '../../apps/web/lib/cinema-match.js';

useLinkedom();
const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const base = arg('base', 'origin/main');
const only = arg('only');
const legacyPath = join(tmpdir(), `cinema-match-${base.replace(/\W/g, '_')}.mjs`);
writeFileSync(legacyPath, execFileSync('git', ['show', `${base}:apps/web/lib/cinema-match.js`]));
const legacy = await import(pathToFileURL(legacyPath).href);

const CORPUS = [
  // [النوع، المعرّف، الموسم، الحلقة، لا تحمله المصادر العربية؟]
  ['series', 'tt1586680', 1, 1], // Shameless 2011
  ['series', 'tt1586680', 9, 1],
  ['series', 'tt0377260', 1, 1, true], // Shameless UK 2004
  ['series', 'tt4393622', 1, 1, true], // Besstydniki 2017
  ['movie', 'tt1927068', null, -1, true], // Shameless 2012 (Bez wstydu)
  ['movie', 'tt1711487', null, -1, true], // Shameless 2010
  ['series', 'tt0386676', 1, 1], // The Office US
  ['series', 'tt0903747', 1, 1], // Breaking Bad
  ['series', 'tt0944947', 1, 1], // Game of Thrones
  ['series', 'tt1856010', 1, 1], // House of Cards 2013
  ['series', 'tt0098825', 1, 1, true], // House of Cards 1990
  ['series', 'tt4574334', 1, 1], // Stranger Things
  ['series', 'tt5753856', 1, 1], // Dark
  ['series', 'tt7366338', 1, 1], // Chernobyl
  ['movie', 'tt1160419', null, -1], // Dune: Part One
  ['movie', 'tt15239678', null, -1], // Dune: Part Two
  ['movie', 'tt0087182', null, -1], // Dune 1984
  ['movie', 'tt9362722', null, -1], // Spider-Man: Across the Spider-Verse
  ['movie', 'tt0468569', null, -1], // The Dark Knight
  ['movie', 'tt1375666', null, -1], // Inception
  ['movie', 'tt15398776', null, -1], // Oppenheimer
  ['movie', 'tt1877830', null, -1], // The Batman
  ['movie', 'tt0816692', null, -1], // Interstellar
];

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const curlFetch = async (url) => {
  const body = execFileSync('curl', ['-sL', '-m', '30', '-A', UA, url]).toString();
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
const t = (p, ms = 30_000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms}`)), ms))]);

function probe(s) {
  const ref = s.referer ? ['-H', `Referer: ${s.referer}`] : [];
  try {
    if (s.type === 'hls') {
      const body = execFileSync('curl', ['-s', '-L', '-m', '20', '-A', UA, ...ref, s.url]).toString().slice(0, 4000);
      if (!body.startsWith('#EXTM3U')) return 0;
      const res = [...body.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => Number(m[1]));
      return res.length ? Math.max(...res) : s.quality ?? 1;
    }
    const out = execFileSync('curl', ['-s', '-L', '-m', '20', '-A', UA, ...ref, '-r', '0-4095', '-D', '-', '-o', '/dev/null', s.url]).toString();
    const status = [...out.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].pop()?.[1];
    const ctype = [...out.matchAll(/^content-type:\s*(\S+)/gim)].pop()?.[1] ?? '';
    return /^20[06]$/.test(status ?? '') && /video|octet-stream|mp4/i.test(ctype) ? s.quality ?? 1 : 0;
  } catch {
    return 0;
  }
}

const defs = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources.filter((d) => d.content === 'cinema');
// «قبل» بمصادر الأساس وحدها: مصدر جديد يُحسب في «بعد» فقط
const baseIds = new Set(
  (() => {
    try {
      return JSON.parse(execFileSync('git', ['show', `${base}:apps/web/pwa/sources/defs.json`]).toString()).sources.map((d) => d.id);
    } catch {
      return defs.map((d) => d.id);
    }
  })(),
);
const fetch = liveFetcher();
const engines = Object.fromEntries(defs.map((def) => [def.id, ENGINES[def.engine].create(def, { fetch, hosts: createHostResolver(fetch) })]));
const searchCache = new Map();
const playCache = new Map();
const stats = { searches: 0, challenged: 0 };

async function searchOnce(sourceId, q) {
  const k = `${sourceId}|${q}`;
  if (!searchCache.has(k)) {
    stats.searches++;
    searchCache.set(k, t(engines[sourceId].search(q), 25_000).then((items) => items.map((it) => ({ ...it, sourceId }))).catch((e) => {
      if (/challenge|cloudflare|403/i.test(String(e?.message ?? e?.code))) stats.challenged++;
      return null;
    }));
  }
  return searchCache.get(k);
}

/** نسخة → {servers, best} (مرة لكل نسخة، مشتركة بين النسختين). */
async function playOnce(copy, episode) {
  const k = `${copy.sourceId}|${copy.url}|${episode}`;
  if (!playCache.has(k)) {
    playCache.set(k, (async () => {
      const e = engines[copy.sourceId];
      const t0 = Date.now();
      try {
        const eps = await t(e.episodes(copy));
        const ep = episode < 0 ? eps[0] : eps.find((x) => Number(x.number) === episode) ?? (eps.length === 1 && episode === 1 ? eps[0] : null);
        if (!ep) return { servers: 0, best: 0, ttfp: null };
        const servers = await t(e.servers(ep));
        let best = 0;
        let ttfp = null;
        for (const sv of servers.filter((x) => !x.unsupported)) {
          const streams = await t(e.streams(sv), 25_000).catch(() => []);
          const q = streams?.length ? probe(streams[0]) : 0;
          if (q && ttfp == null) ttfp = Date.now() - t0;
          best = Math.max(best, q);
        }
        return { servers: servers.length, best, ttfp };
      } catch {
        return { servers: 0, best: 0, ttfp: null };
      }
    })());
  }
  return playCache.get(k);
}

/** نسخة كل مصدر لعمل بنسخة مطابقة ما (قبل/بعد): الاستعلامات بالترتيب حتى أول مطابقة. */
async function locate(queries, match, only = null) {
  const out = [];
  for (const def of defs.filter((d) => !only || only.has(d.id))) {
    for (const q of queries) {
      const items = await searchOnce(def.id, q);
      const hit = items ? match(items) : [];
      if (hit.length) {
        out.push(hit[0]);
        break;
      }
    }
  }
  return out;
}

const rows = [];
for (const [type, id, season, episode, expectNone] of CORPUS) {
  if (only && !only.split(',').includes(id)) continue;
  const full = await detail(type, id, { fetchImpl: curlFetch }).catch(() => null);
  if (!full) continue;
  const byName = await search(full.title, { fetchImpl: curlFetch }).catch(() => []);
  const card = byName.find((r) => r.id === id) ?? (await search(id, { fetchImpl: curlFetch }).catch(() => [])).find((r) => r.id === id) ?? { id, type };
  const work = mergeWork(card, full);
  // إخوة الاسم بكل أسماء العمل، كما في التطبيق (peersOf)
  const lists = await Promise.all([...new Set([work.title, ...(work.aliases ?? [])].slice(0, 3))].map((n) => search(n, { fetchImpl: curlFetch }).catch(() => [])));
  const peers = [...new Map(lists.flat().map((r) => [r.id, r])).values()];
  const label = `${work.title} ${work.year}${season ? ` S${season}E${episode}` : ''}`;
  // قبل: اسم التفاصيل كما كانت الصفحة تستعمله، ومعايير الاسم/السنة/الموسم فقط
  const oldCrit = { title: full.title, year: full.year, type, season };
  const before = await locate(legacy.queriesFor(full.title), (items) => legacy.pickCopies(items, oldCrit), baseIds);
  // بعد: الهوية وإخوة الاسم والأسماء البديلة واستعلام الموسم
  const crit = matchCriteria(work, { season, results: peers });
  const after = await locate(queriesFor(crit.title, crit), (items) => pickCopies(items, crit));
  const measure = async (copies) => {
    // بالتتابع: curl متزامن يوقف المؤقتات، والتوازي يصنع مهلًا كاذبة
    const plays = [];
    for (const c of copies) plays.push(await playOnce(c, episode));
    const ttfps = plays.map((p) => p.ttfp).filter((x) => x != null);
    return {
      found: copies.length > 0,
      wrong: Boolean(expectNone && copies.length),
      servers: plays.reduce((n, p) => n + p.servers, 0),
      best: Math.max(0, ...plays.map((p) => p.best)),
      ttfp: ttfps.length ? Math.min(...ttfps) : null,
      titles: copies.map((c) => `${c.sourceId}:${c.title}`),
    };
  };
  const row = { label, id, expectNone: Boolean(expectNone), before: await measure(before), after: await measure(after) };
  rows.push(row);
  const f = (m) => (m.found ? `${m.wrong ? '✗خطأ ' : ''}${m.servers}srv ${m.best ? `${m.best}p` : 'لا يعمل'}` : '—');
  console.error(`${label.padEnd(36)} قبل: ${f(row.before).padEnd(16)} بعد: ${f(row.after)}  ${row.after.titles.join(' | ')}`);
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? `${(v[Math.floor(v.length / 2)] / 1000).toFixed(1)}s` : '—';
};
const real = rows.filter((r) => !r.expectNone);
const sum = (k) => {
  const found = real.filter((r) => r[k].found);
  return {
    discovery: pct(found.length, real.length),
    zero: pct(found.filter((r) => !r[k].servers).length, found.length),
    playable: pct(real.filter((r) => r[k].best).length, real.length),
    p1080: pct(real.filter((r) => r[k].best >= 1080).length, real.length),
    ttfp: median(real.map((r) => r[k].ttfp)),
    wrong: pct(rows.filter((r) => r[k].wrong).length, rows.filter((r) => r.expectNone).length),
  };
};
const b = sum('before');
const a = sum('after');
console.log(`\nأعمال: ${real.length} موجودة + ${rows.length - real.length} لا تحملها المصادر · بحث: ${stats.searches} · حماية/403: ${pct(stats.challenged, stats.searches)}\n`);
console.log('| المقياس | قبل | بعد |');
console.log('|---|---|---|');
for (const [k, name] of [['discovery', 'Discovery'], ['zero', 'Zero Server (من الموجود)'], ['playable', 'Playable Rate'], ['p1080', '1080p Rate'], ['ttfp', 'Time To First Playable (وسيط)'], ['wrong', 'Self-Inflicted (مطابقة لعمل آخر)']]) console.log(`| ${name} | ${b[k]} | ${a[k]} |`);
console.log(`| Verification Rate (من هذه الآلة) | ${pct(stats.challenged, stats.searches)} | ${pct(stats.challenged, stats.searches)} |`);
