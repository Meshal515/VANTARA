import { describe, expect, it } from 'vitest';
import { normalize, onTranslateSettings, readTranslateSettings, writeTranslateSettings } from './translate-settings.js';
import { filePathFromSrc, renderPlan } from './translate.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('translation settings: off by default, auto or on demand', () => {
  it('is closed until the user opens it, and unknown values fall back safely', () => {
    expect(readTranslateSettings(memory())).toEqual({ enabled: false, mode: 'auto' });
    expect(normalize({ enabled: 'yes', mode: 'weird' })).toEqual({ enabled: false, mode: 'auto' });
    expect(normalize({ enabled: true, mode: 'manual' })).toEqual({ enabled: true, mode: 'manual' });
  });

  it('writes a patch, keeps the rest, and tells listeners', () => {
    const storage = memory();
    const seen = [];
    const off = onTranslateSettings((s) => seen.push(s));
    expect(writeTranslateSettings({ enabled: true }, storage)).toEqual({ enabled: true, mode: 'auto' });
    expect(writeTranslateSettings({ mode: 'manual' }, storage)).toEqual({ enabled: true, mode: 'manual' });
    expect(readTranslateSettings(storage)).toEqual({ enabled: true, mode: 'manual' });
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
