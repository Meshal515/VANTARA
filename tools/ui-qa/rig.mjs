// حزام فحص الواجهة: القشرة الحقيقية (mountV35) في Chromium، بمزامنة بديلة وبيانات مانجا مولّدة.
// الأنمي والسينما: بيانات ثابتة (fixtures) افتراضيًا كي تكون النتائج قابلة للتكرار، أو الشبكة الحية بـ net:'live'.
// لا يُشغَّل ضمن vitest: سكربتات tools/ui-qa/*.mjs تستورده وتُشغَّل بـ node مباشرة.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.VANTARA_PLAYWRIGHT_MODULE || 'playwright');
export const WEB = fileURLToPath(new URL('../../apps/web', import.meta.url));
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

/** صورة مولّدة بلون ونسبة: تكفي لقياس الهندسة ولتمييز الطبقات في تحليل الإطارات. */
const art = (w, h, fill, mark = '#ffffff') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/>` +
  `<circle cx="${w / 2}" cy="${h * 0.4}" r="${Math.min(w, h) * 0.22}" fill="${mark}" fill-opacity="0.55"/>` +
  `<rect x="${w * 0.12}" y="${h * 0.78}" width="${w * 0.76}" height="${h * 0.06}" fill="${mark}" fill-opacity="0.35"/></svg>`;
const IMAGES = {
  '/__art/cover.svg': art(460, 690, '#5b3a8f'),
  '/__art/banner.svg': art(1900, 600, '#2a3550'),
  '/__art/wide.svg': art(1920, 1080, '#3a2a2a'),
  '/__art/still.svg': art(640, 360, '#24463a'),
  '/__art/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect x="20" y="60" width="560" height="80" rx="12" fill="#fff"/></svg>',
};

/** مصدر مانجا بديل يُحقن مكان loadWork: 201 فصلًا من مصدرين، تصل بعد `delay`. */
const fakeLoadWork = (delay) => `export async function loadWork(v, { onUpdate = () => {} } = {}) {
  const day = 86400000, now = Date.now();
  const total = Number(v.__chapters ?? 201);
  const rows = Array.from({ length: total }, (_, i) => { const n = total - i; return { sourceId: 'teamx', number: n, lang: 'ar', chapter: { name: 'الفصل ' + n, url: '/c/' + n, chapterNumber: n, dateUpload: now - (i * 7 + 3) * day, scanlator: 'Team X' } }; });
  const srcs = [['teamx', 'Team X', total], ['azora', 'Azora', Math.max(1, total - 3)]];
  const editions = srcs.map(([id, label, c]) => ({ sourceId: id, label, manga: { url: '/m' }, chapters: rows.filter((r) => r.number <= c).map((r) => ({ ...r.chapter, sourceId: id })) }));
  const full = { ...v, description: 'In a world where awakened beings called Hunters must battle deadly monsters to protect humanity, the weakest hunter of all mankind finds himself in a constant struggle for survival. One day he is chosen by a mysterious program and everything changes.', staff: { edges: [{ role: 'Story', node: { name: { full: 'Writer A' } } }] }, status: 'RELEASING', genres: ['Action', 'Fantasy', 'Adventure'], _chapters: rows, chapters: total, _editions: editions, _sources: srcs.map(([sourceId, label, count]) => ({ sourceId, label, count, lang: 'ar' })), _failedSources: [] };
  await new Promise((r) => setTimeout(r, ${delay}));
  onUpdate(full, { settled: true });
  return full;
}
async function __realLoadWork(`;

const ep = (n, o) => ({ title: `Episode ${n} - Story ${n}`, thumbnail: `${o}/__art/still.svg`, url: null, site: 'x' });
/** ردّ AniList ثابت لأي استعلام: عمل واحد بمعرّف الطلب، ولصفحات القوائم 12 عملًا. */
function anilistFixture(body, o) {
  let vars = {};
  let query = '';
  try { const j = JSON.parse(body ?? '{}'); vars = j.variables ?? {}; query = j.query ?? ''; } catch { /* */ }
  const media = (id) => ({
    id, idMal: id, type: 'ANIME', format: 'TV', status: 'FINISHED', episodes: 24, duration: 24, season: 'FALL', seasonYear: 2024,
    averageScore: 84, meanScore: 84, popularity: 90000, favourites: 1000, isAdult: false, countryOfOrigin: 'JP', source: 'MANGA',
    title: { romaji: `Fixture Anime ${id}`, english: `Fixture Anime ${id}`, native: `フィクスチャ ${id}` }, synonyms: [],
    coverImage: { large: `${o}/__art/cover.svg`, extraLarge: `${o}/__art/cover.svg`, medium: `${o}/__art/cover.svg`, color: '#5b3a8f' },
    bannerImage: `${o}/__art/banner.svg`, description: 'A fixture synopsis used by the UI rig. '.repeat(6), genres: ['Action', 'Drama'], tags: [],
    startDate: { year: 2024, month: 10, day: 1 }, endDate: { year: 2025, month: 3, day: 1 }, studios: { nodes: [{ name: 'Fixture Studio', isAnimationStudio: true }], edges: [] },
    nextAiringEpisode: null, trailer: null, externalLinks: [], streamingEpisodes: Array.from({ length: 24 }, (_, i) => ep(i + 1, o)),
    relations: { edges: [] }, characters: { edges: [], nodes: [] }, recommendations: { nodes: [] }, staff: { edges: [] }, rankings: [], airingSchedule: { nodes: [] },
  });
  const list = Array.from({ length: 12 }, (_, i) => media(1000 + i));
  const data = {};
  if (/\bMedia\s*\(/.test(query)) data.Media = media(Number(vars.id) || 21);
  const page = { pageInfo: { hasNextPage: false, currentPage: 1, total: 12 }, media: list, airingSchedules: [], recommendations: [], mediaTrends: [] };
  // الاستعلامات تسمّي صفحاتها بأسماء مستعارة مختلفة: كل اسم مستعار قبل Page يأخذ الصفحة نفسها
  for (const m of query.matchAll(/(\w+)\s*:\s*Page\s*\(/g)) data[m[1]] = page;
  if (/(^|[\s{])Page\s*\(/.test(query)) data.Page = page;
  return { data };
}
function cinemetaFixture(url, o) {
  const u = new URL(url);
  const meta = (id, type) => ({
    id, type, name: `Fixture ${type === 'series' ? 'Series' : 'Movie'} ${id}`, poster: `${o}/__art/cover.svg`, background: `${o}/__art/wide.svg`, logo: `${o}/__art/logo.svg`,
    description: 'A fixture overview used by the UI rig. '.repeat(5), runtime: '48 min', genres: ['Drama', 'Crime'], releaseInfo: '2019–2024', year: '2019', imdbRating: '8.7',
    cast: ['Actor One', 'Actor Two', 'Actor Three'], director: ['Director One'], writer: ['Writer One'], country: 'US',
    videos: type === 'series' ? [1, 2, 3, 4].flatMap((s) => Array.from({ length: s === 4 ? 6 : 10 }, (_, i) => ({ id: `${id}:${s}:${i + 1}`, season: s, episode: i + 1, number: i + 1, name: `Episode ${i + 1}`, title: `Episode ${i + 1}`, released: new Date(Date.UTC(2018 + s, 0, 1 + i * 7)).toISOString(), firstAired: new Date(Date.UTC(2018 + s, 0, 1 + i * 7)).toISOString(), thumbnail: `${o}/__art/still.svg`, overview: 'Episode overview.' }))) : [],
  });
  const m = /\/meta\/(movie|series)\/([^/.]+)\.json/.exec(u.pathname);
  if (m) return { meta: meta(m[2], m[1]) };
  const c = /\/catalog\/(movie|series)\//.exec(u.pathname);
  if (c) return { metas: Array.from({ length: 20 }, (_, i) => meta(`tt${String(9000000 + i + (c[1] === 'series' ? 100 : 0))}`, c[1])) };
  return {};
}

/**
 * @param {object} o
 * @param {'fixture'|'live'} [o.net] الأنمي والسينما: ثابتة أو حية
 * @param {number} [o.mangaDelay] تأخر وصول فصول المانجا (ms)
 * @param {number} [o.imageDelay] تأخر الصور المولّدة (ms)
 */
// QA_IMAGE_DELAY / QA_MANGA_DELAY: شبكة بطيئة (الصور والفصول تتأخر) لاختبار مسار المهلة والمحتوى المتأخر
export async function launch({ unified = false, section = 'manga', viewport = { width: 390, height: 844 }, appearance = null, rows = {}, net = 'fixture', mangaDelay = Number(process.env.QA_MANGA_DELAY ?? 400), imageDelay = Number(process.env.QA_IMAGE_DELAY ?? 0), mobile = true, record = null, motion = null } = {}) {
  const index = await readFile(path.join(WEB, 'index.html'), 'utf8');
  const css = [...index.matchAll(/href="(\/[^"]*\.css)"/g)].map((m) => m[1]);
  const fontCss = /<style>[\s\S]*?<\/style>/.exec(index)?.[0] ?? '';
  const server = createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://local').pathname;
      if (p === '/__ui') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(`<!doctype html><html lang="ar" dir="rtl"${motion ? ` data-motion="${motion}"` : ''}><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${css.map((c) => `<link rel="stylesheet" href="${c}">`).join('')}${fontCss}<body><div id="root"></div></body></html>`);
      }
      if (IMAGES[p]) {
        if (imageDelay) await new Promise((r) => setTimeout(r, imageDelay));
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'max-age=3600');
        return res.end(IMAGES[p]);
      }
      let body = await readFile(path.join(WEB, p));
      if (p === '/v35/works.js') body = String(body).replace('export const available = () => engine.isAvailable();', 'export const available = () => true;').replace('export async function loadWork(', fakeLoadWork(mangaDelay));
      res.setHeader('Content-Type', TYPES[path.extname(p)] ?? 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const live = net === 'live';
  const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: live && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined });
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1, locale: 'ar-SA', ...(record ? { recordVideo: { dir: record, size: viewport } } : {}) });
  // NO_WEBGL=1: متصفح القياس يرسم WebGL برمجيًا (SwiftShader) فتثقل خلفية silk كل إطار ثقلًا لا يوجد على جهاز
  // حقيقي. يُعطَّل لقياس انتقالات التطبيق نفسه، ويُذكر ذلك في التقرير.
  if (process.env.NO_WEBGL) await context.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; });
  const page = await context.newPage();
  const log = { errors: [], console: [], requests: [] };
  page.on('pageerror', (e) => { if (!/محرّك الإضافات غير متاح/.test(e.message)) log.errors.push(String(e.stack || e).slice(0, 700)); });
  page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text().slice(0, 300)); });
  await page.route((u) => !String(u).startsWith(origin), async (route) => {
    const req = route.request();
    const u = req.url();
    log.requests.push(u);
    if (live) return route.continue();
    if (u.includes('graphql.anilist.co')) return route.fulfill({ json: anilistFixture(req.postData(), origin) });
    if (u.includes('cinemeta') && u.includes('strem.io')) return route.fulfill({ json: cinemetaFixture(u, origin) });
    return route.abort();
  });
  await page.goto(origin + '/__ui');
  await page.evaluate(async ({ unified, section, rows, appearance }) => {
    localStorage.setItem('vantara.experience.v1', JSON.stringify({ v: 2, unifyContent: unified }));
    localStorage.setItem('vantara.section', section);
    if (appearance) localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: {}, accent: {}, pureBlack: false, ...appearance }));
    const tables = { work_views: [], library: [], progress: [], collections: [], completions: [], ratings: [], notifications: [], chapter_marks: [], settings: [], accounts: [{ user_id: 'qa', display_name: 'QA', created_at: 1 }], ...rows };
    const listeners = new Set();
    const ops = [];
    const emit = (t) => { for (const fn of listeners) { try { fn(t); } catch (e) { console.error('onChange', e); } } };
    const sync = {
      user: { userId: 'qa', displayName: 'QA' }, ready: Promise.resolve(),
      rows: (t, p) => (tables[t] ?? []).filter(p || (() => true)),
      row: (t, id) => (tables[t] ?? []).find((r) => r.id === id || r.user_id === id) ?? null,
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      enqueue: (kind, payload) => { ops.push({ kind, payload, at: Date.now() }); return Promise.resolve(); },
      translation: async () => ({ status: 200, body: { rows: [], groups: [] } }),
      latestSnapshots: async () => ({ sources: [] }), presence: async () => [], stats: async () => ({}), insights: async () => ({}),
      topWorks: async () => [], pendingDevices: async () => [], privacyCapability: async () => ({}), authorizationHeader: null,
      refreshSession: async () => {}, attachNativeLinkBridge: () => {},
    };
    window.__ops = ops; window.__tables = tables; window.__emit = emit;
    const { mountV35 } = await import('/v35/shell.js');
    window.__shell = mountV35({ sync, mount: (n) => document.getElementById('root').replaceChildren(n), go: async (r) => { window.__go = r; }, friends: () => [], presence: async () => [], version: 'qa', switchAccount: () => {}, openReader: (...a) => { window.__reader = a; } }, { page: 'home' });
    const o = location.origin;
    window.__manga = (n = 1, extra = {}) => ({ id: `ext:fixture work ${n}`, title: { english: `Fixture Work ${n}` }, coverImage: { large: `${o}/__art/cover.svg`, extraLarge: `${o}/__art/cover.svg` }, bannerImage: `${o}/__art/cover.svg`, wideBanner: `${o}/__art/banner.svg`, genres: ['Action'], status: 'RELEASING', averageScore: 84, startDate: { year: 2018 }, staff: { edges: [] }, chapters: 201, _work: { key: `fixture work ${n}`, title: `Fixture Work ${n}`, thumbnailUrl: `${o}/__art/cover.svg`, editions: [{ sourceId: 'teamx', label: 'Team X', manga: { url: '/m' } }] }, ...extra });
    window.__open = (kind, n = 1) => kind === 'manga' ? window.__shell.openWork(window.__manga(n))
      : kind === 'anime' ? window.__shell.openAnimeRef(`anime:${20 + n}`, { title: `Fixture Anime ${20 + n}` })
      : window.__shell.openCinemaRef(`cinema:tt09037${String(n).padStart(2, '0')}`, { title: 'Fixture', type: kind === 'movie' ? 'movie' : 'series' });
  }, { unified, section, rows, appearance });
  await page.waitForSelector('#home.active');
  const close = async () => { await context.close(); await browser.close(); server.close(); };
  return { page, browser, context, origin, log, close };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const PAGE_OF = { manga: 'detail', anime: 'anime', series: 'cinema', movie: 'cinema' };

/** حالة التنقل كما يراها المستخدم: صفحة واحدة نشطة، لا بقايا حركة، والشريط السفلي حيث يجب. */
export const snap = (page) => page.evaluate(() => {
  const nav = document.getElementById('bottomNav');
  const vis = (n) => { if (!n || n.hidden) return false; const c = getComputedStyle(n); const r = n.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0.01 && r.width > 0 && r.height > 0; };
  return {
    active: [...document.querySelectorAll('.page.active')].map((p) => p.id),
    y: Math.round(scrollY),
    transient: document.querySelectorAll('.page-out,.page-in,.page-depth').length,
    running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.classList?.contains('page')).length,
    nav: vis(nav), navInert: Boolean(nav?.inert),
    section: document.querySelector('.v35')?.dataset.section, content: document.querySelector('.v35')?.dataset.content ?? null,
    inlineLeft: [...document.querySelectorAll('.page')].filter((p) => p.style.position || p.style.opacity || p.style.transform).map((p) => p.id),
  };
});

/**
 * أي صفحة تُرسم فعلًا الآن في منتصف الشاشة وعند حوافها: أسماء الصفحات التي تملك العنصر الأعلى عند عدة نقاط،
 * وشفافية كل صفحة ظاهرة. يكشف تسرّب صفحة سابقة أو ظهور الرئيسية تحت صفحة تتلاشى.
 */
export const layers = (page) => page.evaluate(() => {
  const pts = [[0.5, 0.12], [0.5, 0.5], [0.5, 0.88], [0.1, 0.5], [0.9, 0.5]];
  const owner = (x, y) => { const n = document.elementFromPoint(innerWidth * x, innerHeight * y); return n?.closest('.page')?.id ?? (n?.closest('#bottomNav') ? 'nav' : n?.closest('.uv-page,.ud-page,.ul-page') ? 'overlay' : n?.tagName ?? null); };
  const pages = [...document.querySelectorAll('.page')].map((p) => { const c = getComputedStyle(p); return c.display === 'none' ? null : { id: p.id, opacity: +Number(c.opacity).toFixed(3), fixed: c.position === 'fixed', active: p.classList.contains('active') }; }).filter(Boolean);
  return { top: pts.map(([x, y]) => owner(x, y)), pages };
});
