import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reconcileCardNodes } from './card-reconcile.js';

describe('manga cards across source updates', () => {
  it('retains each cover node when only the latest chapter or chapter count changes', () => {
    const target = { children: [], moves: 0, insertBefore(node, before) {
      const old = this.children.indexOf(node);
      if (old >= 0) this.children.splice(old, 1);
      const index = before == null ? this.children.length : this.children.indexOf(before);
      this.children.splice(index, 0, node);
      this.moves++;
    } };
    const create = (work) => ({ dataset: { workId: String(work.id) }, cover: {}, work, remove() {
      target.children.splice(target.children.indexOf(this), 1);
    } });
    const update = (node, work) => { node.work = work; };
    reconcileCardNodes(target, [{ id: 'a', chapters: 30 }, { id: 'b', chapters: 9 }], create, update);
    const [a, b] = target.children;
    reconcileCardNodes(target, [{ id: 'a', chapters: 31 }, { id: 'b', chapters: 9 }], create, update);
    expect(target.children).toEqual([a, b]);
    expect(target.moves).toBe(2);
    expect(a.work.chapters).toBe(31);

    reconcileCardNodes(target, [{ id: 'b', chapters: 9 }, { id: 'c', chapters: 1 }], create, update);
    expect(target.children[0]).toBe(b);
    expect(target.children[1].dataset.workId).toBe('c');
    expect(target.moves).toBe(4);
    expect(b.cover).toBeDefined();
  });
});

describe('a card blocked after it appeared (AF2)', () => {
  const shell = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./manga.css', import.meta.url), 'utf8');
  it('keeps its slot hidden instead of removing it, so the grid does not jump', () => {
    const line = shell.split('\n').find((l) => l.includes('rated.adult'));
    expect(line).toContain('hideBlockedCard(a)');
    expect(line).not.toContain('a.remove()');
    expect(shell).toMatch(/function hideBlockedCard\(a\) \{[^}]*a\.inert = true/);
    expect(css).toMatch(/\[data-blocked\] \{ visibility: hidden;/);
  });
});
