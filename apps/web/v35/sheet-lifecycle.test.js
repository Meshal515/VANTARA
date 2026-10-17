/**
 * تسلسل انقطاع لمس الأزرار اليمنى:
 * افتح ورقة السيرفرات fullscreen في الأنمي/السينما، أغلقها، تنقّل ثم أعد الفتح.
 * أزرار .ss-bar > * تستعمل pointer-events:auto، لذلك يجب إزالة الـDOM نفسه
 * من العرض وhit testing عند الإغلاق، لا مجرد إخفاء backdrop بالشفافية.
 */
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';
import { createSheetController } from './sheet-lifecycle.js';

function setup() {
  const { document } = parseHTML('<html><body><div class="v35"><button id="headerAction">بحث</button><div id="sheet" class="sheet-backdrop" hidden inert aria-hidden="true"><div class="sheet" id="sheetBody" role="dialog"></div></div></div></body></html>');
  const sheet = document.getElementById('sheet');
  const body = document.getElementById('sheetBody');
  return { sheet, body, ctl: createSheetController(sheet, body) };
}

function serverBody(body) {
  body.classList.add('an-pick', 'ss');
  body.setAttribute('aria-label', 'اختر السيرفر');
  const bar = body.ownerDocument.createElement('header');
  bar.className = 'ss-bar';
  const back = body.ownerDocument.createElement('button');
  back.className = 'an-pick-back';
  back.textContent = 'رجوع';
  bar.append(back);
  body.append(bar);
}

describe('إغلاق ورقة السيرفرات لا يعطل أزرار الواجهة العلوية', () => {
  it.each(['anime', 'cinema'])('يزيل زر الرجوع الخفي بعد الخروج من ورقة %s', (tone) => {
    const { sheet, body, ctl } = setup();
    const cleanup = vi.fn();
    ctl.open((node) => { serverBody(node); return cleanup; }, { tone, full: true });
    expect(sheet.classList.contains('show')).toBe(true);
    expect(sheet.classList.contains('sheet-backdrop--full')).toBe(true);
    expect(sheet.hidden).toBe(false);
    expect(sheet.inert).toBe(false);
    expect(body.querySelector('.an-pick-back')).not.toBeNull();

    expect(ctl.close()).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(sheet.hidden).toBe(true);
    expect(sheet.inert).toBe(true);
    expect(sheet.getAttribute('aria-hidden')).toBe('true');
    expect(sheet.classList.contains('show')).toBe(false);
    expect(sheet.classList.contains('sheet-backdrop--full')).toBe(false);
    expect(sheet.dataset.tone).toBeUndefined();
    expect(body.querySelector('.ss-bar')).toBeNull();
    expect(body.className).toBe('sheet');
    expect(body.hasAttribute('aria-label')).toBe(false);
    expect(ctl.close()).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('يعيد فتح الورقة ثم يغلقها مرارًا بلا بقاء مظهر أو مستمع قديم', () => {
    const { sheet, body, ctl } = setup();
    const dispose1 = vi.fn(), dispose2 = vi.fn(), dispose3 = vi.fn();
    ctl.open((node) => { serverBody(node); return dispose1; }, { tone: 'anime', full: true });
    ctl.open((node) => { serverBody(node); return dispose2; }, { tone: 'cinema', full: true });
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(body.querySelectorAll('.ss-bar')).toHaveLength(1);
    expect(sheet.dataset.tone).toBe('cinema');
    ctl.close();
    ctl.open((node) => { node.append('إعدادات'); return dispose3; });
    expect(body.className).toBe('sheet');
    expect(body.querySelector('.sheet-handle')).not.toBeNull();
    expect(body.querySelector('.ss-bar')).toBeNull();
    expect(sheet.classList.contains('sheet-backdrop--full')).toBe(false);
    expect(sheet.dataset.tone).toBeUndefined();
    ctl.close();
    expect(dispose2).toHaveBeenCalledTimes(1);
    expect(dispose3).toHaveBeenCalledTimes(1);
  });

  it('فشل بناء صفحة سيرفرات لا يبقي طبقة عالقة فوق الترويسة', () => {
    const { sheet, body, ctl } = setup();
    expect(() => ctl.open((node) => {
      serverBody(node);
      throw new Error('route preparation failed');
    }, { tone: 'cinema', full: true })).toThrow('route preparation failed');
    expect(sheet.hidden).toBe(true);
    expect(sheet.inert).toBe(true);
    expect(body.querySelector('.ss-bar')).toBeNull();
    expect(sheet.classList.contains('sheet-backdrop--full')).toBe(false);
  });

  it('إذا أنشأ تنظيف الورقة ورقة أخرى فلا يُحذف محتواها الجديد', () => {
    const { sheet, body, ctl } = setup();
    ctl.open((node) => {
      serverBody(node);
      return () => ctl.open((newBody) => newBody.append('ورقة جديدة'));
    }, { full: true });
    ctl.close();
    expect(sheet.hidden).toBe(false);
    expect(sheet.classList.contains('show')).toBe(true);
    expect(body.textContent).toContain('ورقة جديدة');
    expect(body.querySelector('.ss-bar')).toBeNull();
  });

  it('قواعد CSS تمنع أطفال الشريط ذوي pointer-events:auto من التقاط الضغط عند الإغلاق', () => {
    const css = readFileSync(new URL('./core.css', import.meta.url), 'utf8');
    const serverCss = readFileSync(new URL('./server-sheet.css', import.meta.url), 'utf8');
    const html = readFileSync(new URL('./markup.js', import.meta.url), 'utf8');
    expect(serverCss).toMatch(/\.v35 \.ss-bar > \*\s*\{\s*pointer-events:\s*auto/);
    expect(css).toMatch(/\.v35 \.sheet-backdrop\[hidden\][\s\S]*?display:\s*none/);
    expect(css).toMatch(/\.v35 \.sheet-backdrop:not\(\.show\)[\s\S]*?display:\s*none/);
    expect(html).toContain('id="sheet" data-act="sheetBackdrop" hidden inert aria-hidden="true"');
  });
});
