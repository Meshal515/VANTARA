import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_FULL_BLEED } from './cinema.js';

// قواعد CSS لرئيسية السينما: كل قاعدة تُقرأ بمحدّدها كما هي في الملف
const css = readFileSync(new URL('./cinema.css', import.meta.url), 'utf8');
// المحدّد قد يتكرر في الملف (الحركة في قاعدة والتخطيط في أخرى): نجمع كل قواعده
const rule = (selector) => {
  const out = [];
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) out.push(css.slice(at, css.indexOf('}', at)));
  expect(out.length, selector).toBeGreaterThan(0);
  return out.join('\n');
};

describe('بانر السينما: نفس التخطيط لكل شريحة', () => {
  it('إطار الصورة بنسبة ثابتة والصور تملؤه مهما اختلف مقاسها', () => {
    expect(rule('.v35 .cn-bill-stage')).toMatch(/aspect-ratio:\s*16 \/ 10/);
    expect(rule('.v35 .cn-img')).toMatch(/object-fit:\s*cover/);
    expect(rule('.v35 .cn-bill-img')).toMatch(/position:\s*absolute/);
  });
  it('خانة الشعار والسطور والأزرار بارتفاعات ثابتة لا دنيا', () => {
    expect(rule('.v35 .cn-bill-mark')).toMatch(/\bheight:\s*72px/);
    expect(rule('.v35 .cn-bill-mark .cn-mark-logo')).toMatch(/max-height:\s*100%/);
    const info = rule('.v35 .cn-bill-info');
    expect(info).toMatch(/\bheight:\s*var\(--cn-bill-info-h\)/);
    expect(info).not.toMatch(/min-height/);
    expect(rule('.v35 .cn-bill .cn-facts')).toMatch(/\bheight:\s*20px/);
    expect(rule('.v35 .cn-bill-genres')).toMatch(/\bheight:\s*18px/);
    expect(rule('.v35 .cn-bill-actions')).toMatch(/\bheight:\s*46px/);
  });
});

describe('بطاقة «أكمل المشاهدة»: ⋮ تابع لبطاقته', () => {
  it('الاسم لا يتمدد فيدفع ⋮ إلى حافة البطاقة، و⋮ لا يخرج عن حدودها', () => {
    expect(rule('.v35 .cn-wide .cw-name .cn-wide-title')).toMatch(/flex:\s*0 1 auto/);
    expect(rule('.v35 .cn-wide .cw-name .cw-more')).toMatch(/margin:\s*-4px 0 0/);
  });
});

describe('أسماء الصفوف: محاذاة واحدة وقصّ بـ«…»', () => {
  it('الأسماء يمينًا دائمًا (ولو إنجليزية) وبنفس حدّ السطرين', () => {
    const title = rule('.v35 .cn-poster-title');
    expect(title).toMatch(/text-align:\s*right/);
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule('.v35 .cn-poster')).toMatch(/align-content:\s*start/);
    expect(rule('.v35 .cn-wide-title')).toMatch(/text-align:\s*right/);
    expect(rule('.v35 .cn-chart-copy b')).toMatch(/text-align:\s*right/);
  });
  it('السطور المفردة تُقصّ بعلامة الحذف لا تفيض', () => {
    for (const sel of ['.v35 .cn-wide-title', '.v35 .cn-wide-sub', '.v35 .cn-poster-meta > span', '.v35 .cn-chart-copy span']) {
      expect(rule(sel), sel).toMatch(/text-overflow:\s*ellipsis/);
    }
  });
});

describe('البانر البديل (cn-hero-alt): خلف صنف واحد', () => {
  it('مفعّل افتراضيًا، والترويسة لا تتأثر إلا في رئيسية السينما الظاهرة', () => {
    expect(HERO_FULL_BLEED).toBe(true);
    const header = rule(".v35[data-section='cinema'] #home:has(> #cinemaHome:not([hidden]) > .cn-hero-alt) > .header");
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/background:\s*transparent/);
    expect(rule(".v35[data-section='cinema'].cn-scrolled #home:has(> #cinemaHome:not([hidden]) > .cn-hero-alt) > .header")).toMatch(/background:\s*var\(--bg\)/);
  });
  it('مقاسات ثابتة كالأصل: نسبة الصورة وموضع الشعار', () => {
    expect(rule('.v35 .cn-hero-alt .cn-bill-stage')).toMatch(/aspect-ratio:\s*4 \/ 3/);
    expect(rule('.v35 .cn-hero-alt .cn-bill-info')).toMatch(/margin-top:\s*-84px/);
  });
});

describe('أزرار البانر (B): بلا صناديق', () => {
  it('«قائمتي» و«التفاصيل» أيقونة وكلمة بلا خلفية ولا إطار، بنفس الارتفاع الثابت', () => {
    const r = rule('.v35 .cn-bill-actions .cn-btn--ghost,\n.v35 .cn-bill-actions .cn-btn--icon');
    expect(r).toMatch(/background:\s*none/);
    expect(r).toMatch(/box-shadow:\s*none/);
    expect(r).toMatch(/min-height:\s*46px/);
  });
});

describe('بلا إطارات زائدة (F)', () => {
  it('لا خط تحت صفوف قوائم IMDb ولا إطار حول ملصقات الرئيسية واكتشف', () => {
    expect(rule('.v35 .cn-chart-row')).not.toMatch(/border-bottom/);
    expect(rule('.v35 .cn-home .cn-poster-art,\n.v35 .cn-discover .cn-poster-art')).toMatch(/box-shadow:\s*none/);
    expect(rule('.v35 .cn-genre')).not.toMatch(/box-shadow/);
    expect(rule('.v35 .cn-search')).not.toMatch(/box-shadow/);
  });
});

describe('ترويسات السينما على الجوال: لمس ثابت رغم تمرير البانر', () => {
  it('ترويسة الرئيسية خارج طبقة الصورة المتحركة وبدون translateZ', () => {
    const selector = ".v35[data-section='cinema'] #home:has(> #cinemaHome:not([hidden]) > .cn-hero-alt) > .header";
    const rules = rule(selector);
    expect(rules).toMatch(/position:\\s*fixed/);
    expect(rules).toMatch(/z-index:\\s*100/);
    expect(rules).toMatch(/transform:\\s*none/);
    expect(rule('.v35 .cn-hero-alt')).toMatch(/margin-top:\\s*0/);
  });
  it('شريط الرجوع ثابت في الشاشة، ويستقبل اللمس من الحاوية نفسها', () => {
    const bar = rule('.v35 #cinema.active .cn-detail-bar');
    expect(bar).toMatch(/position:\\s*fixed/);
    expect(bar).toMatch(/z-index:\\s*100/);
    expect(bar).toMatch(/pointer-events:\\s*auto/);
    expect(bar).toMatch(/transform:\\s*none/);
  });
});
