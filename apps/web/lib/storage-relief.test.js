import { describe, expect, it, vi } from 'vitest';
import { relieveStorage, saveWithRelief, storageReport } from './storage-relief.js';

// بلاغ المالك (20 نوفمبر): «مساحة التخزين ممتلئة» بعد التحديث. الكاش يُفسح قبل أن يُقال شيء.
function quotaStorage(limitChars) {
  const map = new Map();
  const used = () => [...map].reduce((t, [k, v]) => t + k.length + v.length, 0);
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const before = map.get(k);
      map.set(k, String(v));
      if (used() > limitChars) { if (before == null) map.delete(k); else map.set(k, before); throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }
    },
    removeItem: (k) => map.delete(k),
  };
}

describe('storage relief', () => {
  it('frees pure caches and retries, so a decision is saved without any warning', () => {
    const s = quotaStorage(1000);
    s.setItem('vantara.covers.v1', 'x'.repeat(400));
    s.setItem('vantara.tgart.az4-1', 'y'.repeat(300));
    s.setItem('vantara.manga.aliases.v1', 'z'.repeat(200));
    const warned = vi.fn();
    vi.stubGlobal('dispatchEvent', warned);
    vi.stubGlobal('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init?.detail; } });
    try {
      expect(saveWithRelief(s, 'vantara.art.v1', 'a'.repeat(500))).toBe(true);
      expect(warned).not.toHaveBeenCalled();
      expect(s.getItem('vantara.art.v1')).toHaveLength(500);
      expect(s.getItem('vantara.manga.aliases.v1')).toHaveLength(200); // بيانات المستخدم لا تُمس
      expect(s.getItem('vantara.covers.v1')).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it('never removes user data, and warns only when still full after relief', () => {
    const s = quotaStorage(600);
    for (const k of ['vantara.queue', 'vantara.manga.aliases.v1', 'vantara.unified.genre-art.v1', 'vantara.reader.settings']) s.setItem(k, 'u'.repeat(120));
    const warned = vi.fn();
    vi.stubGlobal('dispatchEvent', warned);
    vi.stubGlobal('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init?.detail; } });
    try {
      expect(relieveStorage(s)).toBe(0);
      expect(saveWithRelief(s, 'vantara.art.v1', 'a'.repeat(400))).toBe(false);
      expect(warned).toHaveBeenCalledTimes(1);
      expect(s.map.size).toBe(4);
    } finally { vi.unstubAllGlobals(); }
  });

  it('reports keys by size, largest first', () => {
    const s = quotaStorage(10_000);
    s.setItem('a', 'x'.repeat(10)); s.setItem('b', 'x'.repeat(100));
    expect(storageReport(s).map((r) => r.key)).toEqual(['b', 'a']);
  });
});
