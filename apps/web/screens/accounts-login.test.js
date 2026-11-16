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

async function offlineGate(error, { onLocal = vi.fn() } = {}) {
  const { document } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  const sync = { accountsLimit: 10, accounts: async () => { throw error; } };
  await screenAccounts({ sync, mount: node => document.body.replaceChildren(node), onSignedIn: async () => {}, onLocal });
  return { document, onLocal };
}

it('opens what is on the device straight away when the accounts cannot be reached', async () => {
  const { onLocal } = await offlineGate(new TypeError('Failed to fetch'));
  expect(onLocal).toHaveBeenCalledTimes(1);
});

it('a server refusal is not offline: the gate explains and offers the device', async () => {
  const { document, onLocal } = await offlineGate(new Error('http_503'));
  expect(onLocal).not.toHaveBeenCalled();
  expect(document.querySelector('.gate__message').textContent).toContain('تعذّر الوصول');
  document.querySelector('.gate__enter').click();
  expect(onLocal).toHaveBeenCalledTimes(1);
});

it('reachability: no network or a transport error is unreachable; an HTTP reply is not', async () => {
  const { unreachable } = await import('./accounts.js');
  expect(unreachable(new Error('http_500'), false)).toBe(true);
  expect(unreachable(new TypeError('Failed to fetch'), true)).toBe(true);
  expect(unreachable(new Error('http_500'), true)).toBe(false);
});
