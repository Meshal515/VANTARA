import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { openAddAccount } from './add-account.js';
import { normalizeUsername } from '../lib/account-username.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('accepts only normalized Arabic/English usernames within 3–20 codepoints', () => {
  expect(normalizeUsername('@سارة_Ａ1')).toBe('سارة_a1');
  expect(normalizeUsername('س'.repeat(20))).toBe('س'.repeat(20));
  for (const value of ['س', 'س'.repeat(21), ' abc', 'abc\n', 'foo bar', 'ab\u200f', 'ab漢', 'ab😀']) expect(normalizeUsername(value)).toBeNull();
});

it('shows approval as pending creation and signs in only once approval completes', async () => {
  vi.useFakeTimers();
  const { document } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', (callback) => callback());
  const approval = { code: 'ABCD-2345', expiresAt: Date.now() + 60000 };
  const sync = {
    createAccount: vi.fn(async () => ({ ok: false, pending: true, approval })),
    completePendingAccount: vi.fn().mockResolvedValueOnce({ pending: true, approval }).mockResolvedValueOnce({ ok: true, data: { account: { userId: 'new' } } }),
    signIn: vi.fn(async () => ({ userId: 'new' })),
  };
  const onCreated = vi.fn();
  openAddAccount({ sync, onCreated });
  const [name, username] = document.querySelectorAll('.vacct__input');
  name.value = 'سارة 🌙';
  username.value = 'سارة_1';
  username.oninput();
  await document.querySelector('form').onsubmit({ preventDefault() {} });
  expect(sync.createAccount).toHaveBeenCalledWith({ username: 'سارة_1', displayName: 'سارة 🌙' });
  expect(document.querySelector('.vacct__error').textContent).toContain('لم يُنشأ الحساب بعد');
  expect(document.querySelector('.vacct__error').textContent).toContain('ABCD-2345');
  expect(sync.signIn).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(sync.signIn).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(sync.signIn).toHaveBeenCalledExactlyOnceWith('new');
  expect(onCreated).toHaveBeenCalledWith({ userId: 'new' });
});
