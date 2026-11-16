// حالتا صف التحميل الجديدتان في القشرة الحقيقية (Chromium، بيانات AniList حيّة): «يجهّز المصدر» بطوره
// («نبحث في المصادر» ثم «سيرفر جاهز»)، ثم فشل من الجهاز بسببه الفعلي (HTTP 404) تحت الحالة.
// المحرك والجهاز بديلان (__VANTARA_QA_DOWNLOADS__)؛ لا يثبت سلوك APK.
// node tools/ui-qa/downloads-states.mjs <outDir>
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch, sleep } from './rig.mjs';

const out = process.argv[2] ?? 'downloads-states';
await mkdir(out, { recursive: true });

const QA_INIT = () => {
  const listeners = new Set();
  const jobs = new Map();
  const emit = (e) => listeners.forEach((fn) => fn(e));
  let readyAt = 0;
  const route = (state) => ({ id: 'r1', sourceId: 'qa-source', sourceName: 'AnimeRift', server: 'AnimeRift', code: 'NMR', quality: 1080, state, probed: state === 'READY' ? true : null, probeMs: 420 });
  window.__VANTARA_QA_DOWNLOADS__ = {
    native: {
      capabilities: async () => ({ video: true, torrent: false, freeBytes: 23.4 * 1024 ** 3 }),
      network: async () => ({ online: true, metered: false }),
      inspect: async () => ({ container: 'MP4', transport: 'http', size: 400 * 1024 ** 2, resumable: true }),
      status: async ({ id }) => jobs.get(id) ?? { exists: false },
      start: async ({ id }) => {
        // الجهاز يرفض فورًا: ملف غير موجود عند المصدر
        const end = { id, state: 'failed', code: 'SOURCE', message: 'HTTP 404' };
        jobs.set(id, { exists: true, ...end });
        setTimeout(() => emit(end), 200);
        return { started: true };
      },
      pause: async () => {}, cancel: async () => {}, remove: async () => ({ freed: 0 }),
      addListener: async (name, fn) => { if (name === 'progress') listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
    },
    engine: {
      prepare: async ({ session }) => { readyAt = Date.now() + 3000; return { session, routes: [route('RESOLVING')], done: false }; },
      routes: async () => ({ routes: [route(Date.now() >= readyAt ? 'READY' : 'RESOLVING')], done: Date.now() >= readyAt + 9000 }),
      pick: async () => 'c1', on: () => () => {}, closeSession: async () => {},
      upsertRoute: (l, r) => [...l.filter((x) => x.id !== r.id), r],
    },
  };
};

const rig = await launch({
  section: 'anime', net: 'live', scale: 2, init: QA_INIT,
  rewrites: { '/v35/anime.js': [["const copiesOf = async () => (await locateWork(m))?.copies ?? [];", "const copiesOf = async () => [{ sourceId: 'qa-source', title: m.title }];"]] },
});
const { page } = rig;
const js = (fn, arg) => page.evaluate(fn, arg);
await js(() => window.__shell.openAnimeRef('anime:154587', { title: "Frieren: Beyond Journey's End" }));
await page.waitForSelector('#anime.active .aw-tools [aria-haspopup]', { timeout: 30000 });
await page.locator('#anime.active .aw-tools [aria-haspopup]').first().click();
await sleep(700);
await page.locator('#anime.active .aw-menu.open .aw-menu-item').first().click();
await page.waitForSelector('.dl-start');
await page.locator('.dl-start-go').click();
await page.waitForSelector('.dl-start', { state: 'detached' });
await js(() => document.querySelector('[data-act="navTo"][data-arg="library"]')?.click());
await page.waitForSelector('#library.active');
await page.locator('#library.active [data-act="openDownloads"]').first().click();
await page.waitForSelector('#downloads.active .dl-row');
await page.waitForFunction(() => /نبحث في المصادر|يُفحص/.test(document.querySelector('.dl-stage')?.textContent ?? ''), null, { timeout: 8000 });
await page.screenshot({ path: `${out}/1-resolving-searching.png` });
await page.waitForFunction(() => /سيرفر جاهز/.test(document.querySelector('.dl-stage')?.textContent ?? ''), null, { timeout: 12000 });
await page.screenshot({ path: `${out}/2-resolving-ready.png` });
await page.waitForFunction(() => document.querySelector('.dl-why'), null, { timeout: 30000 });
const why = await js(() => document.querySelector('.dl-why').textContent);
assert.match(why, /الملف غير موجود عند المصدر · \u2066HTTP\u00a0404\u2069/);
await page.screenshot({ path: `${out}/3-failed-reason.png` });
console.log('✓ stage + reason:', why);
await rig.close?.();
process.exit(0);
