import { describe, expect, it, vi } from 'vitest';
import { requestContent } from './content-api.js';

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { 'content-type': 'application/json' },
  });
}

describe('Content API bearer transport', () => {
  it('sends the current VANTARA identity token with JSON requests', async () => {
    const fetchMock = vi.fn(async () => response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const sync = {
      authorizationHeader: 'Bearer identity-token-1',
      signedIn: true,
      refreshSession: vi.fn(),
    };

    await requestContent({
      baseUrl: 'https://api.example',
      sync,
      path: '/v1/library',
      options: { method: 'POST', body: { hello: 'world' } },
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.example/v1/library');
    expect(options.credentials).toBe('include');
    expect(options.headers.authorization).toBe('Bearer identity-token-1');
    expect(options.headers['content-type']).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ hello: 'world' }));
    vi.unstubAllGlobals();
  });

  it('refreshes once on 401 and retries the exact request with the new token', async () => {
    let token = 'identity-token-old';
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => response({ error: 'unauthorized' }, 401))
      .mockImplementationOnce(async () => response({ content: ['ok'] }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const sync = {
      get authorizationHeader() {
        return `Bearer ${token}`;
      },
      signedIn: true,
      refreshSession: vi.fn(async () => {
        token = 'identity-token-new';
      }),
    };

    const result = await requestContent({
      baseUrl: 'https://api.example',
      sync,
      path: '/v1/search?q=x',
      options: { method: 'GET' },
    });

    expect(result).toEqual({ content: ['ok'] });
    expect(sync.refreshSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer identity-token-old');
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer identity-token-new');
    vi.unstubAllGlobals();
  });

  it('never loops refresh when the retried request is still unauthorized', async () => {
    const fetchMock = vi.fn(async () => response({ error: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const sync = {
      authorizationHeader: 'Bearer identity-token',
      signedIn: true,
      refreshSession: vi.fn(async () => {}),
    };

    await expect(
      requestContent({
        baseUrl: 'https://api.example',
        sync,
        path: '/v1/library',
      }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });

    expect(sync.refreshSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
