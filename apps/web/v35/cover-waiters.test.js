/**
 * ST1 (تدقيق §14) وبلاغ المالك (16 نوفمبر، صور «آخر التحديثات»): البطاقة تطلب غلافها قبل إلحاقها بالقائمة، وكنس
 * المنتظرين المنزوعين (عند 120) كان يحذف بطاقات الدفعة نفسها فيبقى هيكلها فارغًا للأبد حتى تخرج وترجع.
 * يستخرج nearViewport وsweepDetached من shell.js كما هما ويشغّلهما على مراقب مُحاكى.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
const pick = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

it('cards whose cover was requested before they joined the page still get their cover', async () => {
  const observed = new Set();
  let callback;
  class FakeObserver { constructor(cb) { callback = cb; } observe(n) { observed.add(n); } unobserve(n) { observed.delete(n); } }
  const code = pick('const nearWaiters = new Map();', '  /**\n   * قرار فن العمل الواحد');
  const make = new Function('IntersectionObserver', 'Date', `${code}; return nearViewport;`);
  const nearViewport = make(FakeObserver, Date);
  // 300 بطاقة تُبنى قبل إلحاقها (كما في updates-view: row ← mountCover ثم insertBefore)
  const cards = Array.from({ length: 300 }, () => ({ isConnected: false }));
  let resolved = 0;
  for (const card of cards) void nearViewport(card).then(() => { resolved += 1; });
  for (const card of cards) card.isConnected = true; // أُلحقت كلها في الرسمة نفسها
  callback(cards.map((target) => ({ target, isIntersecting: true })));
  await new Promise((r) => setTimeout(r, 0));
  expect(resolved).toBe(300);
});

it('cards that really left the page are still swept, so waiters stay bounded', async () => {
  let now = 1_000_000;
  const FakeDate = { now: () => now };
  const observed = new Set();
  class FakeObserver { observe(n) { observed.add(n); } unobserve(n) { observed.delete(n); } }
  const code = pick('const nearWaiters = new Map();', '  /**\n   * قرار فن العمل الواحد');
  const nearViewport = new Function('IntersectionObserver', 'Date', `${code}; return nearViewport;`)(FakeObserver, FakeDate);
  const gone = Array.from({ length: 150 }, () => ({ isConnected: false }));
  for (const card of gone) void nearViewport(card);
  now += 60_000; // قائمة أُعيد رسمها منذ دقيقة: هذه البطاقات منزوعة فعلًا
  void nearViewport({ isConnected: true });
  expect(observed.size).toBe(1);
});
