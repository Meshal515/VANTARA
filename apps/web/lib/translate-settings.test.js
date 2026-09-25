import { describe, expect, it } from 'vitest';
import { normalize, onTranslateSettings, readTranslateSettings, setTranslationLocked, translationLocked, writeTranslateSettings } from './translate-settings.js';
import { filePathFromSrc, renderPlan } from './translate.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('translation settings: off by default, auto or on demand', () => {
  it('is closed until the user opens it, and unknown values fall back safely', () => {
    expect(readTranslateSettings(memory())).toEqual({ enabled: false, mode: 'auto', speed: 'smart' });
    expect(normalize({ enabled: 'yes', mode: 'weird', speed: 'turbo' })).toEqual({ enabled: false, mode: 'auto', speed: 'smart' });
    expect(normalize({ enabled: true, mode: 'manual', speed: 'fast' })).toEqual({ enabled: true, mode: 'manual', speed: 'fast' });
  });

  it('writes a patch, keeps the rest, and tells listeners', () => {
    const storage = memory();
    const seen = [];
    const off = onTranslateSettings((s) => seen.push(s));
    expect(writeTranslateSettings({ enabled: true }, storage)).toEqual({ enabled: true, mode: 'auto', speed: 'smart' });
    expect(writeTranslateSettings({ mode: 'manual', speed: 'fast' }, storage)).toEqual({ enabled: true, mode: 'manual', speed: 'fast' });
    expect(readTranslateSettings(storage)).toEqual({ enabled: true, mode: 'manual', speed: 'fast' });
    expect(seen).toHaveLength(2);
    off();
  });
});

describe('on-device flow: Luna reply → what gets drawn', () => {
  const analysis = {
    regions: [
      { id: 'r1', kind: 'speech', source: 'HELLO', box: [1, 2, 3, 4] },
      { id: 'r2', kind: 'free', source: 'CLANG', box: [5, 6, 7, 8] },
      { id: 'r3', kind: 'speech', source: 'BYE', box: [9, 9, 9, 9] },
    ],
  };
  it('draws only regions Luna translated; sfx, credits and unanswered ids stay untouched', () => {
    const reply = {
      regions: [
        { id: 'r1', source: 'HELLO', kind: 'speech', arabic: 'مرحبًا', speaker: null },
        { id: 'r2', source: 'CLANG', kind: 'sfx', arabic: 'كلانغ', speaker: null },
        { id: 'zzz', source: 'x', kind: 'speech', arabic: 'مختلق', speaker: null },
      ],
    };
    expect(renderPlan(analysis, reply)).toEqual([{ id: 'r1', arabic: 'مرحبًا', kind: 'speech', source: 'HELLO' }]);
    expect(renderPlan(analysis, null)).toEqual([]);
  });

  it('recovers the on-device file path from a Capacitor image url', () => {
    expect(filePathFromSrc('http://localhost/_capacitor_file_/data/user/0/com.vantara.app/cache/pages/ab%20c.jpg')).toBe('/data/user/0/com.vantara.app/cache/pages/ab c.jpg');
    expect(filePathFromSrc('https://cdn.example/page.jpg')).toBeNull();
    expect(filePathFromSrc(null)).toBeNull();
  });
});

describe('translation locked for accounts it is not open to', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };

  it('a locked account sees translation off everywhere, whatever it chose, and gets it back when opened', () => {
    const storage = memory();
    writeTranslateSettings({ enabled: true, mode: 'manual' }, storage);
    const seen = [];
    const off = onTranslateSettings((s) => seen.push(s.enabled));
    setTranslationLocked(true, storage);
    expect(translationLocked(storage)).toBe(true);
    expect(readTranslateSettings(storage)).toEqual({ enabled: false, mode: 'manual', speed: 'smart' });
    setTranslationLocked(false, storage);
    expect(readTranslateSettings(storage).enabled).toBe(true);
    expect(seen).toEqual([false, true]);
    off();
  });
});
