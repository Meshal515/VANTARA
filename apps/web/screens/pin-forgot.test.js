import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { pinPad } from './pin-pad.js';

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
});

function mount() {
  const { document } = parseHTML('<html><body></body></html>');
  globalThis.document = document;
  globalThis.requestAnimationFrame = (cb) => cb(0);
  return document;
}

describe('forgot PIN on the PIN pad', () => {
  it('offers «نسيت الرقم؟» only when a recovery path exists, and sends the pasted key', async () => {
    vi.useFakeTimers();
    const document = mount();
    const forgot = vi.fn().mockResolvedValueOnce({ message: 'المفتاح غير صحيح' }).mockResolvedValueOnce({ ok: true });
    const onDone = vi.fn();
    pinPad({ mode: 'enter', digits: 4, title: 'سعد', submit: vi.fn(), forgot, onDone });
    const link = document.querySelector('.vpin__forgot');
    expect(link?.textContent).toBe('نسيت الرقم؟');
    link.click();
    expect(document.querySelector('.vpin__keybox').hidden).toBe(false);
    expect(document.querySelector('.vpin__pad').hidden).toBe(true);
    const input = document.querySelector('.vpin__keyinput');
    input.value = '  VNTR-ABCD-EFGH-2345-6789 ';
    document.querySelector('.vpin__keybtn:not(.vpin__keybtn--ghost)').click();
    await vi.runAllTimersAsync();
    expect(forgot).toHaveBeenCalledWith('VNTR-ABCD-EFGH-2345-6789');
    expect(document.querySelector('.vpin__note').textContent).toBe('المفتاح غير صحيح');
    expect(onDone).not.toHaveBeenCalled();
    document.querySelector('.vpin__keybtn:not(.vpin__keybtn--ghost)').click();
    await vi.runAllTimersAsync();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('no recovery path, no link (creating a PIN, or callers that do not offer it)', () => {
    const document = mount();
    pinPad({ mode: 'enter', digits: 4, title: 'سعد', submit: vi.fn() });
    expect(document.querySelector('.vpin__forgot')).toBeNull();
    pinPad({ mode: 'create', title: 'رقم جديد', submit: vi.fn(), forgot: vi.fn() });
    expect(document.querySelector('.vpin__forgot')).toBeNull();
  });
});
