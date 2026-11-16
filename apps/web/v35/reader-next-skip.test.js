/**
 * بلاغ المالك (16 نوفمبر): «انتقال مفاجئ إلى الفصل 272». بلا اتصال (أو حين يظن WebView ذلك لحظة) كان «التالي» أقرب
 * فصل محمّل، فيُلحق بالتمرير بصمت ولو بعد مئات الفصول. يستخرج reach وnextOf من reader.js كما هما.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { neighbors } from './reader-core.js';

const source = readFileSync(new URL('./reader.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  const reach = (row) => {'), source.indexOf('  const ref = ctx.seriesRef;'));
const build = (sequence, local, onLine) => new Function('sequence', 'engine', 'globalThis', 'neighbors', `${code}; return nextOf;`)(
  sequence, { hasLocal: (_s, ch) => local.has(ch.url) }, { navigator: { onLine } }, neighbors);
const rows = [27, 28, 29, 272].map((n) => ({ number: n, sourceId: 's', chapter: { url: `c${n}` } }));

it('offline with chapter 28 not downloaded: the real next (28) is known as skipped, never a silent jump to 272', () => {
  const nextOf = build(rows, new Set(['c27', 'c272']), false);
  const { next, skipped } = nextOf(rows[0]);
  expect(next.number).toBe(272);
  expect(skipped.number).toBe(28); // appendNext لا يُلحق، وحد الفصل يقول «الفصل 28 غير محمّل» بزر صريح
});

it('online, or the next chapter is on the device: plain next, nothing skipped', () => {
  expect(build(rows, new Set(), true)(rows[0])).toMatchObject({ next: rows[1], skipped: null });
  expect(build(rows, new Set(['c27', 'c28']), false)(rows[0])).toMatchObject({ next: rows[1], skipped: null });
});

it('the reader never appends a skipped chapter by scrolling', () => {
  expect(source).toMatch(/if \(!next \|\| skipped \|\| seg\.next \|\| seg\.appending\) return;/);
});

// «تعليق شاشة فتح الفصل»: المحرك لا يرد ⇒ خطأ صريح بعد المهلة (فيُجرَّب مصدر آخر أو يظهر «إعادة المحاولة»)
it('a page list that never comes back fails with a timeout instead of loading forever', async () => {
  const { withDeadline, PAGES_TIMEOUT_MS } = await import('./reader-core.js');
  expect(PAGES_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  await expect(withDeadline(new Promise(() => {}), 20, 'المصدر ما ردّ')).rejects.toMatchObject({ code: 'timeout' });
  await expect(withDeadline(Promise.resolve([1]), 20, 'x')).resolves.toEqual([1]);
});
