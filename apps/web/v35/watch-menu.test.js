import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';
import { asButton, moreButton, openWatchMenu, watchMenuItems } from './watch-menu.js';

const dom = () => {
  const { document } = parseHTML('<html><body><main></main></body></html>');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  return { document, el, body: document.querySelector('main') };
};

describe('continue-watching ⋮ menu', () => {
  it('lists favorite, list and remove in order, reflecting current state', () => {
    expect(watchMenuItems({ favorite: false, list: { on: false, name: 'قائمتي' } }).map((i) => [i.key, i.label])).toEqual([
      ['favorite', 'إضافة إلى المفضلة'],
      ['list', 'إضافة إلى «قائمتي»'],
      ['remove', 'حذف من آخر المشاهدات'],
    ]);
    const on = watchMenuItems({ favorite: true, list: { on: true, name: 'أتابعها' } });
    expect(on.map((i) => i.pressed)).toEqual([true, true, undefined]);
    expect(on[1].label).toContain('أتابعها');
    expect(on[2].danger).toBe(true);
  });

  it('hides favorite where there is none (anime guest)', () => {
    expect(watchMenuItems({ favorite: null, list: { on: false, name: 'قائمتي' } }).map((i) => i.key)).toEqual(['list', 'remove']);
  });

  it('wires each sheet item to its action and closes the sheet first', () => {
    const { el, body } = dom();
    const order = [];
    const actions = { favorite: vi.fn(() => order.push('favorite')), list: vi.fn(), remove: vi.fn(() => order.push('remove')) };
    const closeSheet = vi.fn(() => order.push('close'));
    const openSheet = vi.fn((build, opts) => { build(body); expect(opts).toEqual({ tone: 'anime' }); });
    openWatchMenu({ openSheet, closeSheet, el, title: 'Frieren', tone: 'anime', items: watchMenuItems({ favorite: false, list: { on: false, name: 'قائمتي' } }), actions });
    expect(body.querySelector('h3').textContent).toBe('Frieren');
    const items = [...body.querySelectorAll('.sheet-item')];
    expect(items.map((b) => b.dataset.key)).toEqual(['favorite', 'list', 'remove']);
    expect(items[2].className).toContain('sheet-item--danger');
    items[0].onclick();
    items[2].onclick();
    expect(order).toEqual(['close', 'favorite', 'close', 'remove']);
    expect(actions.list).not.toHaveBeenCalled();
  });

  it('the ⋮ button opens its menu without opening the card', () => {
    const { el, body, document } = dom();
    const card = asButton(el('div', 'an-cw'), 'Frieren — الحلقة 3');
    const openCard = vi.fn();
    card.onclick = openCard;
    const open = vi.fn();
    const more = moreButton(el, open, 'خيارات Frieren');
    card.append(more);
    body.append(card);
    more.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(openCard).not.toHaveBeenCalled();
    expect(more.getAttribute('aria-label')).toBe('خيارات Frieren');
    expect(card.getAttribute('role')).toBe('button');
    expect(card.querySelector('button button')).toBeNull();
  });
});
