// لقطات Playwright للتحميلات داخل القشرة الحقيقية، ببيانات حقيقية (AniList وCinemeta حيّة) وحساب مسجّل:
// ⋮ ← «تحميل» ← الورقة ← «جاري التحميل» ← ⓘ ← الإعدادات ← «على الجهاز» ← صفحة العمل الأصلية بالمحمّل وحده،
// للأنمي والسينما والمانجا، ثم بلا إنترنت، ثم مقاس الكمبيوتر.
// حدود صريحة: نقل البايتات في المتصفح بديل لمحرك Android (__VANTARA_QA_DOWNLOADS__)، ونسخ المصادر بديلة
// (لا مصادر في المتصفح)، والمانجا بيانات مولّدة بصفحات JPEG حقيقية. التنزيل الحقيقي مثبت في رحلة المحاكي.
// node tools/ui-qa/downloads-shots.mjs <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { boot, launch, sleep } from './rig.mjs';

const out = process.argv[2] ?? 'downloads-shots';
await mkdir(out, { recursive: true });
const report = [];
let n = 0;

const QA_INIT = () => {
  const listeners = new Set();
  const jobs = new Map();
  let started = 0;
  const emit = (e) => listeners.forEach((fn) => fn(e));
  const native = {
    capabilities: async () => ({ video: true, torrent: false, freeBytes: 23.4 * 1024 ** 3, location: 'Android/data/com.vantara.app/files/VANTARA/Downloads' }),
    network: async () => ({ online: true, metered: false }),
    inspect: async () => ({ container: 'MKV', transport: 'http', size: null, resumable: true, quality: 1080, codec: 'avc1.640028', audio: ['ja', 'en'], subtitles: ['ar', 'en'] }),
    start: async ({ id }) => {
      // أول عنصرين يكتملان سريعًا (يظهران «على الجهاز»)، وما بعدهما يبقى جاريًا بسرعة واقعية
      const fast = started++ % 4 < 2 || window.__qaAllFast;
      const total = fast ? 362 * 1024 ** 2 : 1.4 * 1024 ** 3;
      const rate = fast ? 90 * 1024 ** 2 : 8.2 * 1024 ** 2;
      const job = { bytes: jobs.get(id)?.bytes ?? 0, total, timer: null };
      jobs.set(id, job);
      job.timer = setInterval(() => {
        job.bytes = Math.min(total, job.bytes + (rate / 4) * (0.92 + Math.random() * 0.16));
        if (job.bytes >= total) {
          clearInterval(job.timer);
          emit({ id, state: 'verifying', bytes: total });
          setTimeout(() => emit({ id, state: 'ready', bytes: total, verified: true, path: `/storage/emulated/0/Android/data/com.vantara.app/files/VANTARA/Downloads/${id}/video.mkv`, location: 'Android/data/com.vantara.app/files/VANTARA/Downloads', media: { container: 'MKV', subtitles: [{ lang: 'ar', saved: true }, { lang: 'en', saved: true }], audio: [] } }), 400);
        } else emit({ id, state: 'downloading', bytes: job.bytes, total });
      }, 250);
      return { started: true };
    },
    pause: async ({ id }) => clearInterval(jobs.get(id)?.timer),
    cancel: async ({ id }) => { clearInterval(jobs.get(id)?.timer); jobs.delete(id); },
    remove: async ({ id }) => { jobs.delete(id); return { freed: 0 }; },
    play: async (a) => { window.__qaPlayed = a; },
    addListener: async (name, fn) => { if (name === 'progress') listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  const engine = {
    prepare: async () => ({ session: 'qa', routes: [{ id: 'r1', sourceId: 'qa-source', sourceName: 'AnimeRift', server: 'AnimeRift', code: 'NMR', quality: 1080, state: 'READY', probed: true, probeMs: 420 }], done: true }),
    routes: async () => ({ routes: [], done: true }),
    pick: async () => 'c1',
    on: () => () => {},
    upsertRoute: (l, r) => [...l.filter((x) => x.id !== r.id), r],
    closeSession: async () => {},
  };
  window.__VANTARA_QA_DOWNLOADS__ = { native, engine };
};

const QA_COPIES = (name) => `if (globalThis.__VANTARA_QA_DOWNLOADS__) return ${name}`;
const rig = await launch({
  section: 'anime', net: 'live', scale: 2, init: QA_INIT,
  rewrites: {
    '/v35/anime.js': [["const copiesOf = async () => (await locateWork(m))?.copies ?? [];", `const copiesOf = async () => { ${QA_COPIES("[{ sourceId: 'qa-source', title: m.title }, { sourceId: 'qa-source-2', title: m.title }]")}; return (await locateWork(m))?.copies ?? []; };`]],
    '/v35/cinema.js': [["const copiesFor = async (season) => {", `const copiesFor = async (season) => { ${QA_COPIES("{ copies: [{ sourceId: 'arabseed', title: m.title }, { sourceId: 'akwam', title: m.title }], pinned: false }")};`]],
  },
});
const { page, context, log } = rig;

const shot = async (name, note) => {
  await sleep(450);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${out}/${file}` });
  report.push({ file, note });
  console.log('📸', file);
};
const step = async (name, fn) => {
  try { await fn(); } catch (e) { report.push({ step: name, error: String(e?.message ?? e).slice(0, 400) }); console.log('✗', name, e?.message); try { await shot(`fail-${name}`); } catch {} }
};
const js = (fn, arg) => page.evaluate(fn, arg);
const tap = (sel) => page.locator(sel).first().click();
const closeSheet = async () => { await page.keyboard.press('Escape'); await js(() => document.querySelector('.sheet-backdrop.show')?.click()); await sleep(350); };
const menuOpen = async (page0, tools) => { await tap(`${page0} ${tools} [aria-haspopup]`); await sleep(700); };
const goDownloads = async () => {
  await js(() => document.querySelector('[data-act="navTo"][data-arg="library"]')?.click());
  await page.waitForSelector('#library.active');
  await tap('#library.active [data-act="openDownloads"]');
  await page.waitForSelector('#downloads.active');
};
const tab = (name) => page.getByRole('tab', { name: new RegExp(name) }).click();

// صفحات JPEG حقيقية للمانجا
const jpeg = async (hue, label) => {
  const p = await context.newPage();
  await p.setContent(`<body style="margin:0"><div id=x style="width:360px;height:520px;background:hsl(${hue} 35% 22%);display:grid;place-items:center;font:700 48px sans-serif;color:#fff">${label}</div></body>`);
  const b = await p.locator('#x').screenshot({ type: 'jpeg', quality: 70 });
  await p.close();
  return b;
};
const pages = {};
for (let c = 1; c <= 6; c++) for (let i = 0; i < 4; i++) pages[`${c}-${i}`] = await jpeg(c * 50, `${c} · ${i + 1}`);
await page.route('https://pages.fixture/**', (route) => route.fulfill({ contentType: 'image/jpeg', body: pages[new URL(route.request().url()).pathname.slice(1).replace('.jpg', '')] }));
await js(() => {
  window.VantaraWeb = { ...(window.VantaraWeb ?? {}), ExtensionEngine: {
    pages: async ({ chapter }) => ({ pages: Array.from({ length: 4 }, (_, i) => ({ index: i, url: `https://pages.fixture/${chapter.url.split('/').pop()}-${i}.jpg` })) }),
    image: async ({ page: p }) => ({ path: p.url, dataUrl: null }),
    sources: async () => ({ sources: [] }),
  } };
});

// ───────────── الأنمي (AniList حيّ): Frieren ─────────────
await step('anime', async () => {
  await js(() => window.__shell.openAnimeRef('anime:154587', { title: "Frieren: Beyond Journey's End" }));
  await page.waitForSelector('#anime.active .aw-tools [aria-haspopup]', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#anime.active .an-er').length > 0, null, { timeout: 30000 });
  await sleep(2500);
  await shot('anime-work', 'صفحة عمل أنمي حقيقية (AniList) قبل أي تنزيل');
  await menuOpen('#anime.active', '.aw-tools');
  await shot('anime-menu', '⋮ مفتوحة: «تحميل» أول دائرة، وبقية القائمة كما هي لحساب مسجّل');
  await tap('#anime.active .aw-menu.open .aw-menu-item');
  await page.waitForSelector('.dl-start');
  await shot('anime-sheet', 'ورقة بدء التحميل: النطاق، المصدر (ذكي/يدوي)، الجودة، Wi-Fi فقط، المساحة');
  await page.getByRole('button', { name: 'اختيار يدوي' }).click();
  await page.waitForSelector('.dl-source');
  await shot('anime-sheet-manual', 'الاختيار اليدوي: مصادر العمل، والتنزيل يلتزم بالمختار');
  await page.getByRole('button', { name: 'تحميل ذكي' }).click();
  await page.getByRole('button', { name: 'حلقات محددة' }).click();
  await page.fill('.dl-range input', '1-4');
  await sleep(300);
  await shot('anime-sheet-range', 'حلقات محددة 1-4: الزر يقول ما سيُنزَّل');
  await tap('.dl-start-go');
  await page.waitForSelector('.dl-start', { state: 'detached' });
});

await step('queue', async () => {
  await goDownloads();
  await tab('جاري التحميل');
  await page.waitForFunction(() => document.querySelectorAll('.dl-row').length > 0);
  await sleep(1500);
  await shot('queue-start', '«جاري التحميل»: حلقتان نشطتان (التوازي 2) واثنتان تنتظران');
  await page.waitForFunction(() => document.querySelectorAll('.dl-row').length === 2, null, { timeout: 30000 });
  await sleep(4500);
  await shot('queue-progress', 'تقدّم حقيقي في الواجهة: الحجم/الإجمالي، النسبة، السرعة، والوقت المتبقي حين تستقر السرعة');
  await tap('.dl-row .dl-info');
  await page.waitForSelector('.dl-info-sheet');
  await shot('queue-info', 'ⓘ تفاصيل التنزيل: المحتوى والمصدر والوسائط والتخزين');
  await closeSheet();
  await tap('.dl-summary-settings');
  await page.waitForSelector('.dl-settings');
  await shot('settings', 'إعدادات التحميل: التوازي 1–4، Wi-Fi فقط، والتخزين');
  await closeSheet();
});

// ───────────── السينما (Cinemeta حيّ): Breaking Bad ─────────────
await step('cinema', async () => {
  await js(() => { window.__qaAllFast = true; window.__shell.openCinemaRef('cinema:tt0903747', { title: 'Breaking Bad', type: 'series' }); });
  await page.waitForSelector('#cinema.active [aria-haspopup="menu"]', { timeout: 40000 });
  await sleep(3000);
  await shot('cinema-work', 'مسلسل حقيقي (Cinemeta) قبل التنزيل');
  await tap('#cinema.active [aria-haspopup="menu"]');
  await sleep(700);
  await shot('cinema-menu', '⋮ في السينما: «تحميل» أولًا');
  await tap('#cinema.active .aw-menu.open .aw-menu-item');
  await page.waitForSelector('.dl-start');
  await page.getByRole('button', { name: 'حلقات محددة' }).click();
  await page.fill('.dl-range input', '1-2');
  await sleep(300);
  await shot('cinema-sheet', 'المسلسل: الموسم كاملًا أو حلقات محددة من موسم');
  await tap('.dl-start-go');
  await page.waitForSelector('.dl-start', { state: 'detached' });
});

// ───────────── المانجا (بيانات مولّدة وصفحات JPEG) ─────────────
await step('manga', async () => {
  await js(() => { document.querySelector('[data-act="pickSection"][data-arg="manga"]')?.click(); window.__shell.openWork(window.__manga(1)); });
  await page.waitForSelector('#detail.active #detailTools [aria-haspopup]', { timeout: 20000 });
  await sleep(1500);
  await tap('#detail.active #detailTools [aria-haspopup]');
  await sleep(700);
  await shot('manga-menu', '⋮ في المانجا: «تحميل» أولًا');
  await tap('#detailMenu.open .aw-menu-item');
  await page.waitForSelector('.dl-start');
  await page.getByRole('button', { name: 'فصول محددة' }).click();
  await page.fill('.dl-range input', '1-6');
  await sleep(300);
  await shot('manga-sheet', 'فصول 1–6 من عمل فيه 201 فصل');
  await tap('.dl-start-go');
  await page.waitForSelector('.dl-start', { state: 'detached' });
});

await step('device', async () => {
  await goDownloads();
  await page.waitForFunction(async () => {
    const { downloads } = await import('/lib/downloads/index.js');
    const { manager } = await downloads();
    const l = manager.list();
    return l.filter((i) => i.state === 'ready').length >= 10;
  }, null, { timeout: 90000, polling: 1000 }).catch(() => {});
  await tab('على الجهاز');
  await page.waitForSelector('.dl-card');
  await sleep(1500);
  await shot('device-grid', '«على الجهاز»: بطاقات مكتبتي نفسها، عمل واحد لكل بطاقة بعدد المحفوظ');
});

const openDeviceCard = async (title) => {
  await goDownloads();
  await tab('على الجهاز');
  await page.waitForSelector('.dl-card');
  await page.locator('.dl-card', { hasText: title }).first().click();
};

await step('anime-local', async () => {
  await openDeviceCard('Frieren');
  await page.waitForSelector('#anime.active .an-er', { timeout: 20000 });
  await sleep(2500);
  await shot('anime-local-top', 'صفحة Frieren الأصلية نفسها من «على الجهاز»');
  await js(() => document.querySelector('#anime.active .an-er')?.scrollIntoView({ block: 'center' }));
  await sleep(900);
  await shot('anime-local-episodes', 'الحلقات المحمّلة وحدها بأرقامها الأصلية');
  await js(() => window.scrollTo(0, 0));
  await sleep(400);
  await menuOpen('#anime.active', '.aw-tools');
  await tap('#anime.active .aw-menu.open .aw-menu-item');
  await page.waitForSelector('.dl-manage');
  await shot('anime-local-manage', '⋮ ← «تحميل» على عمل من الجهاز: ما عليه وحذفه بتأكيد');
  await closeSheet();
  await page.locator('#anime.active .an-er-main').first().click();
  await sleep(600);
  const played = await js(() => window.__qaPlayed ?? null);
  report.push({ step: 'anime-local-play', played });
});

await step('cinema-local', async () => {
  await openDeviceCard('Breaking Bad');
  await page.waitForSelector('#cinema.active', { timeout: 20000 });
  await sleep(3000);
  await shot('cinema-local-top', 'صفحة Breaking Bad الأصلية من «على الجهاز»');
  await js(() => document.querySelector('#cinemaEpisodes')?.scrollIntoView({ block: 'start' }));
  await sleep(900);
  await shot('cinema-local-episodes', 'الموسم الذي فيه تنزيلات وحده، وحلقتاه المحمّلتان');
});

await step('manga-local', async () => {
  await openDeviceCard('Fixture Work 1');
  await page.waitForSelector('#detail.active', { timeout: 20000 });
  await sleep(2500);
  await shot('manga-local-top', 'صفحة المانجا الأصلية من «على الجهاز»');
  await js(() => document.querySelector('#chapterPanel')?.scrollIntoView({ block: 'start' }));
  await sleep(900);
  await shot('manga-local-chapters', 'الفصول الستة المحمّلة وحدها من 201');
});

// ───────────── بلا إنترنت ─────────────
await step('offline', async () => {
  await page.unroute('https://pages.fixture/**');
  await page.route((u) => !String(u).startsWith(rig.origin), (route) => route.abort('internetdisconnected'));
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  await page.reload();
  await boot(page, { section: 'anime' });
  await page.waitForSelector('#home.active');
  await openDeviceCard('Frieren');
  await page.waitForSelector('#anime.active .an-er', { timeout: 20000 });
  await sleep(2500);
  await shot('offline-anime-local', 'بلا إنترنت: الصفحة الأصلية بغلافها وبنرها وشعارها المحفوظة، والحلقات المحمّلة');
  await goDownloads();
  await tab('على الجهاز');
  await sleep(1200);
  await shot('offline-device-grid', 'بلا إنترنت: «على الجهاز» بأغلفتها المحفوظة');
});

// ───────────── الكمبيوتر ─────────────
await step('desktop', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(1200);
  await shot('desktop-device-grid', 'مقاس الكمبيوتر: «على الجهاز»');
  await tab('جاري التحميل');
  await sleep(800);
  await shot('desktop-queue', 'مقاس الكمبيوتر: «جاري التحميل»');
});

await writeFile(`${out}/report.json`, JSON.stringify({ report, errors: log.errors }, null, 2));
await rig.close();
console.log(JSON.stringify(report.filter((r) => r.error || r.played), null, 1), '\nerrors:', log.errors.length, log.errors.slice(0, 3).join('\n'));
