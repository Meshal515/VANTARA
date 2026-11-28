import { describe, expect, it, vi } from 'vitest';
import { latestAllowed, latestIdentity, startLatestRunner } from './latest-runner.js';

describe('تشغيل المحرك: والتطبيق مفتوح فقط، وبعد الهجرة', () => {
  const timers = () => { const q = []; return { q, setTimer: (fn, ms) => { q.push({ fn, ms }); return q.length; }, clearTimer: () => {} }; };
  const store = { getSnapshot: async () => null, putSnapshots: async () => {}, getMeta: async () => null, setMeta: async () => {} };
  it('لا دورة قبل اكتمال الهجرة ولا والتطبيق مخفي، والراحة 30 دقيقة بعد نهاية الدورة', async () => {
    const t = timers(); const providers = vi.fn(async () => []); let ready = false; const doc = { visibilityState: 'visible' };
    startLatestRunner({ store, ready: () => ready, doc, providers, ...t, firstDelayMs: 5 });
    await t.q.at(-1).fn();
    expect(providers).not.toHaveBeenCalled();
    ready = true; doc.visibilityState = 'hidden';
    await t.q.at(-1).fn();
    expect(providers).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    await t.q.at(-1).fn();
    expect(providers).toHaveBeenCalledTimes(1);
    expect(t.q.at(-1).ms).toBe(30 * 60_000);
  });
  it('الهوية: المانجا كالخادم حرفيًا، والأنمي والسينما لا تنشئ أحداثًا قبل حلّال الهوية', () => {
    expect(latestIdentity({ section: 'manga' }, { title: 'One Piece' })).toMatch(/^ext:/);
    expect(latestIdentity({ section: 'anime' }, { title: 'One Piece' })).toBeNull();
    expect(latestAllowed({ section: 'manga', key: 'unknown.src' }, { title: 'x', ref: { title: 'x' } })).toBe(false);
  });
});

describe('الخيطان بالأحداث لا بالدورة', () => {
  const timers = () => { const q = []; return { q, setTimer: (fn, ms) => { q.push({ fn, ms }); return q.length; }, clearTimer: () => {} }; };
  const store = { getSnapshot: async () => null, putSnapshots: async () => {}, getMeta: async () => null, setMeta: async () => {} };
  it('ما يُكشف يُرفع بعد ثانيتين مجمّعًا، والإشارات تُسحب عند الظهور', async () => {
    const t = timers(); const doc = { visibilityState: 'visible', handlers: {}, addEventListener(n, f) { this.handlers[n] = f; }, removeEventListener() {} };
    const send = vi.fn(async () => ({ status: 200, body: { signals: [], next: 0 } }));
    const r = startLatestRunner({ store, ready: () => true, doc, providers: vi.fn(async () => []), send, ...t, firstDelayMs: 5 });
    // مؤقت الرفع عند الإقلاع (5 ث) ومؤقت الإشارات (5 د) قبل مؤقت الدورة
    expect(t.q.map((x) => x.ms)).toEqual(expect.arrayContaining([5 * 60_000, 5_000]));
    doc.handlers.visibilitychange();
    await new Promise((res) => setTimeout(res, 0));
    expect(send.mock.calls.some(([p]) => String(p).startsWith('/v1/latest/signals'))).toBe(true);
    r.stop();
  });
});
