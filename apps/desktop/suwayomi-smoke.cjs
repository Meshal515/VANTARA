'use strict';
// وضع إثبات صريح (سطر أوامر فقط: --manga-engine-smoke-report=<ملف>): إضافات Mihon في ويندوز الحقيقي كما يمر بها
// المستخدم: تنزيل المحرك الموثّق وتشغيله، إضافة مستودع Keiyoushi الحقيقي، ثم لكل إضافة حقيقية سلسلة كاملة (تثبيت موقّع،
// قائمة، رائج، عمل بفصوله، صفحات، صورة صفحة فعلية، غلاف). لا يغيّر سلوك التطبيق العادي.
// «كامل» = الأساس سليم وسلسلة واحدة على الأقل من أولها لآخرها؛ التقرير يسمّي ما عمل وما رُفض وسببه (MangaDex 1.6.4
// يرفضه مدقق الـJVM على ويندوز حقيقي: كوده لا يتحوّل سليمًا، فهو حالة معروفة لا تُخفى).
const fs = require('node:fs/promises');

const REPO = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
const PKGS = Object.freeze([
  'eu.kanade.tachiyomi.extension.ar.teamx',
  'eu.kanade.tachiyomi.extension.ar.mangaswat',
  'eu.kanade.tachiyomi.extension.ar.azora',
  'eu.kanade.tachiyomi.extension.en.mangabuddy',
  'eu.kanade.tachiyomi.extension.all.mangadex',
]);

const record = (list) => async (name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    list.push({ name, ok: true, ms: Date.now() - started, detail });
    return detail;
  } catch (error) {
    list.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 400) });
    throw error;
  }
};

async function chainFor(engine, repo, pkg) {
  const steps = [];
  const link = record(steps);
  try {
    const sourceId = await link('install signed extension', async () => (await engine.call('installExtension', { repo, pkg })).sources[0]);
    await link('listed as pkg#id', async () => { if (!(await engine.call('sources')).sources.some((s) => s.id === sourceId)) throw new Error('not listed'); return sourceId; });
    const popular = await link('popular page 1', async () => { const p = await engine.call('popular', { sourceId, page: 1 }); if (!p.mangas.length) throw new Error('empty'); return { count: p.mangas.length, mangas: p.mangas.slice(0, 6) }; });
    let chosen = null;
    await link('series with chapters', async () => {
      for (const manga of popular.mangas) {
        const out = await engine.call('series', { sourceId, manga }).catch(() => null);
        if (out?.chapters?.length) { chosen = out; return { title: out.manga.title, chapters: out.chapters.length }; }
      }
      throw new Error('no title with chapters in the first page');
    });
    const pages = await link('chapter pages', async () => { const p = (await engine.call('pages', { sourceId, chapter: chosen.chapters.at(-1) })).pages; if (!p.length) throw new Error('no pages'); return { count: p.length, first: p[0].imageUrl }; });
    await link('page image', async () => {
      const r = await engine.media(pages.first);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (r.status !== 200 || bytes.length < 1000) throw new Error(`status ${r.status}, ${bytes.length} bytes`);
      return { status: r.status, type: r.headers.get('content-type'), bytes: bytes.length };
    });
    await link('cover', async () => { const r = await engine.media(chosen.manga.thumbnailUrl ?? popular.mangas[0]?.thumbnailUrl); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength }; });
  } catch { /* السلسلة تتوقف عند أول فشل، مسجلًا */ }
  for (const s of steps) if (s.detail?.mangas) delete s.detail.mangas;
  return { pkg, ok: steps.length === 7 && steps.every((s) => s.ok), steps };
}

async function runMangaEngineSmoke({ engine, runtime, reportPath, repo = REPO, pkgs = PKGS }) {
  const steps = [];
  const step = record(steps);
  const chains = [];
  try {
    await step('engine install (pinned SHA-256)', async () => { await runtime.install(); return runtime.state(); });
    await step('engine start (127.0.0.1, BASIC auth)', async () => { const e = await runtime.start(); return { loopback: /^http:\/\/127\.0\.0\.1:\d+$/.test(e.base) }; });
    await step('add repository', async () => (await engine.call('addRepo', { url: repo })).count);
    await step('blocked path stays blocked', async () => {
      const r = await engine.media('vantara-engine://suwayomi/api/graphql');
      if (r.status !== 403) throw new Error(`status ${r.status}`);
      return r.status;
    });
    for (const pkg of pkgs) chains.push(await chainFor(engine, repo, pkg));
  } catch { /* الأساس فشل؛ مسجل */ }
  // أسطر الأخطاء نفسها (لا ذيل التتبع وحده) ثم آخر السجل؛ السر محجوب فيه أصلًا
  let log = '';
  try {
    const lines = (await fs.readFile(runtime.logFile, 'utf8')).split(/\r?\n/);
    const errors = lines.filter((l) => /Exception|Caused by|ERROR|Error:|Reason:|Type '|fatal error/.test(l) && !/^\s+at /.test(l)).slice(-60);
    log = [...errors, '---', ...lines.slice(-20)].join('\n');
  } catch { /* */ }
  const working = chains.filter((c) => c.ok).map((c) => c.pkg);
  const report = { complete: steps.length === 4 && steps.every((s) => s.ok) && working.length > 0, working, steps, chains, engine: runtime.state(), log };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { runMangaEngineSmoke, REPO, PKGS };
