/**
 * مصفوفة المصادر الحيّة: كل تعريف في `apps/web/pwa/sources/defs.json` يمرّ
 * بالمسار الحقيقي كاملًا على الموقع نفسه، ويُقاس زمن كل خطوة.
 *
 *   مانجا:        بحث ← تفاصيل ← فصول ← صفحات ← تنزيل أول صورة فعلًا
 *   أنمي/سينما:   بحث ← حلقات ← سيرفرات ← رابط بث ← قائمة HLS أو أول بايتات MP4 فعلًا
 *
 * المصدر لا يُعدّ «يعمل» إلا إذا وصل لآخر خطوة. الطلب من هذه الآلة (curl)
 * لا من Cloudflare: مصدر يحجب IP الخوادم قد يختلف في الـWorker الحقيقي
 * (`/health/hosts` في سير النشر يقيس ذلك من هناك).
 *
 *   node tools/pwa/source-matrix.mjs                 كل المصادر
 *   node tools/pwa/source-matrix.mjs manga           قسم واحد
 *   node tools/pwa/source-matrix.mjs teamx,azora     مصادر بعينها (جزء من المعرّف)
 *   … --json out.json                                النتائج كاملة لملف
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { createHostResolver } from '../../apps/web/pwa/sources/hosts.js';
import { checkListing, checkPages, checkSeries } from '../../apps/web/pwa/sources/contract.js';

useLinkedom();
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const STEP_MS = 45_000;

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const filter = args.find((a) => !a.startsWith('--') && a !== jsonOut);
const defs = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources.filter((d) => {
  if (!filter) return true;
  if (['manga', 'anime', 'cinema'].includes(filter)) return d.content === filter;
  return filter.split(',').some((f) => d.id.includes(f) || d.label.toLowerCase().includes(f.toLowerCase()));
});

const withTimeout = (p, ms = STEP_MS) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`مهلة ${ms / 1000}ث`)), ms))]);

/**
 * أول بايتات الملف فعلًا: الحالة والنوع وحجم ما وصل. بعض الخوادم تتجاهل
 * Range وتبدأ الملف كاملًا، فيُقطع الأنبوب بعد أول 4KB بدل انتظار 300MB.
 */
function headBytes(url, referer) {
  const ref = referer ? `-H ${JSON.stringify(`Referer: ${referer}`)}` : '';
  const out = execFileSync('sh', ['-c', `curl -s -L -m 25 -A ${JSON.stringify(UA)} ${ref} -r 0-4095 -D - -o - ${JSON.stringify(url)} | head -c 12000 | tr -d '\\000' ; true`], { maxBuffer: 1 << 20 }).toString('latin1');
  const blocks = out.split(/\r?\n\r?\n/);
  let status = 0;
  let type = '';
  let i = 0;
  while (i < blocks.length && /^HTTP\/[\d.]+ \d+/.test(blocks[i])) {
    status = Number(blocks[i].match(/^HTTP\/[\d.]+ (\d+)/)[1]);
    type = blocks[i].match(/^content-type:\s*([^\r\n;]+)/im)?.[1] ?? type;
    i += 1;
  }
  const size = blocks.slice(i).join('\n\n').length;
  return { status, type, size };
}
function playlist(url, referer) {
  return execFileSync('curl', ['-s', '-L', '-m', '25', '-A', UA, ...(referer ? ['-H', `Referer: ${referer}`] : []), url]).toString().slice(0, 4000);
}

async function step(row, name, fn) {
  const t = Date.now();
  try {
    const value = await withTimeout(fn());
    row.steps[name] = { ok: true, ms: Date.now() - t };
    return value;
  } catch (error) {
    row.steps[name] = { ok: false, ms: Date.now() - t, error: String(error?.code ?? '') + ' ' + String(error?.message ?? error).slice(0, 140) };
    throw error;
  }
}

async function mangaPath(def, engine, row) {
  const query = def.probe?.query ?? 'solo';
  const found = await step(row, 'search', async () => {
    const out = checkListing(await engine.search(query, 1));
    if (!out.mangas.length) throw new Error(`لا نتائج لـ «${query}»`);
    return out.mangas;
  });
  row.sample = found[0].title;
  const { chapters } = await step(row, 'details', async () => checkSeries(await engine.series(found[0])));
  row.count = chapters.length;
  await step(row, 'content', async () => {
    if (!chapters.length) throw new Error('بلا فصول');
  });
  const chapter = chapters[chapters.length - 1];
  const pages = await step(row, 'pages', async () => {
    const list = checkPages(await engine.pages(chapter));
    if (!list.length) throw new Error('فصل بلا صفحات');
    return list;
  });
  await step(row, 'media', async () => {
    const referer = engine.imageReferer?.(pages[0]) ?? `https://${def.domain}/`;
    const r = headBytes(pages[0].imageUrl, referer);
    if (!(r.status === 200 || r.status === 206) || !/^image\//.test(r.type) || r.size < 200) throw new Error(`الصورة ${r.status} ${r.type}`);
    row.detail = `${pages.length} صفحة`;
  });
}

async function videoPath(def, engine, row) {
  const query = def.probe?.query ?? (def.content === 'anime' ? 'one piece' : 'spider');
  const items = await step(row, 'search', async () => {
    const list = await engine.search(query);
    if (!list?.length) throw new Error(`لا نتائج لـ «${query}»`);
    return list;
  });
  row.sample = items[0].title;
  const episodes = await step(row, 'details', async () => {
    const list = await engine.episodes(items[0]);
    if (!list?.length) throw new Error('بلا حلقات');
    return list;
  });
  row.count = episodes.length;
  const servers = await step(row, 'content', async () => {
    const list = await engine.servers(episodes[0]);
    if (!list?.length) throw new Error('بلا سيرفرات');
    return list;
  });
  row.servers = servers.length;
  const picked = await step(row, 'pages', async () => {
    const tried = [];
    for (const server of servers.slice(0, 8)) {
      try {
        const streams = await withTimeout(engine.streams(server), 20_000);
        if (streams?.length) return { server, streams };
        tried.push(`${server.name}: فارغ`);
      } catch (error) {
        tried.push(`${server.name}: ${String(error?.message ?? error).slice(0, 40)}`);
      }
    }
    throw new Error(`لا سيرفر أعطى رابطًا (${tried.join(' | ')})`);
  });
  await step(row, 'media', async () => {
    const s = picked.streams[0];
    if (s.type === 'hls') {
      const text = playlist(s.url, s.referer);
      if (!text.startsWith('#EXTM3U')) throw new Error('قائمة HLS غير صالحة');
    } else {
      const r = headBytes(s.url, s.referer);
      if (!(r.status === 200 || r.status === 206) || r.size < 500) throw new Error(`MP4 ${r.status} ${r.type}`);
    }
    row.detail = `${picked.server.name} → ${s.type}${s.quality ? ` ${s.quality}p` : ''}`;
  });
}

const fetch = liveFetcher();
const hosts = createHostResolver(fetch);
const rows = [];
for (const def of defs) {
  const row = { section: def.content, id: def.id, label: def.label, engine: def.engine, steps: {}, started: Date.now() };
  rows.push(row);
  const factory = ENGINES[def.engine];
  try {
    if (!factory) throw new Error(`محرك غير مسجّل: ${def.engine}`);
    const engine = factory.create(def, { fetch, hosts });
    await (def.content === 'manga' ? mangaPath(def, engine, row) : videoPath(def, engine, row));
    row.ok = true;
  } catch (error) {
    row.ok = false;
    row.error = String(error?.message ?? error).slice(0, 160);
  }
  row.total = Date.now() - row.started;
  const mark = (k) => (row.steps[k] ? (row.steps[k].ok ? `✓ ${(row.steps[k].ms / 1000).toFixed(1)}s` : '✗') : '—');
  console.error(`${row.ok ? 'OK ' : 'XX '} ${def.content.padEnd(6)} ${def.label.padEnd(22)} ${['search', 'details', 'content', 'pages', 'media'].map(mark).join(' · ')}  ${row.ok ? row.detail ?? '' : row.error}`);
}

const cell = (r, k) => (r.steps[k] ? (r.steps[k].ok ? '✓' : '✗') : '—');
console.log('\n| Section | Source | Engine | Search | Details | Content | Playback/Pages | Latency | Stable? |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const media = r.steps.media?.ok ? `✓ ${r.detail}` : cell(r, 'pages') === '✓' ? '✗ (رابط لا يعمل)' : cell(r, 'pages');
  console.log(`| ${r.section} | ${r.label} | ${r.engine} | ${cell(r, 'search')} | ${cell(r, 'details')} | ${cell(r, 'content')}${r.count ? ` ${r.count}` : ''} | ${media} | ${(r.total / 1000).toFixed(1)}s | ${r.ok ? 'نعم' : `لا — ${r.error}`} |`);
}
const by = (s) => rows.filter((r) => r.section === s);
for (const s of ['manga', 'anime', 'cinema']) if (by(s).length) console.log(`\n${s}: ${by(s).filter((r) => r.ok).length}/${by(s).length} تعمل للنهاية`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
