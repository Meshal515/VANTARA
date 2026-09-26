import { describe, expect, it } from 'vitest';
import { localSignals, readEvents } from './rafiq.js';

describe('rafiq client', () => {
  it('turns the local watch log into compact signals', () => {
    const watch = {
      21: { id: 21, title: 'One Piece', total: null, at: 5, episodes: { 1: { done: true }, 2: { done: true }, 3: { done: false } } },
      99: { id: 99, title: 'Short', total: 2, at: 9, episodes: { 1: { done: true }, 2: { done: true } } },
      bad: { id: 'x' },
    };
    expect(localSignals(watch)).toEqual([
      { id: 99, title: 'Short', watched: 2, total: 2, done: true, at: 9 },
      { id: 21, title: 'One Piece', watched: 2, total: null, done: false, at: 5 },
    ]);
  });

  it('reads SSE events split across chunks', async () => {
    const enc = new TextEncoder();
    const parts = ['event: meta\ndata: {"conversationId":"c1"}\n\nevent: del', 'ta\ndata: {"text":"هلا 🔥"}\n\n', 'event: final\ndata: {"message":{"id":"m"}}\n\n'];
    const response = new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }));
    const got = [];
    await readEvents(response, (event, data) => got.push([event, data]));
    expect(got).toEqual([
      ['meta', { conversationId: 'c1' }],
      ['delta', { text: 'هلا 🔥' }],
      ['final', { message: { id: 'm' } }],
    ]);
  });
});
