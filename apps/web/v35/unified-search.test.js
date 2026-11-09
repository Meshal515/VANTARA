import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { createUnifiedSearch, runSearch, SEARCH_GROUPS } from './unified-search.js';

const { document } = parseHTML('<html><body></body></html>');
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

describe('البحث الموحد', () => {
  it('يبحث في الأنواع الثلاثة، وفشل نوع لا يُسقط غيره', async () => {
    const got = {};
    await runSearch('naruto', { anime: async () => [1, 2], manga: async () => { throw new Error('x'); }, cinema: async () => [3] }, (id, r) => { got[id] = r; });
    expect(Object.keys(got).sort()).toEqual(['anime', 'cinema', 'manga']);
    expect(got.anime.items).toEqual([1, 2]);
    expect(got.manga).toEqual({ items: [], error: true });
    expect(SEARCH_GROUPS.map((g) => g.id)).toEqual(['anime', 'manga', 'cinema']);
  });

  it('آخر استعلام يفوز: نتيجة قديمة متأخرة لا تكتب فوق الجديدة، وكل مجموعة تظهر حين تصل', async () => {
    const calls = [];
    const engines = Object.fromEntries(['anime', 'manga', 'cinema'].map((id) => [id, (q) => { const d = deferred(); calls.push({ id, q, d }); return d.p; }]));
    const mounted = [];
    const s = createUnifiedSearch({ el, glyph: () => '', engines, open: () => {}, mount: (n) => { document.body.append(n); mounted.push(n); }, card: (it) => ({ title: String(it), cover: null }), debounceMs: 0 });
    s.open();
    const first = s.search('one');
    const second = s.search('two');
    await Promise.resolve(); await Promise.resolve();
    calls.find((c) => c.q === 'two' && c.id === 'anime').d.resolve(['A2']);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const page = mounted[0];
    // الأنمي وصل والبقية هياكل بمقاسها
    expect(page.querySelector('.us-sec[data-group="anime"] .us-po').textContent).toContain('A2');
    expect(page.querySelectorAll('.us-sec[data-group="cinema"] .us-sk').length).toBeGreaterThan(0);
    calls.filter((c) => c.q === 'one').forEach((c) => c.d.resolve(['OLD']));
    calls.filter((c) => c.q === 'two' && c.id !== 'anime').forEach((c) => c.d.resolve([]));
    await Promise.all([first, second]);
    expect(page.textContent).not.toContain('OLD');
    expect(s.state().query).toBe('two');
    expect(page.querySelector('.us-sec[data-group="manga"] .us-none').textContent).toBe('لا نتائج');
  });
});
