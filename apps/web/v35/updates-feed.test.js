import { expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { mountTimeline } from './updates-view.js';
import { connectUpdates } from '../lib/update-engine.js';

/**
 * عمل نزل له عشرات الفصول يملأ صفحة الخادم وحده، فكانت الشبكة صفّين ثم تقف:
 * مراقب التمرير أطلق وهو يحمّل ولم يطلق ثانية. الآن تُطلب الصفحات حتى تمتلئ بأعمال.
 */
it('keeps loading pages until the grid has many works, even when one work floods a page', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  globalThis.document = document;
  // آخر القائمة ظاهر دائمًا: المراقب يبلّغ مرة كما في المتصفح، ولا يطلق ثانية
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([{ isIntersecting: true }]); } disconnect() {} };
  const NOW = Date.now();
  // 300 حدث: كل عمل له 30 فصلًا متتالية، فصفحة 100 حدث = 3–4 أعمال فقط
  const all = Array.from({ length: 300 }, (_, i) => ({
    id: `w${Math.floor(i / 30)}|c:${i % 30}`, work: `ext:w${Math.floor(i / 30)}`, section: 'manga', kind: 'chapter',
    number: 30 - (i % 30), title: `W${Math.floor(i / 30)}`, at: NOW - i * 1000, publishedAt: NOW - i * 1000, sources: [],
  }));
  const asked = [];
  connectUpdates(async (path) => {
    const q = new URL(`https://x${path}`).searchParams;
    asked.push(q.get('before'));
    const limit = Number(q.get('limit'));
    const start = q.get('before') ? all.findIndex((e) => `${e.at}~${e.id}` === q.get('before')) + 1 : 0;
    const events = all.slice(start, start + limit);
    const last = events[events.length - 1];
    return { status: 200, body: { events, snapshotAt: NOW, next: start + limit < all.length ? `${last.at}~${last.id}` : null } };
  });
  const host = document.createElement('div');
  document.body.append(host);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const api = mountTimeline(host, { section: 'manga', el, open: () => {}, empty: () => el('p', 'empty', 'لا شيء'), image: () => el('img') });
  for (let i = 0; i < 40 && host.querySelectorAll('.up-card').length < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  expect(host.querySelectorAll('.up-card').length).toBe(10);
  expect(asked.length).toBeGreaterThan(1);
  api.dispose();
});
