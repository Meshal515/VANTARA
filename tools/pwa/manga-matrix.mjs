/**
 * مصفوفة المانجا الحيّة: كل مصدر كما يمرّ عليه القارئ، من هذه الآلة عبر curl
 * بنفس محركات الـPWA:
 *
 *   popular/latest ← بحث ← تفاصيل ← فصول ← صفحات أحدث فصل ← أول صورة (بايتات
 *   حقيقية بنوع صورة) ← صفحات الفصل التالي/السابق.
 *
 *   node tools/pwa/manga-matrix.mjs [--only=mangalek,teamx] [--query=solo] [--edge]
 *
 * `--edge`: كل طلب عبر جالب الويب الحقيقي والصورة عبر /v1/media فيه — ما يراه
 * متصفح الـPWA (يحتاج VANTARA_IDENTITY_SECRET، أي الـCI).
 *
 * كل خطوة بزمنها وسببها إن سقطت. لا يكتب شيئًا ولا يغيّر حالة مصدر.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { edgeFetcher } from './edge-fetcher.mjs';

useLinkedom();
const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const only = arg('only')?.split(',');
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const defs = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources
  .filter((d) => d.content === 'manga')
  .filter((d) => !only || only.includes(d.id.split('.').pop()));
const edge = process.argv.includes('--edge');
const fetch = edge ? await edgeFetcher() : liveFetcher();
const t = (p, ms = 30_000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms / 1000}s`)), ms))]);

/** عبر الجالب: الصورة كما يطلبها <img> في الـPWA (/v1/media بإذن في الرابط). */
async function edgeImage(url, referer) {
  try {
    await fetch.ensureGrant?.();
    const res = await globalThis.fetch(fetch.mediaUrl(url, referer), { headers: { range: 'bytes=0-15' }, signal: AbortSignal.timeout(20_000) });
    const b = new Uint8Array(await res.arrayBuffer()).slice(0, 4);
    const kind = b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0x52 && b[1] === 0x49 ? 'webp' : b[0] === 0x47 ? 'gif' : null;
    return { ok: res.ok && Boolean(kind), text: `${res.status} ${kind ?? 'ليست صورة'} (عبر الجالب)` };
  } catch (e) {
    return { ok: false, text: String(e?.message ?? e).slice(0, 60) };
  }
}

/** أول بايتات الصورة: نوعها الحقيقي من التوقيع، لا من الترويسة وحدها. */
function image(url, referer) {
  try {
    const out = execFileSync('curl', ['-s', '-L', '-m', '20', '-A', UA, ...(referer ? ['-H', `Referer: ${referer}`] : []), '-r', '0-15', '-D', '-', url]).toString('latin1');
    const status = [...out.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].pop()?.[1];
    const body = out.slice(out.lastIndexOf('\r\n\r\n') + 4);
    const kind = body.startsWith('\xff\xd8') ? 'jpeg' : body.startsWith('\x89PNG') ? 'png' : body.startsWith('RIFF') ? 'webp' : body.startsWith('GIF8') ? 'gif' : null;
    return { ok: /^20[06]$/.test(status ?? '') && Boolean(kind), text: `${status} ${kind ?? 'ليست صورة'}` };
  } catch (e) {
    return { ok: false, text: String(e?.message ?? e).slice(0, 60) };
  }
}

const rows = [];
for (const def of defs) {
  const id = def.id.split('.').pop();
  const row = { id, list: '-', search: '-', details: '-', chapters: '-', pages: '-', image: '-', next: '-', ms: 0 };
  const t0 = Date.now();
  const step = async (key, fn) => {
    const s = Date.now();
    try {
      const v = await t(fn());
      row[key] = `✓ ${v} (${Date.now() - s}ms)`;
      return true;
    } catch (e) {
      row[key] = `✗ ${String(e?.code ?? '')} ${String(e?.message ?? e).slice(0, 70)}`.trim();
      return false;
    }
  };
  const engine = ENGINES[def.engine].create(def, { fetch });
  let listed = [];
  let manga = null;
  let chapters = [];
  let pages = [];
  const ok =
    (await step('list', async () => {
      let res = await engine.popular(1).catch(() => null);
      if (!res?.mangas?.length) res = await engine.latest(1);
      listed = res.mangas ?? [];
      if (!listed.length) throw new Error('فاضية');
      return `${listed.length}`;
    })) &&
    (await step('search', async () => {
      const q = arg('query') ?? String(listed[0].title).split(/\s+/).find((w) => w.length > 3) ?? listed[0].title;
      const res = await engine.search(q, 1);
      const list = res.mangas ?? res;
      if (!list.length) throw new Error(`لا نتيجة لـ«${q}»`);
      return `${list.length} لـ«${q}»`;
    })) &&
    (await step('details', async () => {
      for (const m of listed.slice(0, 4)) {
        const out = await engine.series(m);
        if (out?.chapters?.length) {
          manga = out.manga ?? m;
          chapters = out.chapters;
          return `«${String(manga.title ?? m.title).slice(0, 30)}»`;
        }
      }
      throw new Error('أول 4 أعمال بلا فصول');
    })) &&
    (await step('chapters', async () => `${chapters.length}`)) &&
    (await step('pages', async () => {
      pages = await engine.pages(chapters[0]);
      if (!pages?.length) throw new Error('بلا صفحات');
      return `${pages.length}`;
    }));
  if (ok) {
    const ref = pages[0].headers?.Referer ?? pages[0].referer ?? `https://${def.domain}/`;
    const img = edge ? await edgeImage(pages[0].imageUrl, ref) : image(pages[0].imageUrl, ref);
    row.image = `${img.ok ? '✓' : '✗'} ${img.text}`;
    if (chapters.length > 1) await step('next', async () => `${(await engine.pages(chapters[1])).length} صفحة`);
  }
  row.ms = Date.now() - t0;
  rows.push(row);
  console.error(`${id.padEnd(18)} ${Object.entries(row).filter(([k]) => !['id', 'ms'].includes(k)).map(([k, v]) => `${k}:${String(v).slice(0, 2)}`).join(' ')} ${row.ms}ms`);
}

console.log('| المصدر | القائمة | البحث | التفاصيل | الفصول | الصفحات | الصورة | الفصل التالي |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} | ${r.list} | ${r.search} | ${r.details} | ${r.chapters} | ${r.pages} | ${r.image} | ${r.next} |`);
const full = rows.filter((r) => [r.list, r.search, r.details, r.pages, r.image].every((v) => String(v).startsWith('✓')));
console.log(`\nيعمل كاملًا: ${full.length}/${rows.length} — ${full.map((r) => r.id).join('، ')}`);
