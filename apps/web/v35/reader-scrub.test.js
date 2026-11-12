import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('./reader.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('./reader.css', import.meta.url), 'utf8');
const scrub = js.slice(js.indexOf('function bindScrub()'), js.indexOf('const activeClock'));

describe('شريط القارئ السفلي (قرار المالك)', () => {
  it('الصفحة تتحرك مع الإصبع أثناء السحب (إطار واحد لكل تغيير)، لا قفزة واحدة عند الإفلات', () => {
    const move = scrub.slice(scrub.indexOf('const move ='), scrub.indexOf('const stop ='));
    expect(move).toContain('requestAnimationFrame(follow)');
    expect(scrub.slice(scrub.indexOf('const follow ='), scrub.indexOf('const move ='))).toContain('jumpTo(want, false)');
    // الرقم «1 / 55» يتبع الإصبع، والتمرير تحته لا يرجعه
    expect(move).toContain("q('rdPageLabel').textContent");
    expect(js).toMatch(/if \(!scrubbing\) \{\s*q\('rdPageLabel'\)/);
  });
  it('الدائرة داخل المسار عند الطرفين: لا تُقص', () => {
    expect(js).toContain('calc((100% - 18px) *');
    const knob = css.slice(css.indexOf('.v35 .rd-knob {'), css.indexOf('}', css.indexOf('.v35 .rd-knob {')));
    expect(knob).toContain('translate: 0 0');
    expect(css).not.toContain("[dir='ltr'] .v35 .rd-knob { translate: -50% 0; }");
  });
  it('ضغط عنوان الفصل لا يرسم صندوقًا داكنًا، ويفتح قائمة الفصول', () => {
    expect(css).not.toMatch(/\.rd-titles--chapters:active \{ background: var\(--surface-2\)/);
    expect(js).toContain('data-act="chapters"');
    expect(js).toContain('chapters: () => openChapters()');
  });
  it('سحب دائرة الصفحات لا يخفي الأدوات: تمرير السحب وما يصل بعد الإفلات مستثنى (ملاحظة المالك، 10 نوفمبر)', () => {
    const at = js.indexOf('التمرير يُخفي الشريط');
    const onScroll = js.slice(at, js.indexOf('{ passive: true }', at));
    // الاستثناء قبل الإخفاء
    expect(onScroll.indexOf('if (scrubbing || performance.now() < scrubQuietUntil)')).toBeGreaterThan(-1);
    expect(onScroll.indexOf('if (scrubbing || performance.now() < scrubQuietUntil)')).toBeLessThan(onScroll.indexOf('setChrome(false)'));
    expect(scrub).toContain('scrubQuietUntil = performance.now() + 400');
  });
});
