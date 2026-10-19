import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createMajlis } from './majlis.js';
import { createRoom } from './majlis-chat.js';

let ctx, feed, room;
const recommendation = { id: 'legacy', series_ref: 'anime:1', series_title: 'عمل', chapter_label: 'الحلقة3 ·0:10–0:30', from_id: 'friend', created_at: 1 };
beforeEach(() => {
  const { window, document } = parseHTML('<html><head></head><body><main></main><aside></aside></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('requestAnimationFrame', () => 1);
  const rows = { recommendations: [{ ...recommendation }], accounts: [] };
  ctx = {
    host: document.querySelector('main'), mount: document.querySelector('aside'), section: () => 'anime',
    sync: { user: { userId: 'me' }, rows: (table, predicate = () => true) => (rows[table] ?? []).filter(predicate), enqueue: vi.fn() },
    avatarNode: () => document.createElement('span'), mountImage: async () => {}, presence: async () => [],
    workFromRef: (id, title) => ({ id, title: { english: title } }),
    playMoment: vi.fn(), preview: vi.fn(), markSeen: vi.fn(), onClose: vi.fn(),
  };
});
afterEach(() => { feed?.hide(); room?.close(); vi.unstubAllGlobals(); });
describe('moment cards', () => {
  it.each(['anime', 'cinema'])('routes legacy %s moments directly from Majlis to the shared viewer', (section) => {
    ctx.section = () => section;
    ctx.sync.rows('recommendations')[0].series_ref = `${section}:1`;
    feed = createMajlis(ctx); feed.show();
    document.querySelector('.mj-work').click();
    expect(ctx.playMoment).toHaveBeenCalledWith(ctx.sync.rows('recommendations')[0]);
    document.querySelector('.mj-clip-watch').click(); expect(ctx.playMoment).toHaveBeenCalledTimes(2);
    expect(ctx.preview).not.toHaveBeenCalled(); expect(document.querySelector('.mv-preview')).toBeTruthy();
  });
  it('plays a chat moment without closing or replacing the chat', () => {
    room = createRoom(ctx); room.open();
    document.querySelector('.mc-work').click();
    expect(ctx.playMoment).toHaveBeenCalledWith(ctx.sync.rows('recommendations')[0]);
    expect(ctx.markSeen).toHaveBeenCalledWith('rec', 'legacy');
    expect(room.isOpen()).toBe(true); expect(ctx.preview).not.toHaveBeenCalled();
  });
  it('retains ordinary recommendation navigation', () => {
    ctx.sync.rows('recommendations')[0].chapter_label = 'الحلقة 3';
    feed = createMajlis(ctx); feed.show(); document.querySelector('.mj-work').click();
    expect(ctx.preview).toHaveBeenCalled(); expect(ctx.playMoment).not.toHaveBeenCalled();
  });
});
