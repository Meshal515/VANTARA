import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// طبقة الأوراق واحدة (shell.openSheet يغلق الحالية): فتح ورقة الدعوة من ورقة السيرفرات
// يغلقها ويوقف تجهيزها. لو اكتفت onStarted بتعليم الورقة المغلقة لبقي المضيف على صفحة
// العمل بعد «انرسلت الدعوة» ولا تُفتح الغرفة (ما حدث على الجهاز). يجب أن تعيد فتح الورقة.
const source = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('الدعوة من ورقة السيرفرات تدخل الغرفة', () => {
  it('الأفلام والمسلسلات: onStarted يعيد فتح ورقة السيرفرات', () => {
    expect(source('cinema.js')).toMatch(/onStarted: \(\) => play\(m, season, n\)/);
  });
  it('الأنمي: onStarted يعيد فتح ورقة السيرفرات', () => {
    expect(source('anime.js')).toMatch(/onStarted: \(\) => playEpisode\(m, n\)/);
  });
  it('ورقة جديدة تغلق السابقة (سبب إعادة الفتح)', () => {
    // Lifecycle lives in sheet-lifecycle.js: new sheet calls close() first.
    expect(source('shell.js')).toContain('const openSheet = sheetController.open;');
    expect(source('sheet-lifecycle.js')).toMatch(/function open\(build, \{ tone = null, full = false \} = \{\}\) \{\n\s+close\(\);/);
  });
});
