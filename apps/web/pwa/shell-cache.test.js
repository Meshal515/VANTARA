import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function workerWithCachedShell({ cached = true, offline = false } = {}) {
  const handlers = new Map();
  const writes = [];
  const network = [];
  const cache = {
    match: async () => cached ? new Response('installed build') : undefined,
    put: async (_request, response) => writes.push(await response.text()),
  };
  runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://pwa.test', hostname: 'pwa.test', protocol: 'https:' }, addEventListener: (event, fn) => handlers.set(event, fn) },
    caches: { open: async () => cache },
    fetch: async (request) => {
      network.push(request.url);
      if (offline) throw new Error('offline');
      return new Response('unapplied build');
    },
    URL, Request, Response, setTimeout, clearTimeout,
  });
  return { handlers, writes, network };
}

describe('installed PWA shell', () => {
  it.each([
    ['https://pwa.test/', 'navigate'],
    ['https://pwa.test/lib/anime-engine.js', 'cors'],
  ])('keeps %s on its installed build until the waiting update is applied', async (url, mode) => {
    const { handlers, writes, network } = workerWithCachedShell();
    const background = [];
    let response;
    handlers.get('fetch')({ request: { url, method: 'GET', mode }, respondWith: (value) => { response = value; }, waitUntil: (value) => background.push(value) });
    expect(await (await response).text()).toBe('installed build');
    await Promise.all(background);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toEqual([]);
    expect(network).toEqual([]);
  });

  it.each(['navigate', 'cors'])('uses the network when the %s shell cache is missing', async (mode) => {
    const { handlers, writes, network } = workerWithCachedShell({ cached: false });
    let response;
    handlers.get('fetch')({ request: { url: 'https://pwa.test/lib/config.js', method: 'GET', mode }, respondWith: (value) => { response = value; } });
    expect(await (await response).text()).toBe('unapplied build');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(network).toHaveLength(1);
    expect(writes).toEqual(['unapplied build']);
  });

  it('opens the installed app offline', async () => {
    const { handlers, network } = workerWithCachedShell({ offline: true });
    let response;
    handlers.get('fetch')({ request: { url: 'https://pwa.test/', method: 'GET', mode: 'navigate' }, respondWith: (value) => { response = value; } });
    expect(await (await response).text()).toBe('installed build');
    expect(network).toEqual([]);
  });
});
