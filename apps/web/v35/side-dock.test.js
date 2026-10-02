import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { sideDock } from './side-dock.js';

function fakeQuery(matches) {
  const listeners = new Set();
  return {
    matches,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    set(next) {
      this.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

const order = (root) => [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k).join(',');

describe('sideDock', () => {
  it('gathers the picked nodes into one aside on wide screens and restores the exact phone order', () => {
    const { document } = parseHTML('<main id="p"><div class="head"><i data-k="cover"></i><i data-k="meta"></i></div><i data-k="cta"></i><i data-k="src"></i><i data-k="quick"></i></main>');
    const page = document.getElementById('p');
    const phone = order(page);
    const query = fakeQuery(true);
    const pick = () => ['cover', 'cta', 'quick'].map((k) => page.querySelector(`[data-k="${k}"]`));
    sideDock(pick, { query, className: 'side', doc: document });

    const aside = page.querySelector('aside.side');
    expect(aside).not.toBeNull();
    expect([...aside.children].map((n) => n.dataset.k)).toEqual(['cover', 'cta', 'quick']);

    query.set(false);
    expect(page.querySelector('aside')).toBeNull();
    expect(order(page)).toBe(phone);
    expect(page.querySelector('.head').firstElementChild.dataset.k).toBe('cover');

    query.set(true);
    expect(page.querySelector('aside.side').children).toHaveLength(3);
  });

  it('does nothing without matchMedia (tests, old engines)', () => {
    const dock = sideDock(() => [], { query: null, className: 'side' });
    expect(() => dock.apply()).not.toThrow();
  });
});
