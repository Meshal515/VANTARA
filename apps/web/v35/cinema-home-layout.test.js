import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
