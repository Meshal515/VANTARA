import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createStore, SPACES } from '../lib/idb-store.js';
import { createDesktopRuntime, migrateDesktopAddons } from './runtime.js';

// خطة التخزين، المرحلة 1: إضافات ويندوز وكاشها خرجا من localStorage إلى IndexedDB بلا فقد
function lsOf(entries) {
  const map = new Map(Object.entries(entries));
  return { map, get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}
const spaces = { ...SPACES, state: { ttlMs: Infinity, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024 } };
const installed = { list: [{ id: 'com.example.addon', manifest: { name: 'Example' }, enabled: true }] };
const legacy = () => lsOf({
  'vantara.desktop.state.addons.v1': JSON.stringify({ value: installed, expiresAt: null }),
  'vantara.desktop.state.addons.pins.v1': JSON.stringify({ value: { 'com.example.addon': 'sha' }, expiresAt: null }),
  'vantara.desktop.source.addon|["x","streams",{}]': JSON.stringify({ value: { data: 'y'.repeat(5000) }, expiresAt: 1 }),
  'vantara.desktop.meta.home': JSON.stringify({ value: { big: 'z'.repeat(5000) }, expiresAt: null }),
  'vantara.appearance.v1': '{"theme":"dark"}',
});

describe('Windows extensions storage migration', () => {
  it('copies installed extensions and their settings, verifies them, keeps the old copy, and drops only the old cache', async () => {
    const ls = legacy();
    const db = createStore({ name: 'm1', indexedDB: new IDBFactory(), spaces });
    const report = await migrateDesktopAddons(ls, db);
    expect(report).toMatchObject({ moved: 2, failed: [], dropped: 2 });
    expect((await db.get('state', 'addons.v1')).value).toEqual(installed);
    expect((await db.get('state', 'addons.pins.v1')).value).toEqual({ 'com.example.addon': 'sha' });
    expect(ls.map.has('vantara.desktop.state.addons.v1')).toBe(true); // احتياط
    expect([...ls.map.keys()].some((k) => k.startsWith('vantara.desktop.source.') || k.startsWith('vantara.desktop.meta.'))).toBe(false);
    expect(ls.map.get('vantara.appearance.v1')).toBe('{"theme":"dark"}'); // غير الإضافات لا يُمس
  });

  it('runs once: a later change in the new store is never overwritten by the old copy', async () => {
    const ls = legacy();
    const db = createStore({ name: 'm2', indexedDB: new IDBFactory(), spaces });
    await migrateDesktopAddons(ls, db);
    await db.set('state', 'addons.v1', { list: [] }); // أزال المستخدم الإضافة
    expect((await migrateDesktopAddons(ls, db)).moved).toBe(0);
    expect((await db.get('state', 'addons.v1')).value).toEqual({ list: [] });
  });

  it('a lost new database is restored from the kept copy', async () => {
    const ls = legacy();
    await migrateDesktopAddons(ls, createStore({ name: 'm3', indexedDB: new IDBFactory(), spaces }));
    const fresh = createStore({ name: 'm3b', indexedDB: new IDBFactory(), spaces });
    expect((await migrateDesktopAddons(ls, fresh)).moved).toBe(2);
    expect((await fresh.get('state', 'addons.v1')).value).toEqual(installed);
  });

  it('a failed write leaves the old copy intact and retries next start', async () => {
    const ls = legacy();
    const real = createStore({ name: 'm4', indexedDB: new IDBFactory(), spaces });
    const broken = { ...real, set: async (ns, key, value) => (key === 'addons.v1' ? false : real.set(ns, key, value)) };
    const report = await migrateDesktopAddons(ls, broken);
    expect(report.failed).toEqual(['addons.v1']);
    expect(ls.map.has('vantara.desktop.state.addons.v1')).toBe(true);
    expect((await migrateDesktopAddons(ls, real)).moved).toBe(1);
    expect((await real.get('state', 'addons.v1')).value).toEqual(installed);
  });

  it('the runtime reads extensions only after the migration, and new writes never touch localStorage', async () => {
    const ls = legacy();
    const runtime = createDesktopRuntime({ bridge: { requestResource: async () => ({ status: 200, text: '{}' }) }, storage: ls, indexedDB: new IDBFactory() });
    expect((await runtime.addonStore.get('state', 'addons.v1')).value).toEqual(installed);
    await runtime.addonStore.set('source', 'addon|new', { data: 'x'.repeat(10_000), expiresAt: Date.now() + 60_000 }, { ttlMs: 60_000 });
    expect([...ls.map.keys()].some((k) => k.includes('addon|new'))).toBe(false);
  });
});
