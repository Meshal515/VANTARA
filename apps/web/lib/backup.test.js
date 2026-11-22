import { describe, expect, it } from 'vitest';
import { collectBackup, parseBackup, planRestore, restoreBackup, serialize, summary, FORMAT } from './backup.js';

const ME = 'u-me';
/** مرآة مزامنة صغيرة بشكل lib/sync.js (rows/row/enqueue/push). */
function fakeSync(tables = {}, { online = true, userId = ME, supports = () => true } = {}) {
  const mirror = structuredClone(tables);
  const queue = [];
  const sent = [];
  return {
    user: userId ? { userId } : null,
    rows: (t, p = () => true) => Object.values(mirror[t] ?? {}).filter(p),
    row: (t, k) => mirror[t]?.[k] ?? null,
    enqueue: (kind, payload, opts) => { queue.push({ kind, payload, opts }); },
    push: async () => { if (online) sent.push(...queue.splice(0)); },
    get pendingWrites() { return queue.length; },
    supports,
    queue, sent,
  };
}

const source = () => ({
  library: { [`${ME}/w1`]: { user_id: ME, series_ref: 'w1', series_title: 'سولو', cover_url: 'https://img.example/1.jpg', source_id: 'ext.a#1', added_at: 10, removed: 0 }, [`${ME}/w2`]: { user_id: ME, series_ref: 'w2', removed: 1 }, ['other/w9']: { user_id: 'other', series_ref: 'w9', removed: 0 } },
  collections: { [`${ME}/favorite/w1`]: { user_id: ME, kind: 'favorite', series_ref: 'w1', position: 1, member: 1 }, [`${ME}/top/w2`]: { user_id: ME, kind: 'top', series_ref: 'w2', member: 0 } },
  completions: { [`${ME}/w3`]: { user_id: ME, series_ref: 'w3', member: 1 } },
  ratings: { [`${ME}/w1`]: { user_id: ME, series_ref: 'w1', score: 9, updated_at: 50 } },
  progress: { [`${ME}/w1#c1`]: { user_id: ME, chapter_key: 'w1#c1', series_ref: 'w1', page: 12, ratio: 0.6, updated_at: 30 }, [`${ME}/w1#c2`]: { user_id: ME, chapter_key: 'w1#c2', series_ref: 'w1', page: 3, ratio: 0.1, updated_at: 40 } },
  chapter_marks: { [`${ME}/w1#c0`]: { user_id: ME, chapter_key: 'w1#c0', series_ref: 'w1', read: 1, updated_at: 20 } },
  playback_positions: { [`${ME}/anime:a1#ep:3`]: { user_id: ME, media_key: 'anime:a1#ep:3', series_ref: 'anime:a1', position_ms: 600000, duration_ms: 1400000, watched_at: 77 } },
  settings: { [ME]: { user_id: ME, data: JSON.stringify({ readerMode: 'webtoon', translateApiKey: 'sk-secret', deviceName: 'pc' }) } },
});

describe('«نسختي»', () => {
  it('تجمع بيانات الحساب وحده بلا أسرار ولا معرّف حساب، وتُقرأ من جديد كما هي', async () => {
    const doc = await collectBackup({ sync: fakeSync(source()), now: () => 1000, platform: 'windows' });
    expect(doc.format).toBe(FORMAT);
    expect(doc.data.library.map((x) => x.seriesRef)).toEqual(['w1']);
    expect(doc.data.collections).toEqual([{ kind: 'favorite', seriesRef: 'w1', position: 1 }]);
    expect(doc.data.settings).toEqual({ readerMode: 'webtoon' });
    const text = serialize(doc);
    expect(text).not.toContain(ME);
    expect(text).not.toContain('sk-secret');
    const back = parseBackup(text);
    expect(back.data).toEqual(doc.data);
    expect(summary(back)).toEqual({ library: 1, lists: 2, ratings: 1, chapters: 3, positions: 1, settings: 1 });
  });

  it('ترفض ملفًا ليس نسخة فانتارا أو من إصدار أحدث، وتسقط الصفوف التالفة', () => {
    expect(() => parseBackup('{')).toThrow('ليس JSON');
    expect(() => parseBackup(JSON.stringify({ format: 'other' }))).toThrow('ليس ملف «نسختي»');
    expect(() => parseBackup(JSON.stringify({ format: FORMAT, version: 99 }))).toThrow('إصدار أحدث');
    const doc = parseBackup(JSON.stringify({ format: FORMAT, version: 1, data: { ratings: [{ seriesRef: 'w', score: 99 }], progress: [{ chapterKey: 'c', seriesRef: 'w', page: -5, ratio: 7 }], settings: { password: 'x', theme: 'dark' } } }));
    expect(doc.data.ratings).toEqual([]);
    expect(doc.data.progress[0]).toMatchObject({ page: 0, ratio: 1 });
    expect(doc.data.settings).toEqual({ theme: 'dark' });
  });

  it('على حساب فارغ: تعيد كل شيء بعمليات المزامنة المعتادة، والتقدم بترتيبه الأصلي', async () => {
    const doc = parseBackup(serialize(await collectBackup({ sync: fakeSync(source()) })));
    const ops = planRestore(doc, fakeSync({}));
    expect(ops.map(([k]) => k)).toEqual(['settings.patch', 'library.add', 'favorite.set', 'completed.set', 'rating.set', 'chapter.markMany', 'progress.set', 'progress.set', 'position.set']);
    expect(ops.find(([k]) => k === 'favorite.set')[1]).toMatchObject({ seriesRef: 'w1', member: true, seriesTitle: 'سولو' });
    expect(ops.filter(([k]) => k === 'progress.set').map(([, p]) => p.chapterKey)).toEqual(['w1#c1', 'w1#c2']);
  });

  it('لا تغلب الأحدث: ما عندك أحدث أو أكبر يبقى، والمكتمل ينقصه فقط', async () => {
    const doc = parseBackup(serialize(await collectBackup({ sync: fakeSync(source()) })));
    const newer = source();
    newer.ratings[`${ME}/w1`].updated_at = 99;
    newer.progress[`${ME}/w1#c1`].page = 40;
    newer.playback_positions[`${ME}/anime:a1#ep:3`].watched_at = 500;
    newer.settings[ME].data = JSON.stringify({ readerMode: 'paged' });
    delete newer.completions[`${ME}/w3`];
    const ops = planRestore(doc, fakeSync(newer));
    // التقييم والموضع والإعداد عندك أحدث، والفصلان عندك بقيمة أكبر أو مساوية: لا شيء منها يُعاد
    expect(ops.map(([k]) => k)).toEqual(['completed.set']);
    // فصل ناقص يُعاد وحده
    delete newer.progress[`${ME}/w1#c2`];
    expect(planRestore(doc, fakeSync(newer)).map(([k, p]) => `${k}:${p.chapterKey ?? p.seriesRef}`)).toEqual(['completed.set:w3', 'progress.set:w1#c2']);
  });

  it('ترسل دفعات وتتوقف بوضوح بلا اتصال، وإعادتها لا تكرر ما وصل', async () => {
    const doc = parseBackup(serialize(await collectBackup({ sync: fakeSync(source()) })));
    const online = fakeSync({});
    const seen = [];
    const out = await restoreBackup(doc, online, { batch: 4, onProgress: (p) => seen.push(p.done) });
    expect(out).toEqual({ restored: 9, total: 9, skipped: 0 });
    expect(seen).toEqual([0, 4, 8, 9]);
    expect(online.sent.every((op) => op.opts.requireDurable)).toBe(true);
    const offline = fakeSync({}, { online: false });
    await expect(restoreBackup(doc, offline, { batch: 4 })).rejects.toMatchObject({ code: 'RESTORE_OFFLINE', done: 0 });
    // خادم لم يُحدَّث بعد لمواضع التوقف: لا تُرسل ولا تُعزل، وتُعد «مؤجلة»
    const old = fakeSync({}, { supports: (f) => f !== 'position.set' });
    expect(await restoreBackup(doc, old)).toEqual({ restored: 8, total: 8, skipped: 1 });
  });

  it('تحتاج حسابًا: لا نسخة ولا استعادة بلا دخول', async () => {
    await expect(collectBackup({ sync: fakeSync({}, { userId: null }) })).rejects.toThrow('سجّل الدخول');
    expect(() => planRestore(parseBackup(JSON.stringify({ format: FORMAT, version: 1, data: {} })), fakeSync({}, { userId: null }))).toThrow('سجّل الدخول');
  });
});
