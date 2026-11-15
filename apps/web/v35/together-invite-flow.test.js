import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// طبقة الأوراق واحدة (shell.openSheet يغلق الحالية): فتح ورقة الدعوة من ورقة السيرفرات
// يغلقها ويوقف تجهيزها. لو اكتفت onStarted بتعليم الورقة المغلقة لبقي المضيف على صفحة
// العمل بعد «انرسلت الدعوة» ولا تُفتح الغرفة (ما حدث على الجهاز). يجب أن تعيد فتح الورقة.
const source = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('الدعوة من ورقة السيرفرات تدخل الغرفة', () => {
  it('الأفلام والمسلسلات: onStarted يعيد فتح ورقة السيرفرات', () => {
    expect(source('cinema.js')).toMatch(/onStarted: \(\) => play\(m, season, n, 0, \{ hostPick: true \}\)/);
  });
  it('الأنمي: onStarted يعيد فتح ورقة السيرفرات', () => {
    expect(source('anime.js')).toMatch(/onStarted: \(\) => playEpisode\(m, n, \{ hostPick: true \}\)/);
  });
  // قرار المالك (14 نوفمبر): بعد إنشاء الغرفة تبقى ورقة السيرفرات العادية (سيدرز وسرب) والمضيف يختار؛
  // التشغيل التلقائي لأول سيرفر جاهز للمدعو الداخل من البطاقة أو الإشعار فقط.
  // تحديث القرار نفسه (14 نوفمبر، لاحقًا): الغرفة أولًا للجميع — لا تشغيل تلقائي لأحد. في الجوال يُفتح المشغّل الأصلي
  // على الغرفة بلا سيرفر (pick) فور بدء جلسة التجهيز، والمضيف والمدعو يختاران سيرفرهما منها.
  it('الغرفة أولًا للجميع: بلا تشغيل تلقائي، والمشغّل الأصلي يُفتح بلا سيرفر ليختار من الغرفة', () => {
    for (const name of ['anime.js', 'cinema.js']) {
      const src = source(name);
      expect(src).not.toContain('autoTogether');
      expect(src).toContain('sheet.roomFirst = Boolean(hub?.matches(');
      expect(src).toContain('void launch(null, null)');
      expect(src).toContain('pick: candidate == null');
    }
  });
  it('ورقة جديدة تغلق السابقة (سبب إعادة الفتح)', () => {
    // Lifecycle lives in sheet-lifecycle.js: new sheet calls close() first.
    expect(source('shell.js')).toContain('const openSheet = sheetController.open;');
    expect(source('sheet-lifecycle.js')).toMatch(/function open\(build, \{ tone = null, full = false \} = \{\}\) \{\n\s+close\(\);/);
  });
});
