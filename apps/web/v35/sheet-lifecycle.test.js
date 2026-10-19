import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSheetController } from './sheet-lifecycle.js';
import { SHELL_HTML } from './markup.js';
import { readFileSync } from 'node:fs';

function fixture() {
  const { document } = parseHTML('<html><body><div class="v35">' + SHELL_HTML + '</div></body></html>');
  const overlay = document.getElementById('sheet');
  const body = document.getElementById('sheetBody');
  return { document, overlay, body, sheets: createSheetController(overlay, body) };
}

afterEach(() => vi.useRealTimers());

describe('ورقة السيرفرات لا تحبس أزرار أعلى الشاشة بعد الرجوع', () => {
  it('يبدأ الستار مخفيًا وخارج الوصول للمس؛ CSS لا يسمح لـ display:grid بإظهاره', () => {
    const { overlay } = fixture();
    expect(overlay.hasAttribute('hidden')).toBe(true);
    expect(overlay.hasAttribute('inert')).toBe(true);
    const css = readFileSync(new URL('./core.css', import.meta.url), 'utf8');
    expect(css).toContain('.v35 .sheet-backdrop[hidden]');
    expect(css).toContain('.v35 .sheet-backdrop[inert] *');
  });

  it('إغلاق ورقة السيرفرات يعطّل كل أحفادها فورًا ويحرر محتوياتها بعد الحركة', () => {
    vi.useFakeTimers();
    const { overlay, body, sheets } = fixture();
    const cleanup = vi.fn();
    sheets.open((host) => {
      const bar = body.ownerDocument.createElement('header');
      bar.className = 'ss-bar';
      const back = body.ownerDocument.createElement('button');
      back.className = 'an-pick-back';
      bar.append(back);
      host.append(bar);
      return cleanup;
    }, { full: true, tone: 'cinema' });
    expect(overlay.classList.contains('show')).toBe(true);
    expect(overlay.classList.contains('sheet-backdrop--full')).toBe(true);
    expect(overlay.hasAttribute('inert')).toBe(false);
    expect(sheets.close()).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(overlay.classList.contains('show')).toBe(false);
    expect(overlay.hasAttribute('inert')).toBe(true);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.dataset.tone).toBeUndefined();
    expect(body.querySelector('.an-pick-back')).not.toBeNull();
    vi.advanceTimersByTime(260);
    expect(overlay.hasAttribute('hidden')).toBe(true);
    expect(overlay.classList.contains('sheet-backdrop--full')).toBe(false);
    expect(body.querySelector('.an-pick-back')).toBeNull();
    expect(body.className).toBe('sheet');
    expect(sheets.close()).toBe(false);
  });

  it('فتح ورقة ثانية أثناء إغلاق السيرفرات لا يجعل المؤقت القديم يخفيها', () => {
    vi.useFakeTimers();
    const { overlay, body, sheets } = fixture();
    const oldCleanup = vi.fn();
    sheets.open((host) => {
      host.textContent = 'سيرفرات';
      return oldCleanup;
    }, { full: true });
    sheets.close();
    vi.advanceTimersByTime(110);
    sheets.open((host) => { host.textContent = 'قائمة جديدة'; }, { tone: 'anime' });
    vi.advanceTimersByTime(700);
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    expect(overlay.classList.contains('show')).toBe(true);
    expect(overlay.hasAttribute('hidden')).toBe(false);
    expect(overlay.hasAttribute('inert')).toBe(false);
    expect(overlay.classList.contains('sheet-backdrop--full')).toBe(false);
    expect(body.textContent).toContain('قائمة جديدة');
  });

  it('الانتقال مباشرة من ورقة كاملة إلى ورقة عادية لا يترك أي عنصر من السابقة', () => {
    vi.useFakeTimers();
    const { overlay, body, sheets } = fixture();
    const oldCleanup = vi.fn();
    sheets.open((host) => {
      host.innerHTML = '<header class="ss-bar"><button>رجوع</button></header>';
      return oldCleanup;
    }, { full: true });
    sheets.open((host) => { host.textContent = 'الخيارات'; });
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    expect(overlay.classList.contains('sheet-backdrop--full')).toBe(false);
    expect(body.querySelector('.ss-bar')).toBeNull();
    expect(body.textContent).toContain('الخيارات');
    vi.runAllTimers();
    expect(overlay.hasAttribute('hidden')).toBe(false);
    expect(overlay.hasAttribute('inert')).toBe(false);
    sheets.destroy();
    expect(overlay.hasAttribute('hidden')).toBe(true);
  });
});
