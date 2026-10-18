import { expect, it } from 'vitest';
import { TogetherRoom, type DOState } from './together.ts';

it('blocks old room info and websocket joins for accounts created after the room, retaining existing invited access', async () => {
  const room = new TogetherRoom({
    blockConcurrencyWhile: async (callback: () => Promise<void>) => callback(),
    storage: { get: async () => undefined, put: async () => {}, setAlarm: async () => {} },
  } as unknown as DOState, {});
  await room.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ code: 'ABCDEF', hostUserId: 'host', allowed: '*', input: {} }) }));
  const headers = { 'x-vantara-user': 'new', 'x-vantara-joined-at': String(Date.now() + 1000) };
  expect((await room.fetch(new Request('https://room/info', { headers }))).status).toBe(404);
  expect((await room.fetch(new Request('https://room/ws', { headers }))).status).toBe(404);
  expect((await room.fetch(new Request('https://room/info', { headers: { ...headers, 'x-vantara-joined-at': '0' } }))).status).toBe(200);
});
