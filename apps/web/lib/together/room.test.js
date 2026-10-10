import { describe, expect, it } from 'vitest';
import { inviteLink, joinRoom, parseInvite } from './room.js';

function harness() {
  const sockets = [];
  class FakeWS {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
    drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  }
  const queue = [];
  const timers = { setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; }, clearTimeout: (id) => { if (queue[id - 1]) queue[id - 1].fn = null; } };
  const run = (maxMs = Infinity) => {
    for (const t of queue.splice(0)) if (t.fn && t.ms <= maxMs) t.fn(); else if (t.fn) queue.push(t);
  };
  let clock = 0;
  const room = joinRoom({ baseUrl: 'https://sync.test', code: 'ABCDEF', getToken: () => 'tok', WebSocketImpl: FakeWS, timers, now: () => clock });
  return { room, sockets, run, queue, tick: (ms) => (clock += ms) };
}

const welcome = { t: 'welcome', you: 'u1', now: 5_000, room: { code: 'ABCDEF', hostUserId: 'u1', cap: 10, mode: 'sync', control: 'host' }, state: { playing: false, pos: 0, at: 5_000, rate: 1, seq: 4 }, roster: [] };

describe('Together room client', () => {
  it('connects over wss with the token as a subprotocol, never in the URL', () => {
    const { sockets } = harness();
    expect(sockets[0].url).toBe('wss://sync.test/v1/together/rooms/ABCDEF/ws');
    expect(sockets[0].protocols).toEqual(['vantara.together', 'bearer.tok']);
  });

  it('goes live on welcome, ignores stale timelines, and samples the clock', () => {
    const { room, sockets, run } = harness();
    sockets[0].open();
    run(0);
    expect(sockets[0].sent[0]).toMatchObject({ t: 'ping' });
    sockets[0].receive(welcome);
    expect(room.status).toBe('live');
    expect(room.isHost).toBe(true);
    sockets[0].receive({ t: 'state', state: { ...welcome.state, seq: 3, pos: 999 } });
    expect(room.timeline.seq).toBe(4);
    sockets[0].receive({ t: 'state', state: { ...welcome.state, seq: 5, playing: true } });
    expect(room.timeline).toMatchObject({ seq: 5, playing: true });
    sockets[0].receive({ t: 'pong', t0: 0, ts: 9_000 });
    expect(room.clock.ready).toBe(true);
  });

  it('reconnects with backoff after a dropped connection', () => {
    const { room, sockets, run } = harness();
    sockets[0].open();
    sockets[0].drop(1006);
    expect(room.status).toBe('reconnecting');
    run();
    expect(sockets).toHaveLength(2);
  });

  it('a full or missing room is final: no reconnect loop', () => {
    for (const t of ['full', 'gone']) {
      const { room, sockets, run } = harness();
      sockets[0].open();
      sockets[0].receive({ t });
      sockets[0].drop(1006);
      run();
      expect(room.status).toBe(t);
      expect(sockets).toHaveLength(1);
    }
  });

  it('builds and parses invite links', () => {
    const link = inviteLink('https://vantara-bcf.pages.dev/', 'ABCDEF');
    expect(link).toBe('https://vantara-bcf.pages.dev/#together=ABCDEF');
    expect(parseInvite(new URL(link).hash)).toBe('ABCDEF');
    expect(parseInvite('#x=1&together=abcdef')).toBe('ABCDEF');
    expect(parseInvite('#together=ABC')).toBeNull();
  });
});
