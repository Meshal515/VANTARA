// Exploratory QA harness: serves apps/web from the Debug worktree and mounts the real shell
// with an in-memory sync double. External metadata goes to the real network through the proxy.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export const ROOT = process.env.VANTARA_WEB ?? 'apps/web';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

export async function launch({ unified = false, section = 'manga', viewport = { width: 390, height: 844 }, rows = {}, slowMs = 0, block = [], record = null, mobile = true } = {}) {
  const index = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const css = [...index.matchAll(/href="(\/[^"]*\.css)"/g)].map((m) => m[1]);
  const fontCss = /<style>[\s\S]*?<\/style>/.exec(index)?.[0] ?? '';
  const server = createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://local').pathname;
      if (p === '/__ui') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${css.map((c) => `<link rel="stylesheet" href="${c}">`).join('')}${fontCss}<body><div id="root"></div></body></html>`);
      }
      const body = await readFile(path.join(ROOT, p));
      res.setHeader('Content-Type', TYPES[path.extname(p)] ?? 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined });
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1, locale: 'ar-SA', ...(record ? { recordVideo: { dir: record, size: viewport } } : {}) });
  const page = await context.newPage();
  const log = { errors: [], console: [], requests: [], failed: [] };
  page.on('pageerror', (e) => log.errors.push(String(e.stack || e).slice(0, 600)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin)) log.requests.push({ t: Date.now(), u, m: r.method(), body: r.postData()?.slice(0, 4000) ?? null }); });
  page.on('requestfailed', (r) => log.failed.push(`${r.url().slice(0, 140)} ${r.failure()?.errorText}`));
  if (slowMs || block.length) {
    await page.route((u) => !String(u).startsWith(origin), async (route) => {
      const u = route.request().url();
      if (block.some((b) => u.includes(b))) return route.abort();
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      return route.continue();
    });
  }
  await page.goto(origin + '/__ui');
  await page.evaluate(async ({ unified, section, rows }) => {
    localStorage.setItem('vantara.experience.v1', JSON.stringify({ v: 2, unifyContent: unified }));
    localStorage.setItem('vantara.section', section);
    const tables = { work_views: [], library: [], progress: [], collections: [], completions: [], ratings: [], notifications: [], chapter_marks: [], settings: [], accounts: [{ user_id: 'qa', display_name: 'QA', created_at: 1 }], ...rows };
    const listeners = new Set();
    const ops = [];
    const emit = (t) => { for (const fn of listeners) { try { fn(t); } catch (e) { console.error('onChange', e); } } };
    const sync = {
      user: { userId: 'qa', displayName: 'QA' }, ready: Promise.resolve(),
      rows: (t, p) => (tables[t] ?? []).filter(p || (() => true)),
      row: (t, id) => (tables[t] ?? []).find((r) => r.id === id || r.user_id === id) ?? null,
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      enqueue: (kind, payload) => {
        ops.push({ kind, payload, at: Date.now() });
        const now = Date.now();
        if (kind === 'library.add') { tables.library.push({ id: 'l' + now, user_id: 'qa', series_ref: payload.seriesRef, series_title: payload.seriesTitle, cover_url: payload.coverUrl, added_at: now, removed: 0 }); emit(['library']); }
        if (kind === 'library.remove') { for (const r of tables.library) if (r.series_ref === payload.seriesRef) r.removed = 1; emit(['library']); }
        if (kind === 'view.record' || kind === 'work.view') { tables.work_views = tables.work_views.filter((r) => r.series_ref !== payload.seriesRef); tables.work_views.push({ user_id: 'qa', series_ref: payload.seriesRef, series_title: payload.seriesTitle, cover_url: payload.coverUrl, chapter_label: payload.chapterLabel, viewed_at: now }); emit(['work_views']); }
        return Promise.resolve();
      },
      translation: async () => ({ status: 200, body: { rows: [], groups: [] } }),
      latestSnapshots: async () => ({ sources: [] }), presence: async () => [], stats: async () => ({}), insights: async () => ({}),
      topWorks: async () => [], pendingDevices: async () => [], privacyCapability: async () => ({}), authorizationHeader: null,
      refreshSession: async () => {}, attachNativeLinkBridge: () => {},
    };
    window.__ops = ops; window.__tables = tables; window.__emit = emit;
    const { mountV35 } = await import('/v35/shell.js');
    window.__shell = mountV35({ sync, mount: (n) => document.getElementById('root').replaceChildren(n), go: async (r) => { window.__go = r; }, friends: () => [], presence: async () => [], version: 'qa', switchAccount: () => {}, openReader: (...a) => { window.__reader = a; } }, { page: 'home' });
  }, { unified, section, rows });
  const close = async () => { await context.close(); await browser.close(); server.close(); };
  return { page, browser, context, origin, log, close };
}

/** Install a layout-shift + long-task + DOM-mutation recorder in the page. */
export async function instrument(page) {
  await page.evaluate(() => {
    window.__cls = []; window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), recent: e.hadRecentInput, src: (e.sources || []).slice(0, 3).map((s) => (s.node?.className || s.node?.id || s.node?.nodeName || '?').toString().slice(0, 60)) }); }).observe({ type: 'layout-shift', buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  });
}
export const snap = (page) => page.evaluate(() => ({
  active: document.querySelector('.page.active')?.id, y: Math.round(scrollY), h: document.documentElement.scrollHeight,
  section: document.querySelector('.v35')?.dataset.section, content: document.querySelector('.v35')?.dataset.content ?? null,
  transient: document.querySelectorAll('.page-out,.page-in').length,
}));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
