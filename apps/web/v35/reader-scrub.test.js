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

describe('RD4: ورقة الفصول في القارئ', () => {
  it('تعلّم الفصل المقروء كما في صفحة العمل (isChapterRead عبر مراجع العمل)', () => {
    const sheet = js.slice(js.indexOf('function openChapters()'), js.indexOf('rd-chapter-choice__title'));
    expect(sheet).toContain('isChapterRead(sync, ref, keyOf(row))');
    expect(sheet).toContain("classList.add('is-read')");
    expect(css).toContain('.rd-chapter-choice.is-read');
  });
});

describe('القارئ على الكمبيوتر (RD1-RD3)', () => {
  it('RD1: الصفحة المكبّرة تُسحب بالماوس وتُكبَّر بالعجلة حول المؤشر وتُغلق بنقرتين', () => {
    const mouse = js.slice(js.indexOf('let mouseDrag = null'), js.indexOf("zoomEl.addEventListener('dblclick'") + 60);
    expect(mouse).toContain("e.pointerType !== 'mouse'");
    expect(mouse).toContain("zoomEl.addEventListener('wheel'");
    expect(mouse).toContain('zoomAround({ base: zoom.base, scale: zoom.scale, t: zoom.t, from: at, to: at');
    expect(mouse).toContain("addEventListener('dblclick', () => closeZoom())");
  });
  it('RD2: العمودي يستجيب للوحة المفاتيح فور الفتح (التركيز على حاوية التمرير بلا إطار)', () => {
    expect(js).toContain('scroll.focus({ preventScroll: true })');
    expect(css).toContain('.rd-scroll:focus { outline: none; }');
  });
  it('RD3: «صفحة صفحة» تقلّب بالمسافة وPageDown/PageUp والأسهم والعجلة، ولا تقلّب أثناء الكتابة في حقل', () => {
    const keys = js.slice(js.indexOf('const pagedStep'), js.indexOf("scroll.addEventListener('wheel', onWheel"));
    for (const k of ["'PageDown'", "'PageUp'", "e.key === ' '", "'ArrowDown'", "'ArrowUp'"]) expect(keys).toContain(k);
    expect(keys).toContain("closest?.('input, textarea");
    expect(keys).toContain('Math.abs(wheelSum) < 60');
  });
});
