import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
vi.mock('../lib/silk.js', () => ({ cachedSilkPalette: () => null, createSilk: () => ({ setPalette() {}, destroy() {} }), followImage: () => () => {}, silkPaletteForSrc: async () => null }));
import { screenAccounts } from './accounts.js';

afterEach(() => vi.unstubAllGlobals());
async function gate({ signIn = async () => ({ userId: 'fixture' }), onSignedIn = async () => {}, returnState = false } = {}) {
  const { document, window } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 150 });
  const sync = { accountsLimit: 1, accounts: async () => [{ userId: 'fixture', displayName: 'Test account' }], signIn, signedIn: true, user: { userId: 'fixture' }, locked: false };
  await screenAccounts({ sync, mount: node => document.body.replaceChildren(node), onSignedIn });
  document.querySelector('.gate__enter').click();
  await vi.waitFor(() => expect(document.querySelector('.gate__message').textContent).not.toBe(''));
  return returnState ? { document, sync } : document.querySelector('.gate__message').textContent;
}

it('distinguishes a home startup failure from a failed login or transport', async () => {
  const message = await gate({ onSignedIn: async () => { throw new TypeError('Home view failed'); } });
  expect(message).toContain('تم تسجيل الدخول');
  expect(message).not.toContain('ما فيه اتصال');
});

it('identifies local storage errors without blaming the network', async () => {
  const message = await gate({ signIn: async () => { throw new DOMException('full', 'QuotaExceededError'); } });
  expect(message).toContain('التخزين');
  expect(message).not.toContain('ما فيه اتصال');
});

it('still identifies a failed session transport as a network failure', async () => {
  const message = await gate({ signIn: async () => { throw Object.assign(new TypeError('Failed to fetch'), { stage: 'session_transport' }); } });
  expect(message).toContain('ما فيه اتصال');
});

it('retries home without submitting another login while the same session remains valid', async () => {
  const signIn = vi.fn(async () => ({ userId: 'fixture' }));
  const onSignedIn = vi.fn().mockRejectedValueOnce(new TypeError('Home failed')).mockResolvedValueOnce();
  const { document } = await gate({ signIn, onSignedIn, returnState: true });
  document.querySelector('.gate__enter').click();
  await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(2));
  expect(signIn).toHaveBeenCalledTimes(1);
});

it('requires authentication again if the cached home retry session was signed out or locked', async () => {
  const signIn = vi.fn().mockResolvedValueOnce({ userId: 'fixture' }).mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 401 }));
  const onSignedIn = vi.fn().mockRejectedValue(new TypeError('Home failed'));
  const { document, sync } = await gate({ signIn, onSignedIn, returnState: true });
  sync.signedIn = false;
  sync.locked = true;
  document.querySelector('.gate__enter').click();
  await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
  expect(onSignedIn).toHaveBeenCalledTimes(1);
});
