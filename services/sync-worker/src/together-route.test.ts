import { describe, expect, it } from 'vitest';
import { mintIdentityToken } from '@vantara/domain';
import { TogetherRoom, togetherRoute, type DONamespace, type DOState } from './together.ts';
import type { Env } from './types.ts';

// مسار «مشاهدة معًا» في الخادم: من يرى الغرفة، وهوية العضو من حسابه وحده.

const SECRET = 'together-route-identity-secret-32-chars-min';
const HOST = 'u-host';
const FRIEND = 'u-friend';
const STRANGER = 'u-stranger';
const profiles: Record<string, { username: string; display_name: string | null; avatar_key: string | null }> = {
  [HOST]: { username: 'host', display_name: 'المضيف', avatar_key: 'avatars/host.webp' },
  [FRIEND]: { username: 'friend', display_name: 'صديق', avatar_key: null },
  [STRANGER]: { username: 'stranger', display_name: 'غريب', avatar_key: null },
};

const db = {
  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...v: unknown[]) { values = v; return statement; },
      async first<T>() { return (sql.includes('FROM accounts a LEFT JOIN profiles p') ? profiles[String(values[0])] ?? null : null) as T; },
      async all<T>() { return { results: Object.keys(profiles).map((user_id) => ({ user_id })) as T[] }; },
    };
    return statement;
  },
};

function memoryState(): DOState {
  const data = new Map<string, unknown>();
  return {
    storage: {
      async get<T>(key: string) { return data.get(key) as T | undefined; },
      async put(key: string, value: unknown) { data.set(key, structuredClone(value)); },
      async deleteAll() { data.clear(); },
      async setAlarm() {},
      async deleteAlarm() {},
    },
    acceptWebSocket() {},
    getWebSockets() { return []; },
    async blockConcurrencyWhile<T>(fn: () => Promise<T>) { return fn(); },
  };
}

/** غرف حقيقية (TogetherRoom) لمسارَي الإنشاء والمعلومات، وتسجيل لما يصل مسار WebSocket. */
function rooms() {
  const live = new Map<string, TogetherRoom>();
  const sockets: Request[] = [];
  const ns: DONamespace = {
    idFromName: (name) => name,
    get: (id) => ({
      async fetch(request: Request) {
        if (new URL(request.url).pathname === '/ws') { sockets.push(request); return new Response(null, { status: 204 }); }
        const code = String(id);
        if (!live.has(code)) live.set(code, new TogetherRoom(memoryState(), {}));
        return live.get(code)!.fetch(request);
      },
    }),
  };
  return { ns, sockets };
}

async function call(env: Env, as: string, path: string, init: RequestInit = {}) {
  const token = await mintIdentityToken({ userId: as, deviceId: `d-${as}` }, SECRET);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return togetherRoute(path, new Request(`https://sync.test${path}`, { ...init, headers }), env, Date.now());
}

describe('together route', () => {
  it('room details reach the invited only, not any account that knows the code', async () => {
    const { ns } = rooms();
    const env = { TOGETHER: ns, DB: db, VANTARA_IDENTITY_SECRET: SECRET } as unknown as Env;
    const created = await call(env, HOST, '/v1/together/rooms', {
      method: 'POST', body: JSON.stringify({ invite: [FRIEND], media: { key: 'anime:frieren:e5', kind: 'anime', label: 'Frieren 5' } }),
    });
    const { code } = (await created!.json()) as { code: string };
    expect((await call(env, HOST, `/v1/together/rooms/${code}`))!.status).toBe(200);
    const friend = await call(env, FRIEND, `/v1/together/rooms/${code}`);
    expect(friend!.status).toBe(200);
    expect(((await friend!.json()) as { room: { code: string } }).room.code).toBe(code);
    const stranger = await call(env, STRANGER, `/v1/together/rooms/${code}`);
    expect(stranger!.status).toBe(403);
    expect(await stranger!.text()).not.toContain('Frieren');
  });

  it('a member is who their account says: identity headers sent by the device never reach the room', async () => {
    const { ns, sockets } = rooms();
    const env = { TOGETHER: ns, DB: db, VANTARA_IDENTITY_SECRET: SECRET } as unknown as Env;
    await call(env, FRIEND, '/v1/together/rooms/ABCDEF/ws', {
      headers: { upgrade: 'websocket', 'x-vantara-avatar': 'avatars/host.webp', 'x-vantara-user': HOST, 'x-vantara-name': 'host', 'X-Vantara-Extra': '1' },
    });
    const forwarded = sockets.at(-1)!.headers;
    expect(forwarded.get('x-vantara-user')).toBe(FRIEND);
    expect(decodeURIComponent(forwarded.get('x-vantara-name')!)).toBe('صديق');
    // صاحب الحساب بلا صورة: لا صورة، لا صورة المضيف التي أرسلها الجهاز
    expect(forwarded.get('x-vantara-avatar')).toBeNull();
    expect(forwarded.get('x-vantara-extra')).toBeNull();
    expect(forwarded.get('authorization')).toBeNull();
    expect(forwarded.get('upgrade')).toBe('websocket');
  });
});
