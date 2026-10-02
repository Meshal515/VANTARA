/**
 * تتبّع «من الحافة»: نفس محركات الـPWA، لكن كل طلب يمرّ من جالب الويب الحقيقي
 * على Cloudflare (بتوكن هوية مؤقت يُصكّ هنا من سرّ النشر) — أي ما يراه متصفح
 * الـPWA بالضبط. ولكل رابط فيديو نفحصه بطريقين مستقلين:
 *
 *   edge    عبر /v1/media في الجالب (مثل فحص الواجهة «لم ينجح فحص رابط الفيديو»)
 *   direct  من هذه الآلة مباشرة بمرجعه (مثل تجربة المتصفح الأولى)
 *
 * فيظهر بالضبط أين ينكسر الطريق: البحث، السيرفرات، الاستخراج، أو التشغيل.
 *
 *   VANTARA_IDENTITY_SECRET=… node tools/pwa/edge-trace.mjs [tools/pwa/edge-cases.json]
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { mintIdentityToken } from '../../packages/domain/dist/index.js';
import { createFetcher } from '../../apps/web/pwa/net/fetcher.js';
import { useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { createHostResolver } from '../../apps/web/pwa/sources/hosts.js';

useLinkedom();
const BASE = process.env.FETCH_BASE ?? 'https://vantara-fetch.ngm-309.workers.dev';
const secret = process.env.VANTARA_IDENTITY_SECRET;
if (!secret) throw new Error('VANTARA_IDENTITY_SECRET مطلوب');
const casesFile = process.argv[2] ?? new URL('./edge-cases.json', import.meta.url);
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const defs = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources;

let token = await mintIdentityToken({ userId: '00000000-0000-4000-8000-0000000ed9e0', deviceId: 'edge-trace' }, secret);
const memory = new Map();
const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
const fetcher = createFetcher({
  auth: { header: () => `Bearer ${token}`, refresh: async () => { token = await mintIdentityToken({ userId: '00000000-0000-4000-8000-0000000ed9e0', deviceId: 'edge-trace' }, secret); } },
  base: () => BASE,
  storage,
});
const hosts = createHostResolver(fetcher);
const t = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`مهلة ${ms / 1000}ث`)), ms))]);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

async function check(url, init) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // الترويسات وحدها تكفي للحكم (كفحص الواجهة): خوادم كثيرة تتجاهل Range وتبدأ ملفًا بالجيجات
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    const size = res.headers.get('content-range')?.split('/')[1] ?? res.headers.get('content-length') ?? '';
    let isHls = false;
    if (/mpegurl|text\/plain|octet/i.test(type) && Number(size || 0) < 2_000_000) {
      const reader = res.body?.getReader();
      const first = reader ? await reader.read() : null;
      isHls = Boolean(first?.value && new TextDecoder().decode(first.value.slice(0, 16)).startsWith('#EXTM3U'));
      reader?.cancel().catch(() => {});
    } else {
      res.body?.cancel().catch(() => {});
    }
    const ok = res.ok && (isHls || /video|mpegurl|octet-stream|mp2t/i.test(type));
    return `${ok ? '✓' : '✗'} ${res.status} ${type.split(';')[0]}${size ? ` ${(Number(size) / 1e6).toFixed(0)}MB` : ''} ${Date.now() - started}ms`;
  } catch (e) {
    return `✗ ${String(e?.cause?.code ?? e?.name ?? e?.message ?? e).slice(0, 30)} ${Date.now() - started}ms`;
  } finally {
    clearTimeout(timer);
  }
}

const out = [];
const log = (line) => { console.log(line); out.push(line); };
await fetcher.ensureGrant?.().catch((e) => log(`إذن الوسائط فشل: ${e.message}`));

for (const c of cases) {
  const def = defs.find((d) => d.id === c.source);
  log(`\n### ${c.source} · «${c.query}» · ${c.episode ?? 'فيلم/أول حلقة'}`);
  if (!def) { log('- تعريف غير موجود'); continue; }
  const engine = ENGINES[def.engine].create(def, { fetch: fetcher, hosts });
  try {
    const items = await t(engine.search(c.query), 45_000);
    log(`- بحث: ${items.length} ← ${items.slice(0, 3).map((i) => i.title).join(' | ')}`);
    const item = c.pick ? items.find((i) => i.title.toLowerCase().includes(c.pick.toLowerCase())) ?? items[0] : items[0];
    const eps = await t(engine.episodes(item), 45_000);
    const ep = c.episode ? eps.find((e) => Number(e.number) === Number(c.episode)) : eps[0];
    log(`- حلقات: ${eps.length}${ep ? '' : ' (الحلقة المطلوبة غير موجودة)'}`);
    if (!ep) continue;
    const servers = await t(engine.servers(ep), 45_000);
    log(`- سيرفرات: ${servers.length}`);
    log('| السيرفر | الجودة | الاستخراج | عبر الجالب | مباشر |');
    log('|---|---|---|---|---|');
    for (const sv of servers) {
      if (sv.unsupported) { log(`| ${sv.name} | ${sv.quality ?? ''} | غير مدعوم | | |`); continue; }
      const started = Date.now();
      try {
        const streams = await t(engine.streams(sv), 30_000);
        if (!streams?.length) { log(`| ${sv.name} | ${sv.quality ?? ''} | فارغ ${Date.now() - started}ms | | |`); continue; }
        const s = streams[0];
        const edge = await check(fetcher.mediaUrl(s.url, s.referer), { headers: { range: 'bytes=0-1' } });
        const direct = await check(s.url, { headers: { range: 'bytes=0-1', 'user-agent': UA, ...(s.referer ? { referer: s.referer } : {}) } });
        log(`| ${sv.name} | ${s.quality ?? sv.quality ?? ''} | ${s.type} ${new URL(s.url).hostname} ${Date.now() - started}ms | ${edge} | ${direct} |`);
      } catch (e) {
        log(`| ${sv.name} | ${sv.quality ?? ''} | ✗ ${String(e?.code ?? '')} ${e?.host ? `[${e.host}] ` : ''}${String(e?.message ?? e).slice(0, 70).replace(/\|/g, '/')} | | |`);
      }
    }
  } catch (e) {
    log(`- ✗ ${String(e?.code ?? '')} ${String(e?.message ?? e).slice(0, 160)}`);
  }
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## تتبّع الحافة\n${out.join('\n')}\n`);
