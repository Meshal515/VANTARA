import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createIndexedDbBackend, mergeEvent, normalizeEvent, openLatestStore } from './latest-store.js';

const require = createRequire(import.meta.url);
const desktop = require('../../desktop/latest-store.cjs');
const dirs = [];
const sqliteBackend = () => { const dir = mkdtempSync(join(tmpdir(), 'vantara-latest-')); dirs.push(dir); const s = desktop.createSqliteLatestStore({ dir }); return { kind: 'sqlite-desktop', dir, ...s }; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

let n = 0;
const ev = (o = {}) => ({ id: `e${++n}`, work: 'w1', section: 'manga', kind: 'chapter', number: 10, title: 'عمل', at: 1000, firstSeenAt: 1000, sources: [{ s: 'src.a' }], ...o });

// العقد نفسه على الخلفيتين: أي اختلاف سلوك بين ويندوز والويب يفشل هنا
for (const [name, make] of [['IndexedDB', () => createIndexedDbBackend(indexedDB)], ['SQLite (ويندوز)', sqliteBackend]]) {
  describe(`مخزن آخر التحديثات — ${name}`, () => {
    it('يحفظ ويعيد الخط الزمني الأحدث أولًا بمؤشر ثابت، ولا يخلط الأقسام', async () => {
      const s = openLatestStore({ account: `a-${name}-1`, backend: make() });
      await s.putEvents([ev({ id: 'x1', at: 100 }), ev({ id: 'x2', at: 300 }), ev({ id: 'x3', at: 200 }), ev({ id: 'x4', at: 300, section: 'anime', kind: 'episode' })]);
      const p1 = await s.timeline('manga', { limit: 2 });
      expect(p1.events.map((e) => e.id)).toEqual(['x2', 'x3']);
      expect(p1.next).toBe('200~x3');
      const p2 = await s.timeline('manga', { limit: 2, before: p1.next });
      expect(p2.events.map((e) => e.id)).toEqual(['x1']);
      expect(p2.next).toBeNull();
      expect((await s.timeline('anime')).events.map((e) => e.id)).toEqual(['x4']);
    });

    it('الدمج: الأقدم وقتًا يفوز، والمصادر اتحاد، والتثبيت لا يسقط بكتابة لاحقة', async () => {
      const s = openLatestStore({ account: `a-${name}-2`, backend: make() });
      await s.putEvents([ev({ id: 'm', at: 500, firstSeenAt: 500, sources: [{ s: 'a' }] })], { pinned: true, origin: 'migrated' });
      const r = await s.putEvents([ev({ id: 'm', at: 400, firstSeenAt: 400, sources: [{ s: 'b' }] })]);
      expect(r).toMatchObject({ inserted: 0, updated: 1 });
      const e = await s.getEvent('m');
      expect(e.at).toBe(400);
      expect(e.sources.map((x) => x.s)).toEqual(['a', 'b']);
      expect(e.pinned).toBe(true);
      expect(e.origin).toBe('migrated');
      await s.putEvents([ev({ id: 'm', at: 900 })]);
      expect((await s.getEvent('m')).at).toBe(400);
    });

    it('كل حساب في قاعدة منفصلة', async () => {
      const b = make();
      const one = openLatestStore({ account: `p-${name}`, backend: b }), two = openLatestStore({ account: `q-${name}`, backend: b });
      await one.putEvents([ev({ id: 'only-one' })]);
      expect((await two.timeline('manga')).events).toEqual([]);
      expect((await one.timeline('manga')).events).toHaveLength(1);
    });

    it('يرفض الحدث الناقص بدل حفظ نصفه، ويعدّه', async () => {
      const s = openLatestStore({ account: `a-${name}-3`, backend: make() });
      const r = await s.putEvents([ev({ id: 'ok' }), { id: 'bad', work: 'w' }, ev({ id: 'bad2', section: 'other' })]);
      expect(r).toMatchObject({ inserted: 1, rejected: 2 });
    });

    it('خطوط الأساس لكل عمل ولكل مصدر، واللقطات، والإعدادات، والإحصاء', async () => {
      const s = openLatestStore({ account: `a-${name}-4`, backend: make() });
      await s.putMarks([{ work: 'w1', section: 'manga', season: null, number: 12, baselineAt: 1, updatedAt: 2 }]);
      expect(await s.getMarks(['w1', 'nope'])).toMatchObject([{ work: 'w1', number: 12 }]);
      await s.putSourceMarks([{ work: 'w1', sourceId: 'b', number: 11 }, { work: 'w1', sourceId: 'a', number: 12 }]);
      expect((await s.getSourceMarks('w1')).map((m) => [m.sourceId, m.number]).sort()).toEqual([['a', 12], ['b', 11]]);
      await s.putSnapshots([{ sourceId: 'src.a', payload: { items: [1, 2] }, fetchedAt: 5 }]);
      expect(await s.getSnapshot('src.a')).toMatchObject({ payload: { items: [1, 2] }, fetchedAt: 5 });
      await s.setMeta('migration', { page: 3 });
      expect(await s.getMeta('migration')).toEqual({ page: 3 });
      await s.putEvents([ev({ id: 's1' })], { pinned: true }); await s.putEvents([ev({ id: 's2' })]);
      expect(await s.stats()).toMatchObject({ events: 2, pinned: 1, marks: 1 });
    });

    it('الشكل الخارج نفس شكل /v1/updates (بلا حقول داخلية)', async () => {
      const s = openLatestStore({ account: `a-${name}-5`, backend: make() });
      await s.putEvents([ev({ id: 'shape', publishedAt: 77, observedAdvance: true, cover: 'https://x/c.jpg' })], { pinned: true });
      const [e] = (await s.timeline('manga')).events;
      expect(Object.keys(e).sort()).toEqual(['at', 'cover', 'firstSeenAt', 'id', 'kind', 'number', 'observedAdvance', 'publishedAt', 'season', 'section', 'sources', 'title', 'work'].sort());
    });
  });
}

describe('خلفية ويندوز (SQLite)', () => {
  it('تبقى بعد إغلاق التطبيق وإعادة فتحه (ملف دائم)، واسم الملف لا يكشف الحساب', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vantara-latest-')); dirs.push(dir);
    const first = desktop.createSqliteLatestStore({ dir });
    await openLatestStore({ account: 'user-123', backend: first }).putEvents([ev({ id: 'durable' })]);
    first.close();
    const again = openLatestStore({ account: 'user-123', backend: desktop.createSqliteLatestStore({ dir }) });
    expect((await again.getEvent('durable'))?.id).toBe('durable');
    expect(readdirSync(dir).join()).not.toContain('user-123');
  });
  it('القناة لا تقبل إلا أسماء العمليات المعروفة، ولا عملية حذف أصلًا', () => {
    const s = sqliteBackend();
    expect(() => s.call({ method: 'exec', args: {} })).toThrow();
    for (const m of ['deleteEvents', 'prune', 'clear', 'drop']) expect(() => s.call({ method: m })).toThrow();
  });
  it('قاعدة الدمج في ويندوز مطابقة لقاعدة الويب', () => {
    const a = normalizeEvent(ev({ id: 'z', at: 5, sources: [{ s: 'a' }] }), { pinned: true, now: 1 });
    const b = normalizeEvent(ev({ id: 'z', at: 3, sources: [{ s: 'b' }] }), { now: 2 });
    expect(desktop.mergeEvent(a, b)).toEqual(mergeEvent(a, b));
  });
});

describe('أندرويد (LatestStorePlugin.kt) يطابق ويندوز', () => {
  const kt = require('node:fs').readFileSync(join(__dirname, '../../../android/app/src/main/kotlin/com/vantara/plugins/LatestStorePlugin.kt'), 'utf8');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  it('نص المخطط نفسه وإصداره', () => {
    const schema = kt.match(/val SCHEMA = """([\s\S]*?)"""/)[1];
    expect(norm(schema)).toBe(norm(desktop.SCHEMA));
    expect(Number(kt.match(/const val SCHEMA_VERSION = (\d+)/)[1])).toBe(desktop.SCHEMA_VERSION);
  });
  it('أسماء العمليات نفسها في القناتين، ولا حذف في أي منهما', () => {
    const ktMethods = [...kt.match(/val METHODS = setOf\(([^)]*)\)/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    const js = require('node:fs').readFileSync(join(__dirname, '../../desktop/latest-store.cjs'), 'utf8');
    const deskMethods = [...js.match(/const METHODS = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(ktMethods).toEqual(deskMethods);
    expect(ktMethods.join()).not.toMatch(/delete|prune|clear|drop|remove/i);
  });
});
