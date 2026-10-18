import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { openAddAccount } from './add-account.js';

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
});

describe('new account on an unapproved device', () => {
  it('shows a device approval code and creates only after authorized approval', async () => {
    vi.useFakeTimers();
    const { document } = parseHTML('<html><body></body></html>');
    globalThis.document = document;
    globalThis.requestAnimationFrame = (cb) => cb(0);

    const sync = {
      createAccount: vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401, data: { error: 'unauthorized' } })
        .mockResolvedValueOnce({ ok: true, data: { account: { userId: 'new-user' } } }),
      requestDevice: vi.fn().mockResolvedValue({ code: 'ABCD-WXYZ', expiresAt: Date.now() + 60_000 }),
      claimDevice: vi.fn().mockResolvedValueOnce({ paired: false }).mockResolvedValueOnce({ paired: true }),
      signIn: vi.fn().mockResolvedValue({ userId: 'new-user', displayName: 'جديد' }),
      uploadMedia: vi.fn().mockRejectedValue(new Error('thumbnail unavailable in test')),
      enqueue: vi.fn(),
    };
    const onCreated = vi.fn();
    openAddAccount({ sync, mount: document.body, onCreated });
    const fields = document.querySelectorAll('.vacct__input');
    fields[0].value = 'جديد';
    fields[1].value = 'newuser';
    await document.querySelector('form').onsubmit({ preventDefault() {} });

    expect(sync.createAccount).toHaveBeenCalledTimes(1);
    expect(sync.requestDevice).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.vacct__approval').textContent).toContain('ABCD-WXYZ');
    expect(sync.signIn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(sync.createAccount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sync.createAccount).toHaveBeenCalledTimes(2);
    expect(sync.signIn).toHaveBeenCalledWith('new-user');
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ userId: 'new-user' }));
  });

  it('closing the dialog cancels polling and cannot create an account', async () => {
    vi.useFakeTimers();
    const { document } = parseHTML('<html><body></body></html>');
    globalThis.document = document;
    globalThis.requestAnimationFrame = (cb) => cb(0);
    const sync = {
      createAccount: vi.fn().mockResolvedValue({ ok: false, status: 401, data: { error: 'unauthorized' } }),
      requestDevice: vi.fn().mockResolvedValue({ code: 'ABCD-WXYZ', expiresAt: Date.now() + 60_000 }),
      claimDevice: vi.fn().mockResolvedValue({ paired: true }),
    };
    const dialog = openAddAccount({ sync, mount: document.body, onCreated: vi.fn() });
    const fields = document.querySelectorAll('.vacct__input');
    fields[0].value = 'جديد';
    fields[1].value = 'newuser';
    await document.querySelector('form').onsubmit({ preventDefault() {} });
    dialog.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync.claimDevice).not.toHaveBeenCalled();
    expect(sync.createAccount).toHaveBeenCalledTimes(1);
  });
});
