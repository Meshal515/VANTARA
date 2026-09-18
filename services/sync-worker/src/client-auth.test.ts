import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore — browser module is plain ESM JavaScript by design.
import { createSync } from '../../../apps/web/lib/sync.js';

class MemoryStorage {
  readonly #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  clear(): void {
    this.#values.clear();
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/session')) {
        return new Response(
          JSON.stringify({ token: 'test-token', user: { userId: 'user-1', username: 'meshal' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/v1/device/pair')) {
        return new Response(JSON.stringify({ paired: true, accounts: 3 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/device/logout') || url.endsWith('/v1/device/logout-all')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('B2 browser trusted-device lifecycle', () => {
  it('consumes a pairing token from a native deep-link URL', async () => {
    const sync = createSync({ baseUrl: 'https://sync.example' });
    const pairingToken = 'owner-pairing-token-0000000000001';

    await sync.consumePairingUrl(`vantara://pair?pair=${pairingToken}`);

    const calls = vi.mocked(fetch).mock.calls;
    const pairCall = calls.find(([input]) => String(input).endsWith('/v1/device/pair'));
    expect(pairCall).toBeDefined();
    const options = pairCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body['pairingToken']).toBe(pairingToken);
    expect(typeof body['deviceId']).toBe('string');
    expect(typeof body['deviceCredential']).toBe('string');
  });

  it('deletes the local device credential after logout-device', async () => {
    const sync = createSync({ baseUrl: 'https://sync.example' });
    await sync.signIn('user-1');
    expect(storage.getItem('vantara.device.credential')).not.toBeNull();

    await sync.logoutDevice();

    expect(storage.getItem('vantara.device.credential')).toBeNull();
  });

  it('deletes the local device credential after logout-all', async () => {
    const sync = createSync({ baseUrl: 'https://sync.example' });
    await sync.signIn('user-1');
    expect(storage.getItem('vantara.device.credential')).not.toBeNull();

    await sync.logoutAll();

    expect(storage.getItem('vantara.device.credential')).toBeNull();
  });
});
