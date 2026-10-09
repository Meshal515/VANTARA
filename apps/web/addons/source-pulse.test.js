import { describe, expect, it, vi } from 'vitest';
import { createSourcePulse, pulseView } from './source-pulse.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

describe('نبض المصدر', () => {
  it('يسجّل النجاح والفراغ والفشل من طلبات حقيقية، والإلغاء ليس عطلًا', async () => {
    let t = 1000;
    const pulse = createSourcePulse({ storage: memory(), now: () => t });
    await pulse.measure('core|a', async () => { t += 800; return { mangas: [1, 2] }; });
    expect(pulse.get('core|a')).toMatchObject({ state: 'ok', ms: 800, items: 2, failures: 0 });
    await pulse.measure('core|b', async () => []);
    expect(pulse.get('core|b').state).toBe('empty');
    await expect(pulse.measure('core|c', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(pulse.get('core|c')).toMatchObject({ state: 'failed', failures: 1, error: 'boom' });
    await expect(pulse.measure('core|d', async () => { throw new DOMException('x', 'AbortError'); })).rejects.toThrow();
    expect(pulse.get('core|d')).toBeNull();
  });

  it('يبقى بين الجلسات على الجهاز', () => {
    const storage = memory();
    createSourcePulse({ storage }).record('core|a', 'ok', { ms: 10 });
    expect(createSourcePulse({ storage }).get('core|a').state).toBe('ok');
  });

  it('الإصلاح الذاتي: يعيد فحص الفاشل بمهلة تتضاعف، والسليم كل 30 دقيقة', () => {
    let t = 0;
    const pulse = createSourcePulse({ storage: memory(), now: () => t });
    expect(pulse.due('core|new')).toBe(true);
    pulse.record('core|a', 'ok');
    t = 29 * 60_000; expect(pulse.due('core|a')).toBe(false);
    t = 30 * 60_000; expect(pulse.due('core|a')).toBe(true);
    t = 0;
    pulse.record('core|x', 'failed');
    t = 59_000; expect(pulse.due('core|x')).toBe(false);
    t = 60_000; expect(pulse.due('core|x')).toBe(true);
    pulse.record('core|x', 'failed'); // الثانية: دقيقتان
    t = 60_000 + 119_000; expect(pulse.due('core|x')).toBe(false);
    t = 60_000 + 120_000; expect(pulse.due('core|x')).toBe(true);
  });

  it('ما يراه المستخدم: يعمل بزمنه، متعثّر إن نجح قريبًا، لا يستجيب إن طال', () => {
    const now = 10 * 3600_000;
    expect(pulseView({ state: 'ok', at: now - 180_000, ms: 820 }, { now })).toEqual({ level: 'ok', label: 'يعمل', detail: '0.8 ث · قبل 3 د' });
    expect(pulseView({ state: 'failed', at: now, failures: 1, lastOkAt: now - 3600_000 }, { now }).label).toBe('متعثّر');
    expect(pulseView({ state: 'failed', at: now, failures: 3, lastOkAt: null }, { now })).toMatchObject({ level: 'failed', label: 'لا يستجيب', detail: 'الآن · 3 محاولات' });
    expect(pulseView(null).label).toBe('لم يُفحص بعد');
    expect(pulseView(null, { checking: true }).level).toBe('checking');
  });
});

it('ينهي الطلب العالق ولا يسمح لنتيجة متأخرة بتغيير حالة المصدر', async () => {
  vi.useFakeTimers();
  try {
    const pulse = createSourcePulse({ storage: memory() });
    let finish;
    const result = pulse.measure('core|slow', () => new Promise(r => { finish = r; }), { timeoutMs: 100 });
    const check = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(pulse.get('core|slow').state).toBe('failed');
    finish({ items: [1] });
    await Promise.resolve();
    expect(pulse.get('core|slow').state).toBe('failed');
  } finally { vi.useRealTimers(); }
});
it('إلغاء الفحص يفك الطلب حتى لو تجاهل المصدر إشارة الإلغاء', async () => {
  const pulse = createSourcePulse({ storage: memory() });
  const controller = new AbortController();
  const result = pulse.measure('core|slow', () => new Promise(() => {}), { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(pulse.get('core|slow')).toBeNull();
});
