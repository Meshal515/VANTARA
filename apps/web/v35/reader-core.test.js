import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PRIORITY,
  chapterSequence,
  chapterShort,
  createScheduler,
  neighbors,
  nextChapterPlan,
  normalizeSettings,
  readRatio,
} from './reader-core.js';

const row = (number, sourceId = 'a', url = `/c${number}`) => ({ number, sourceId, chapter: { url, name: `الفصل ${number}` } });

describe('ترتيب الفصول', () => {
  it('يرتّب من الأقدم ويعطي التالي والسابق', () => {
    const seq = chapterSequence([row(113), row(112), row(111)]);
    expect(seq.map((r) => r.number)).toEqual([111, 112, 113]);
    const { prev, next } = neighbors(seq, row(112));
    expect(prev.number).toBe(111);
    expect(next.number).toBe(113);
  });

  it('الفصل التالي من مصدر آخر في الوضع الذكي هو نفسه بالرقم', () => {
    const seq = chapterSequence([row(113, 'b'), row(112, 'a')]);
    expect(neighbors(seq, row(112, 'a')).next.sourceId).toBe('b');
  });

  it('آخر فصل لا تالي له', () => {
    const seq = chapterSequence([row(2), row(1)]);
    expect(neighbors(seq, row(2)).next).toBeNull();
  });

  it('الفصول بلا رقم تبقى بترتيبها ولا تصير «التالي» لكل شيء', () => {
    const seq = chapterSequence([row(-1, 'a', '/extra'), row(2), row(1)]);
    expect(seq.map((r) => r.chapter.url)).toEqual(['/c1', '/c2', '/extra']);
  });

  it('رقم الفصل وحده لنهاية الفصل', () => {
    expect(chapterShort(row(113))).toBe('113');
    expect(chapterShort({ number: -1, chapter: { name: 'خاص' } })).toBe('خاص');
  });
});

describe('نسبة القراءة', () => {
  it('أبعد صفحة رُئيت', () => {
    expect(readRatio(0, 10)).toBeCloseTo(0.1);
    expect(readRatio(9, 10)).toBe(1);
    expect(readRatio(4, 0)).toBe(0);
  });
});

describe('خطة الفصل التالي', () => {
  const wifi = { online: true, kind: 'unmetered', saveData: false };
  const cell = { online: true, kind: 'metered', saveData: false };
  const unknown = { online: true, kind: 'unknown', saveData: false };

  it('Wi-Fi: الفصل كاملًا', () => {
    expect(nextChapterPlan({ network: wifi })).toMatchObject({ pageList: true, images: Infinity });
  });
  it('بيانات الجوال: قائمة الصفحات فقط', () => {
    expect(nextChapterPlan({ network: cell })).toMatchObject({ pageList: true, images: 0 });
  });
  it('توفير البيانات يُحترم ولو على Wi-Fi', () => {
    expect(nextChapterPlan({ network: { ...wifi, saveData: true } })).toMatchObject({ images: 0 });
  });
  it('شبكة مجهولة: أول صفحات التالي فقط', () => {
    expect(nextChapterPlan({ network: unknown }).images).toBe(4);
  });
  it('«أوقف» لا يجلب شيئًا', () => {
    expect(nextChapterPlan({ mode: 'never', network: wifi })).toMatchObject({ pageList: false, images: 0 });
  });
  it('دون اتصال لا يجلب شيئًا', () => {
    expect(nextChapterPlan({ network: { online: false, kind: 'unknown', saveData: false } }).pageList).toBe(false);
  });
});

describe('طابور الصور', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('يبدأ الأعلى أولوية أولًا ويحترم عدد الخانات', async () => {
    const started = [];
    const gates = new Map();
    const s = createScheduler({
      concurrency: 1,
      run: (key) => {
        started.push(key);
        const d = deferred();
        gates.set(key, d);
        return d.promise;
      },
    });
    s.request('first', null, PRIORITY.CHAPTER);
    s.request('rest', null, PRIORITY.CHAPTER);
    s.request('visible', null, PRIORITY.VISIBLE);
    await tick();
    expect(started).toEqual(['first']);
    gates.get('first').resolve('ok');
    await tick();
    await tick();
    expect(started).toEqual(['first', 'visible']);
  });

  it('الطلب المكرّر يرجع نفس الوعد', async () => {
    let calls = 0;
    const s = createScheduler({ run: async () => ++calls });
    const a = s.request('k');
    const b = s.request('k');
    expect(a).toBe(b);
    expect(await a).toBe(1);
    expect(calls).toBe(1);
  });

  it('الفصل التالي لا ينافس صفحات الفصل الحالي', async () => {
    const started = [];
    const gates = new Map();
    const s = createScheduler({
      concurrency: 3,
      run: (key) => {
        started.push(key);
        const d = deferred();
        gates.set(key, d);
        return d.promise;
      },
    });
    s.request('cur-5', null, PRIORITY.NEAR);
    s.request('next-1', null, PRIORITY.NEXT_CHAPTER);
    await tick();
    // الحالي بدأ؛ التالي ينتظر رغم وجود خانات فارغة
    expect(started).toEqual(['cur-5']);
    gates.get('cur-5').resolve('ok');
    await tick();
    await tick();
    expect(started).toEqual(['cur-5', 'next-1']);
  });

  it('الفصل التالي يأخذ خانة واحدة فقط', async () => {
    const started = [];
    const s = createScheduler({
      concurrency: 3,
      run: (key) => {
        started.push(key);
        return new Promise(() => {});
      },
    });
    s.request('n1', null, PRIORITY.NEXT_CHAPTER);
    s.request('n2', null, PRIORITY.NEXT_CHAPTER);
    await tick();
    expect(started).toEqual(['n1']);
  });

  it('الفشل لا يُحفظ: إعادة الطلب تحاول من جديد', async () => {
    let calls = 0;
    const s = createScheduler({
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error('HTTP 503');
        return 'ok';
      },
    });
    await expect(s.request('p')).rejects.toThrow('HTTP 503');
    expect(await s.request('p')).toBe('ok');
  });

  it('الإلغاء يُسقط ما لم يبدأ', async () => {
    const s = createScheduler({ concurrency: 1, run: () => new Promise(() => {}) });
    s.request('a');
    const b = s.request('b');
    await tick();
    s.cancel((key) => key === 'b');
    await expect(b).rejects.toMatchObject({ cancelled: true });
    expect(s.has('b')).toBe(false);
  });
});

describe('الإعدادات', () => {
  it('التكبير مقفول افتراضيًا', () => {
    expect(DEFAULT_SETTINGS.doubleTapZoom).toBe(false);
    expect(DEFAULT_SETTINGS.pinchZoom).toBe(false);
  });
  it('قيمة غريبة تعود للافتراضي', () => {
    expect(normalizeSettings({ mode: 'sideways', gap: 999, pinchZoom: 'yes' })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ mode: 'paged', pinchZoom: true }).mode).toBe('paged');
  });
});
