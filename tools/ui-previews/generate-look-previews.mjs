#!/usr/bin/env node
/**
 * يولّد لقطات المعاينة الحقيقية لصفحة «المظهر والتخصيص» من التطبيق نفسه (apps/web) بالمقاسات الثلاثة:
 * هاتف وآيباد وحاسب، ويحفظها webp صغيرة في apps/web/v35/looks/ بالأسماء التي يطلبها look-previews.js.
 *
 *   node tools/ui-previews/generate-look-previews.mjs
 *
 * المتغيرات:
 *   VANTARA_PLAYWRIGHT_MODULE  مسار playwright/index.mjs (الافتراضي: من `npm root -g`)
 *   VANTARA_CHROMIUM           مسار Chromium (اختياري)
 *   ONLY                       تصفية بالاسم، مثل `home-` أو `work-anime-`
 *   MANGA_LOOKS_SITE           (مؤقت) مجلد النموذج المعتمد لأنماط صفحة عمل المانجا (manga-looks.html).
 *
 * المصادر:
 *   - رئيسيات الأقسام الثلاثة وصفحات عمل الأنمي (بأنماطه الخمسة) والسينما: من التطبيق الحقيقي، بحساب
 *     تجريبي محلي (tools/ui-previews/fixture.json) وبيانات عامة حية من AniList وCinemeta.
 *   - أنماط صفحة عمل المانجا (page/gallery/profile/resume): **مؤقتًا** من النموذج المعتمد
 *     `manga-looks.html?v=1..4` لأن تنفيذها في صفحة العمل عند وكيل آخر (ومعه تغيير الشريط العلوي:
 *     القلب، رشّح، الأصدقاء، ⋮). بعد دمج عمله: أعد توليد `work-manga-*` من التطبيق (افتح عمل مانجا
 *     بالنمط المحفوظ في vantara.appearance.v1 كما يُفعل للأنمي هنا) واحذف مسار النموذج.
 *
 * الحارس: apps/web/v35/look-previews.test.js يفشل إن غابت لقطة لنمط معرّف.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WEB = join(ROOT, 'apps/web');
const OUT = join(WEB, 'v35/looks');
const pw = process.env.VANTARA_PLAYWRIGHT_MODULE || join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright/index.mjs');
const { chromium } = await import(pw);
const { VIEWPORTS, homePreview, workPreview } = await import(join(WEB, 'v35/look-previews.js'));
const { CINEMA_WORK_STYLES, MANGA_WORK_STYLES, WORK_STYLES } = await import(join(WEB, 'v35/appearance.js'));
const D = JSON.parse(await readFile(join(HERE, 'fixture.json'), 'utf8'));
const only = process.env.ONLY || '';

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml' };
const index = await readFile(join(WEB, 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
const fonts = '<style>@font-face{font-family:"Vantara Sans";src:url(/fonts/Inter-Latin.var.woff2);font-weight:400 800;unicode-range:U+0000-00FF,U+2000-206F}@font-face{font-family:"Vantara Sans";src:url(/fonts/NotoSansArabic.var.woff2);font-weight:400 800;unicode-range:U+0600-06FF,U+FB50-FDFF,U+FE70-FEFC}</style>';
const latest = D.updatedManga.map((m, i) => ({ id: `al:${m.id}`, title: m.title, coverImage: m.coverImage, genres: m.genres, status: m.status, _latestChapter: { chapterNumber: (m.chapters || 120 + i * 7) + 1 }, _updateAt: Date.now() - (i + 1) * 37 * 60000, _updatePublishedAt: 1 }));
const views = [
  ...D.manga.slice(3, 7).map((m, i) => ({ user_id: 'u1', series_ref: `al:${m.id}`, series_title: m.title.english || m.title.romaji, cover_url: m.coverImage.large, chapter_label: String([222, 48, 131, 9][i]), viewed_at: Date.now() - i * 3600000 })),
  ...D.trending.slice(0, 4).map((m, i) => ({ user_id: 'u1', series_ref: `anime:${m.id}`, series_title: m.title.english || m.title.romaji, cover_url: m.coverImage.large, chapter_number: [4, 1, 12, 7][i], chapter_label: `الحلقة ${[4, 1, 12, 7][i]}`, viewed_at: Date.now() - (i + 4) * 3600000 })),
];

const site = process.env.MANGA_LOOKS_SITE;
const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://l').pathname;
    if (p === '/__ui') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}${sheets.map((c) => `<link rel="stylesheet" href="${c}">`).join('')}<body></body></html>`);
    }
    let body;
    if (p.startsWith('/__site/')) {
      if (!site) throw new Error('no site');
      body = await readFile(join(site, p.slice(8)));
    } else {
      body = await readFile(join(WEB, p));
    }
    if (p === '/v35/works.js') body = String(body).replace('export const available = () => engine.isAvailable();', 'export const available = () => true;').replace('export async function browseLive(', 'export async function browseLive(q,u){const r={items:globalThis.__latest,hasNextPage:false};u(r);return r}\nasync function __browseLive(');
    res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.VANTARA_CHROMIUM ? { executablePath: process.env.VANTARA_CHROMIUM } : {});
await mkdir(OUT, { recursive: true });
const encoder = await browser.newPage();
await encoder.goto(`${base}/__ui`);

/** PNG ← webp بعرض `out`، بترميز Chromium نفسه (لا أداة خارجية). */
async function save(png, out, file) {
  const data = await encoder.evaluate(async ({ b64, out }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = out;
    c.height = Math.round((img.naturalHeight / img.naturalWidth) * out);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.7).split(',')[1];
  }, { b64: png.toString('base64'), out });
  await writeFile(join(WEB, file.slice(1)), Buffer.from(data, 'base64'));
  console.log('saved', file, Math.round((data.length * 3) / 4 / 1024), 'KB');
}

async function appShot(vp, file, { section, style = {}, open = null }) {
  if (only && !file.includes(only)) return;
  const touch = vp.id !== 'pc';
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, locale: 'ar' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ section, style }) => {
    localStorage.setItem('vantara.section', section);
    localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style, accent: {}, pureBlack: false }));
  }, { section, style });
  await page.goto(`${base}/__ui`);
  await page.evaluate(async ({ latest, views }) => {
    globalThis.__latest = latest;
    const sync = { user: { userId: 'u1' }, rows: (t, f) => (t === 'work_views' ? views : []).filter(f || (() => true)), row: () => null, onChange: () => () => {}, enqueue: () => {}, translation: async () => ({ status: 200, body: { rows: [] } }), latestSnapshots: async () => ({ sources: [] }), presence: async () => [], stats: async () => ({}), insights: async () => ({}), topWorks: async () => [], pendingDevices: async () => 0, privacyCapability: async () => ({}), authorizationHeader: null };
    const { mountV35 } = await import('/v35/shell.js');
    window.__shell = mountV35({ sync, mount: (n) => document.body.replaceChildren(n), go: async () => {}, friends: () => [], presence: async () => [], version: 'preview', switchAccount: () => {}, openReader: () => {} }, { page: 'home' });
  }, { latest, views });
  await page.waitForTimeout(7000);
  if (open) {
    await page.evaluate(open);
    await page.waitForTimeout(7000);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await save(await page.screenshot(), vp.out, file);
  if (errors.length) console.warn(file, 'page errors:', errors.slice(0, 3));
  await page.close();
}

async function siteShot(vp, file, v) {
  if (only && !file.includes(only)) return;
  if (!site) throw new Error('MANGA_LOOKS_SITE مطلوب مؤقتًا لأنماط صفحة عمل المانجا (انظر رأس الملف)');
  const touch = vp.id !== 'pc';
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, locale: 'ar' });
  await page.goto(`${base}/__site/manga-looks.html?v=${v}`);
  await page.waitForFunction(() => window.ready, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await save(await page.screenshot(), vp.out, file);
  await page.close();
}

const anime = D.trending[0];
for (const vp of VIEWPORTS) {
  for (const section of ['manga', 'anime', 'cinema']) await appShot(vp, homePreview(section, vp.id), { section });
  for (const s of WORK_STYLES) {
    await appShot(vp, workPreview('anime', s.id, vp.id), {
      section: 'anime',
      style: { anime: s.id },
      open: `window.__shell.openAnimeRef('anime:${anime.id}', { title: ${JSON.stringify(anime.title.english || anime.title.romaji)}, cover: ${JSON.stringify(anime.coverImage.large)} })`,
    });
  }
  // أنماط السينما الأربعة بمسلسل (المواسم ظاهرة في الأنماط الجديدة)، من التطبيق نفسه
  for (const s of CINEMA_WORK_STYLES) {
    await appShot(vp, workPreview('cinema', s.id, vp.id), { section: 'cinema', style: { cinema: s.id }, open: "window.__shell.openCinemaRef('cinema:tt0944947', { title: 'Game of Thrones' })" });
  }
  // أنماط صفحة عمل المانجا من التطبيق نفسه (لا من النموذج)، بعمل حقيقي من AniList
  const m = (D.manga ?? []).find((x) => x.title?.english && x.bannerImage) ?? D.manga[0];
  for (const s of MANGA_WORK_STYLES) {
    await appShot(vp, workPreview('manga', s.id, vp.id), {
      section: 'manga',
      style: { manga: s.id },
      open: `window.__shell.openWork(${JSON.stringify({ id: `al:${m.id}`, title: m.title, coverImage: m.coverImage, genres: m.genres, status: m.status, chapters: m.chapters, averageScore: m.averageScore, bannerImage: m.bannerImage ?? null })})`,
    });
  }
}
await browser.close();
server.close();
