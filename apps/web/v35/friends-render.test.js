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

afterEach(() => vi.unstubAllGlobals());

describe('friends screen with uncached reading covers', () => {
  it('keeps both the reading-now and activity placeholders inside their static cover hosts', async () => {
    const doc = { createElement: (tag) => new Node(tag), createTextNode: (text) => new Text(text) };
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
    await Promise.resolve();
    expect(mounted.some((cover) => cover.className === 'sx-cover')).toBe(true);
    expect(mounted.some((cover) => cover.className === 'sx-cover sx-cover--sm')).toBe(true);
    for (const cover of mounted) {
      expect(cover.style.position).toBeUndefined();
      expect(cover.children[0].style).toMatchObject({ position: 'relative', inset: 'auto', width: '100%', height: '100%' });
    }
    friends.hide();
  });
});
