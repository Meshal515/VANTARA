import { describe, expect, it } from 'vitest';
import { ART_CACHE_MAX, artCacheKeys, trimArtCache } from '../lib/together/art.js';
import { readAppearance, patchAppearance } from './appearance.js';
import { readStructure, setUnifyContent, writeStructure } from './experience.js';

/** تخزين بسقف مثل WebView: كتابة تتجاوز السقف ترمي QuotaExceededError. */
function quotaStorage(limit) {
  const m = new Map();
  const size = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    removeItem: (k) => { m.delete(k); },
    setItem(k, v) {
      const before = m.has(k) ? m.get(k) : undefined;
      m.set(k, String(v));
      if (size() > limit) { if (before === undefined) m.delete(k); else m.set(k, before); const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    },
  };
}

describe('خلل الـAPK: امتلاء التخزين بكاش الصور كان يُفشل حفظ الألوان والتوحيد بصمت', () => {
  it('تخزين ممتلئ بكاش الصور: تفعيل التوحيد واللون يُحفظان (الكاش يُخلى) ويبقيان بعد إعادة الفتح', () => {
    const s = quotaStorage(4000);
    for (let i = 0; ; i++) { try { s.setItem(`vantara.tgart.az4-${i}`, JSON.stringify({ at: i, data: 'x'.repeat(300) })); } catch { break; } }
    expect(artCacheKeys(s).length).toBeGreaterThan(5);
    writeStructure(setUnifyContent(readStructure(s), true), s);
    patchAppearance(() => ({ accent: { anime: 'rose' } }), s);
    // «إعادة فتح التطبيق»: قراءة من التخزين نفسه لا من ذاكرة الجلسة
    expect(JSON.parse(s.getItem('vantara.experience.v1')).unifyContent).toBe(true);
    expect(JSON.parse(s.getItem('vantara.appearance.v1')).accent.anime).toBe('rose');
    expect(readAppearance(s).accent.anime).toBe('rose');
  });

  it('ممتلئ بكاش غير الصور (الأعمال الموجودة): المرحلة الثانية تحرره، ومفاتيح المستخدم لا تُمس', () => {
    const s = quotaStorage(3000);
    s.setItem('vantara.watch.u1', 'progress'.repeat(20));
    // يُملأ حتى آخر حرف: أي مفتاح جديد يُرفض
    let n = 3000;
    while (n > 0) { try { s.setItem('vantara.anime.found.v2', 'x'.repeat(n)); break; } catch { n -= 1; } }
    expect(() => s.setItem('probe', 'x')).toThrow();
    writeStructure(setUnifyContent(readStructure(s), true), s);
    expect(JSON.parse(s.getItem('vantara.experience.v1')).unifyContent).toBe(true);
    expect(s.getItem('vantara.watch.u1')).toBe('progress'.repeat(20));
    expect(s.getItem('vantara.anime.found.v2')).toBeNull();
  });

  it('كاش الصور بسقف: الأقدم يُخلى أولًا', () => {
    const s = quotaStorage(1e9);
    for (let i = 0; i < ART_CACHE_MAX + 10; i++) s.setItem(`vantara.tgart.az4-${i}`, JSON.stringify({ at: i, data: 1 }));
    trimArtCache(ART_CACHE_MAX, s);
    const keys = artCacheKeys(s);
    expect(keys).toHaveLength(ART_CACHE_MAX);
    expect(keys).not.toContain('vantara.tgart.az4-0');
    expect(keys).toContain(`vantara.tgart.az4-${ART_CACHE_MAX + 9}`);
  });
});
