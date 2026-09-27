import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFriends } from './friends.js';
import { imageLoadingNode } from './image-loading.js';

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.attrs = {};
    this.classList = { add: (name) => { this.className += ` ${name}`; } };
  }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text ?? '') + this.children.map((n) => n.textContent).join(''); }
  set innerHTML(value) { this.textContent = value; }
  get outerHTML() { return `<${this.tag} class="${this.className}">${this.textContent}</${this.tag}>`; }
  get lastElementChild() { return this.children.at(-1); }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener() {}
  append(...items) { this.children.push(...items.map((item) => typeof item === 'string' ? new Text(item) : item)); }
  replaceChildren(...items) { this.children = items; }
  replaceChild(newNode, oldNode) { this.children[this.children.indexOf(oldNode)] = newNode; }
  remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const cls = selector.slice(1);
    const out = [];
    const visit = (node) => {
      for (const child of node.children ?? []) {
        if (child.className?.split(' ').includes(cls)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}
class Text extends Node { constructor(value) { super('#text'); this.text = value; } }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('friends screen with uncached reading covers', () => {
  it('keeps both the reading-now and activity placeholders inside their static cover hosts', async () => {
    const doc = { createElement: (tag) => new Node(tag), createTextNode: (text) => new Text(text), addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const host = new Node('div');
    const tables = {
      accounts: [{ user_id: 'me' }, { user_id: 'friend' }],
      profiles: [{ user_id: 'friend', display_name: 'صديق' }],
      activity: [{ id: 'done', actor_id: 'friend', verb: 'CHAPTER_DONE', series_ref: 'ext:one', created_at: Date.now() }],
    };
    const sync = { user: { userId: 'me' }, rows: (table, filter) => (tables[table] ?? []).filter(filter ?? (() => true)) };
    const mounted = [];
    const friends = createFriends({
      sync, host, section: () => 'manga', visible: () => true,
      presence: async () => [{ userId: 'friend', status: 'READING', screen: 'MANGA', seriesRef: 'ext:one', seriesTitle: 'عمل واحد' }],
      avatarNode: () => new Node('span'),
      workFromRef: (id) => ({ id, title: { english: 'عمل واحد' } }),
      mountImage: (cover) => {
        mounted.push(cover);
        cover.replaceChildren(imageLoadingNode(doc));
        return Promise.resolve(null);
      },
      mediaUrl: () => '',
    });
    friends.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mounted.some((cover) => cover.className === 'sx-cover')).toBe(true);
    expect(mounted.some((cover) => cover.className === 'sx-cover sx-cover--sm')).toBe(true);
    for (const cover of mounted) {
      expect(cover.style.position).toBeUndefined();
      expect(cover.children[0].style).toMatchObject({ position: 'relative', inset: 'auto', width: '100%', height: '100%' });
    }
    friends.hide();
  });
});

describe('friends live presence', () => {
  it('refreshes visible friends within five seconds without waiting for a profile, and stops when hidden', async () => {
    vi.useFakeTimers();
    const listeners = new Map();
    const doc = {
      hidden: false, createElement: (tag) => new Node(tag), createTextNode: (value) => new Text(value),
      addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type),
    };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const host = new Node('div');
    const tables = { accounts: [{ user_id: 'me' }, { user_id: 'friend' }], profiles: [{ user_id: 'friend', display_name: 'صديق' }] };
    const sync = { user: { userId: 'me' }, rows: (table, filter) => (tables[table] ?? []).filter(filter ?? (() => true)) };
    let status = 'ONLINE';
    let calls = 0;
    const friends = createFriends({
      sync, host, section: () => 'manga', visible: () => true,
      presence: async () => { calls++; return [{ userId: 'friend', status, lastSeenAt: Date.now() }]; },
      avatarNode: () => new Node('span'),
      workFromRef: (id) => ({ id }), mountImage: () => Promise.resolve(null), mediaUrl: () => '',
    });
    friends.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector('.sx-pal--on')).toBeTruthy();
    status = 'OFFLINE';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2);
    expect(host.querySelector('.sx-pal--off')).toBeTruthy();
    const face = host.querySelector('.sx-pal--off');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(3);
    expect(host.querySelector('.sx-pal--off')).toBe(face);
    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(3);
    doc.hidden = false;
    listeners.get('visibilitychange')();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(4);
    friends.hide();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toBe(4);
    expect(listeners.has('visibilitychange')).toBe(false);
  });
});
