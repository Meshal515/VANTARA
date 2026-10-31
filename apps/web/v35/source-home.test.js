import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { dominantKind, renderSourceHome, supportsSourceHome } from './source-home.js';

const item = (title, type) => ({ title, type, id: title, url: `/w/${title}`, thumbnail: `https://img.example/${title}.jpg` });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('source home', () => {
  beforeEach(() => { globalThis.document = parseHTML('<html><body></body></html>').document; });
  it('picks the section from the content the source actually returns', () => {
    expect(dominantKind([item('a', 'manga'), item('b', 'anime'), item('c', 'anime')], 'manga')).toBe('anime');
    expect(dominantKind([item('a', 'movie'), item('b', 'series')], 'anime')).toBe('cinema');
    expect(dominantKind([], 'manga')).toBe('manga');
  });

  it('a manga source gets the manga home: hero, four doors and its updates', async () => {
    const adapter = { popular: async () => ({ items: [item('p1', 'manga'), item('p2', 'manga')] }), latest: async () => ({ items: [item('l1', 'manga')] }) };
    const onOpenList = vi.fn(), onOpenWork = vi.fn();
    const root = renderSourceHome({ addon: { name: 'Team X', contentTypes: ['manga'] }, adapter, onOpenList, onOpenWork });
    document.body.append(root);
    await flush(); await flush();
    expect(root.classList.contains('addon-source-home--manga')).toBe(true);
    // شريط رئيسية القسم: VANTARA وشعار الإضافة بجانبه، والقسم مقفل على تخصصها (لا زر تبديل)
    expect(root.querySelector('.header .brand').textContent).toBe('VANTARA');
    expect(root.querySelector('.header .addon-home-logo')).not.toBeNull();
    expect(root.querySelector('.header .brand-section').textContent).toBe('MANGA');
    expect(root.querySelector('[data-act="toggleSections"]')).toBeNull();
    expect(root.querySelector('.hero .hero-slide .hero-name').textContent).toBe('p1');
    expect([...root.querySelectorAll('.shortcut .shortcut-label')].map((n) => n.textContent)).toEqual(['آخر التحديثات', 'الرائج', 'كل الأعمال', 'البحث']);
    root.querySelectorAll('.shortcut')[1].click();
    expect(onOpenList).toHaveBeenCalledWith('popular');
    root.querySelector('.hero-slide').click();
    expect(onOpenWork.mock.calls[0][0].title).toBe('p1');
    root.close();
  });

  it('an anime source gets anime rails, and a mixed item keeps its own type when opened', async () => {
    const adapter = { popular: async () => ({ items: [item('a1', 'anime'), item('m1', 'manga'), item('a2', 'anime')] }), latest: async () => ({ items: [] }) };
    const onOpenWork = vi.fn();
    const root = renderSourceHome({ addon: { name: 'AnimeRift', contentTypes: ['anime', 'manga'] }, adapter, onOpenWork });
    document.body.append(root);
    await flush(); await flush();
    expect(root.classList.contains('addon-source-home--anime')).toBe(true);
    expect(root.querySelector('.header .brand-section').textContent).toBe('ANIME');
    const cards = [...root.querySelectorAll('.an-rail .an-card')];
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['a1', 'm1', 'a2']);
    // الغلاف يظهر حين يُفكّ (صنف .an-img مخفي حتى loaded)
    const img = cards[0].querySelector('img');
    img.onload();
    expect(img.classList.contains('loaded')).toBe(true);
    cards[1].click();
    expect(onOpenWork.mock.calls[0][0].type).toBe('manga');
    root.close();
  });

  it('only sources that can list works get the home page', () => {
    expect(supportsSourceHome({ popular() {} })).toBe(true);
    expect(supportsSourceHome({ search() {} })).toBe(false);
  });
});
