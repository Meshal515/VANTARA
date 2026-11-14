import { expect, it, vi } from 'vitest';
vi.mock('./reader-translate.js', () => ({ createReaderTranslation: () => ({}) }));

/**
 * #311 H-001: كاش قوائم صفحات الفصول (24) كان FIFO: فصل يُعاد فتحه باستمرار يُطرد بعد 24 فصلًا جديدًا لأن
 * إعادة الاستعمال لا تجدد موضعه. الآن LRU: إعادة الاستعمال تنقله لآخر الترتيب.
 */
it('a chapter list reused all along survives 24 newer chapters (LRU, not FIFO)', async () => {
  vi.resetModules();
  const { warmChapter } = await import('./reader.js');
  const asked = [];
  const engine = { pages: async (_s, chapter) => { asked.push(chapter.url); return [{ url: `${chapter.url}/0` }]; }, pageImage: async () => ({ src: 'x' }) };
  const row = (n) => ({ sourceId: 's', chapter: { url: `/c/${n}` } });
  warmChapter(engine, row('A'), 0);
  for (let i = 0; i < 24; i++) {
    warmChapter(engine, row(i), 0);
    warmChapter(engine, row('A'), 0); // يُقرأ بين كل فصل جديد
  }
  await new Promise((r) => setTimeout(r, 0));
  warmChapter(engine, row('A'), 0);
  expect(asked.filter((u) => u === '/c/A')).toHaveLength(1);
});
