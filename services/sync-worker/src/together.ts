/**
 * VANTARA Together على Cloudflare: غرفة واحدة = Durable Object واحد.
 *
 * المسارات (كلها بهوية v2):
 *   POST /v1/together/rooms            {cap, mode, control, media} ← {code}
 *   GET  /v1/together/rooms/:code/ws   ترقية WebSocket. المتصفح لا يضع ترويسة
 *        Authorization على WebSocket، فالتوكن يُقبل أيضًا بروتوكولًا فرعيًا:
 *        new WebSocket(url, ['vantara.together', 'bearer.' + token]).
 *
 * WebSocket Hibernation: الغرفة الخاملة لا تشغل ذاكرة. بيانات العضو في مرفق
 * الاتصال، وإعدادات الغرفة وخطها الزمني في تخزين الكائن، فتعود كما هي بعد السبات.
 */

import { verifyIdentityToken } from '@vantara/domain';
import { bearerFrom } from './session.ts';
import { createSettings, normalizeCode, parseMedia, roomCode, RoomCore, type Out, type Persisted } from './together-core.ts';
import type { Env } from './types.ts';

// ---- سطح Durable Objects الذي نستعمله فقط (نفس نهج types.ts: بلا workers-types) ----
export interface DOWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
export interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface DOState {
  storage: DOStorage;
  acceptWebSocket(ws: DOWebSocket): void;
  getWebSockets(): DOWebSocket[];
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}
export interface DOStub {
  fetch(request: Request): Promise<Response>;
}
export interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DOStub;
}
declare const WebSocketPair: { new (): { 0: DOWebSocket; 1: DOWebSocket } };

interface Attachment {
  conn: string;
  userId: string;
  name: string;
  avatarKey: string | null;
  joinedAt: number;
}

const PROTOCOL = 'vantara.together';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export class TogetherRoom {
  private core: RoomCore | null = null;
  private readonly sockets = new Map<string, DOWebSocket>();

  constructor(private readonly state: DOState, _env: unknown) {
    void state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get<Persisted>('room');
      if (!saved) return;
      this.core = new RoomCore(saved);
      for (const ws of state.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (!a) continue;
        this.sockets.set(a.conn, ws);
        this.core.restore(a);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.core) return json({ error: 'exists' }, 409);
      const body = (await request.json()) as { code: string; hostUserId: string; input: Record<string, unknown> | null };
      this.core = RoomCore.create(createSettings(body.input, body.hostUserId, body.code, now), parseMedia(body.input?.['media']), now);
      await this.persist();
      return json({ ok: true });
    }
    if (url.pathname === '/info') {
      if (!this.core) return json({ error: 'gone' }, 404);
      return json({ room: this.core.roomView(), state: this.core.timeline, people: this.core.members.size });
    }
    if (url.pathname !== '/ws') return json({ error: 'not_found' }, 404);
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'upgrade_required' }, 426);
    const userId = request.headers.get('x-vantara-user')!;

    // الرفض (لا غرفة، أو ممتلئة) يكون داخل WebSocket برمز إغلاق: المتصفح لا يرى
    // حالة HTTP لترقية فاشلة، فكان سيعيد المحاولة بلا نهاية.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const headers: Record<string, string> = {};
    if ((request.headers.get('sec-websocket-protocol') ?? '').split(',').some((p) => p.trim() === PROTOCOL)) {
      headers['sec-websocket-protocol'] = PROTOCOL;
    }
    if (!this.core) {
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ t: 'gone' }));
      server.close(4004, 'gone');
      return new Response(null, { status: 101, webSocket: client, headers } as ResponseInit);
    }
    const attachment: Attachment = {
      conn: crypto.randomUUID(),
      userId,
      name: decodeURIComponent(request.headers.get('x-vantara-name') ?? '') || 'صديق',
      avatarKey: request.headers.get('x-vantara-avatar') || null,
      joinedAt: now,
    };
    this.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    this.sockets.set(attachment.conn, server);
    await this.apply(this.core.join(attachment, now));
    return new Response(null, { status: 101, webSocket: client, headers } as ResponseInit);
  }

  async webSocketMessage(ws: DOWebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.core || typeof message !== 'string' || message.length > 4096) return;
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    if (!this.sockets.has(a.conn)) this.sockets.set(a.conn, ws);
    let msg: unknown;
    try { msg = JSON.parse(message); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    await this.apply(this.core.handle(a.conn, msg as Record<string, unknown>, Date.now()));
  }

  async webSocketClose(ws: DOWebSocket): Promise<void> {
    await this.drop(ws);
  }

  async webSocketError(ws: DOWebSocket): Promise<void> {
    await this.drop(ws);
  }

  async alarm(): Promise<void> {
    if (!this.core) return;
    const { out, expired } = this.core.tick(Date.now());
    if (expired) {
      this.core = null;
      await this.state.storage.deleteAll();
      return;
    }
    await this.apply(out);
  }

  private async drop(ws: DOWebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || !this.core) return;
    // اتصال أُغلق لأن نفس الحساب دخل من جديد: العضو باقٍ باتصاله الجديد
    if (this.sockets.get(a.conn) !== ws && this.sockets.has(a.conn)) return;
    this.sockets.delete(a.conn);
    await this.apply(this.core.leave(a.conn, Date.now()));
  }

  private send(conn: string, data: string): void {
    try { this.sockets.get(conn)?.send(data); } catch { /* اتصال ميت: إغلاقه يصل وحده */ }
  }

  private async apply(out: Out[]): Promise<void> {
    if (!this.core) return;
    for (const o of out) {
      if ('close' in o) {
        const ws = this.sockets.get(o.close);
        this.sockets.delete(o.close);
        try { ws?.close(o.code, o.reason); } catch { /* مغلق أصلًا */ }
        continue;
      }
      const data = JSON.stringify(o.msg);
      const targets = o.to === 'all' ? [...this.sockets.keys()] : o.to;
      for (const conn of targets) if (conn !== o.except) this.send(conn, data);
    }
    if (this.core.dirty) {
      this.core.dirty = false;
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (!this.core) return;
    await this.state.storage.put('room', this.core.persisted());
    const next = this.core.nextDeadline();
    if (next != null) await this.state.storage.setAlarm(next);
    else await this.state.storage.deleteAlarm();
  }
}

/** التوكن من Authorization أو من البروتوكول الفرعي «bearer.<token>». */
export function togetherToken(request: Request): string | null {
  const header = bearerFrom(request);
  if (header) return header;
  const protocols = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim());
  const bearer = protocols.find((p) => p.startsWith('bearer.'));
  return bearer ? bearer.slice('bearer.'.length) || null : null;
}

interface Profile { username: string; display_name: string | null; avatar_key: string | null }

/** يُرجع Response إن كان المسار لـTogether، وإلا null. */
export async function togetherRoute(path: string, request: Request, env: Env, now: number): Promise<Response | null> {
  if (!path.startsWith('/v1/together/')) return null;
  const ns = env.TOGETHER;
  if (!ns) return json({ error: 'together_unavailable' }, 503);
  const token = togetherToken(request);
  const claims = token ? await verifyIdentityToken(token, env.VANTARA_IDENTITY_SECRET, now) : null;
  if (!claims) return json({ error: 'unauthorized' }, 401);
  const profile = await env.DB.prepare(
    `SELECT a.username, p.display_name, p.avatar_key
       FROM accounts a LEFT JOIN profiles p USING (user_id)
      WHERE a.user_id = ? AND a.lifecycle = 'ACTIVE'`,
  ).bind(claims.userId).first<Profile>();
  if (!profile) return json({ error: 'account_deleted' }, 410);

  if (path === '/v1/together/rooms' && request.method === 'POST') {
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = roomCode();
      const res = await ns.get(ns.idFromName(code)).fetch(new Request('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ code, hostUserId: claims.userId, input }),
      }));
      if (res.status === 409) continue;
      if (!res.ok) return json({ error: 'room_failed' }, 502);
      return json({ code });
    }
    return json({ error: 'room_failed' }, 503);
  }

  const m = /^\/v1\/together\/rooms\/([^/]+)(\/ws)?$/.exec(path);
  const code = normalizeCode(m?.[1]);
  if (!m || !code) return json({ error: 'not_found' }, 404);
  const stub = ns.get(ns.idFromName(code));
  if (!m[2]) return stub.fetch(new Request('https://room/info'));
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.set('x-vantara-user', claims.userId);
  headers.set('x-vantara-name', encodeURIComponent(profile.display_name || profile.username));
  if (profile.avatar_key) headers.set('x-vantara-avatar', profile.avatar_key);
  return stub.fetch(new Request('https://room/ws', { headers }));
}
