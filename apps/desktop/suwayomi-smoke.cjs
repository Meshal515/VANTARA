'use strict';
// وضع إثبات صريح (سطر أوامر فقط: --manga-engine-smoke-report=<ملف>): إضافات Mihon في ويندوز الحقيقي كما يمر بها
// المستخدم: تنزيل المحرك الموثّق وتشغيله، إضافة مستودع Keiyoushi الحقيقي، تثبيت إضافة موقّعة، تصفح، تفاصيل عمل
// وفصوله، صفحات فصل، وصورة صفحة فعلية من بروتوكول المحرك. لا يغيّر سلوك التطبيق العادي.
const fs = require('node:fs/promises');

const REPO = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
const PKG = 'eu.kanade.tachiyomi.extension.all.mangadex';
const EXTRA = ['eu.kanade.tachiyomi.extension.ar.teamx', 'eu.kanade.tachiyomi.extension.ar.mangaswat', 'eu.kanade.tachiyomi.extension.ar.azora'];

async function runMangaEngineSmoke({ engine, runtime, reportPath, repo = REPO, pkg = PKG }) {
  const steps = [];
  const step = async (name, fn) => {
    const started = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, ms: Date.now() - started, detail });
      return detail;
    } catch (error) {
      steps.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 400) });
      throw error;
    }
  };
  try {
    await step('engine install (pinned SHA-256)', async () => { await runtime.install(); return runtime.state(); });
    await step('engine start (127.0.0.1, BASIC auth)', async () => { const e = await runtime.start(); return { loopback: /^http:\/\/127\.0\.0\.1:\d+$/.test(e.base) }; });
    await step('add repository', async () => (await engine.call('addRepo', { url: repo })).count);
    const sourceId = await step('install signed extension', async () => (await engine.call('installExtension', { repo, pkg })).sources[0]);
    await step('sources listed as pkg#id', async () => (await engine.call('sources')).sources.map((s) => s.id));
    const popular = await step('popular page 1', async () => (await engine.call('popular', { sourceId, page: 1 })));
    let chosen = null;
    await step('series with chapters', async () => {
      for (const manga of popular.mangas.slice(0, 6)) {
        const out = await engine.call('series', { sourceId, manga }).catch(() => null);
        if (out?.chapters?.length) { chosen = out; return { title: out.manga.title, chapters: out.chapters.length }; }
      }
      throw new Error('no title with chapters in the first page');
    });
    const pages = await step('chapter pages', async () => (await engine.call('pages', { sourceId, chapter: chosen.chapters.at(-1) })).pages);
    await step('page image through vantara-engine:', async () => {
      const r = await engine.media(pages[0].imageUrl);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (r.status !== 200 || bytes.length < 1000) throw new Error(`status ${r.status}, ${bytes.length} bytes`);
      return { status: r.status, type: r.headers.get('content-type'), bytes: bytes.length };
    });
    await step('cover through vantara-engine:', async () => {
      const url = chosen.manga.thumbnailUrl ?? popular.mangas[0]?.thumbnailUrl;
      const r = await engine.media(url);
      return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
    });
    await step('blocked path stays blocked', async () => {
      const r = await engine.media('vantara-engine://suwayomi/api/graphql');
      if (r.status !== 403) throw new Error(`status ${r.status}`);
      return r.status;
    });
  } catch { /* الخطوة الفاشلة مسجلة؛ التقرير يُكتب كما هو */ }
  // مصادر عربية حقيقية بجانب MangaDex: مؤشر فقط (المواقع نفسها قد تتوقف أو تطلب تحققًا)، والشرط يبقى MangaDex كاملًا
  const extras = [];
  if (steps.length === 11 && steps.every((s) => s.ok)) for (const other of EXTRA) {
    const row = { pkg: other };
    try {
      const id = (await engine.call('installExtension', { repo, pkg: other })).sources[0];
      row.installed = true;
      const list = await engine.call('popular', { sourceId: id, page: 1 });
      row.popular = list.mangas.length;
    } catch (error) { row.error = String(error?.message ?? error).slice(0, 200); }
    extras.push(row);
  }
  // آخر سطور سجل المحرك للتشخيص (السر محجوب فيه أصلًا)
  let log = '';
  // أسطر الأخطاء نفسها (لا ذيل التتبع وحده) ثم آخر السجل
  try {
    const lines = (await fs.readFile(runtime.logFile, 'utf8')).split(/\r?\n/);
    const errors = lines.filter((l) => /Exception|Caused by|ERROR|WARN|Error:|Reason:|Location:|Current Frame|Type '/.test(l) && !/^\s+at /.test(l)).slice(-60);
    log = [...errors, '---', ...lines.slice(-25)].join('\n');
  } catch { /* */ }
  const report = { passed: steps.filter((s) => s.ok).length, total: steps.length, complete: steps.length === 11 && steps.every((s) => s.ok), steps, extras, engine: runtime.state(), log };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { runMangaEngineSmoke, REPO, PKG };
