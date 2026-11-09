import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { createUnifiedView } from './unified-view.js';
import { createUnifiedDiscover } from './unified-discover.js';
import { dayLineup, heroOrder, passes, readFilter, until } from './unified-view.js';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 8, 15, 0); // 6 مساءً بتوقيت مكة

describe('الرئيسية الموحدة', () => {
  it('البنر يتناوب أنمي ثم مانجا ثم سينما، ومع الفلتر نوعه وحده', () => {
    const pools = { anime: ['a1', 'a2'], manga: ['m1', 'm2'], cinema: ['c1'] };
    expect(heroOrder(pools, 'all')).toEqual(['a1', 'm1', 'c1', 'a2', 'm2']);
    expect(heroOrder(pools, 'manga')).toEqual(['m1', 'm2']);
  });

  it('الفلتر: السينما تشمل الأفلام والمسلسلات، و«الكل» يشمل الجميع', () => {
    expect(passes('movie', 'cinema')).toBe(true);
    expect(passes('series', 'cinema')).toBe(true);
    expect(passes('anime', 'cinema')).toBe(false);
    expect(passes('manga', 'all')).toBe(true);
  });

  it('جدول اليوم بتوقيت مكة: القادم أولًا بترتيبه، ثم ما نزل الأحدث فالأقدم', () => {
    const week = [NOW - 3 * H, NOW - 1 * H, NOW + 1 * H, NOW + 2 * H, NOW + 8 * H].map((airingAt, i) => ({ id: i, airingAt }));
    expect(dayLineup(week, 0, NOW).map((e) => e.id)).toEqual([2, 3, 1, 0]);
    expect(dayLineup(week, 1, NOW).map((e) => e.id)).toEqual([4]); // بعد منتصف الليل بمكة: الغد
  });

  it('المدة المتبقية بالعربية', () => {
    expect(until(NOW + 18 * 60_000, NOW)).toBe('بعد 18 د');
    expect(until(NOW + 2 * H + 49 * 60_000, NOW)).toBe('بعد 2 س 49 د');
  });

  it('الفلتر المحفوظ يُقرأ، وأي قيمة غريبة تعود «الكل»', () => {
    const s = (v) => ({ getItem: () => v });
    expect(readFilter(s('"anime"'))).toBe('anime');
    expect(readFilter(s('"x"'))).toBe('all');
    expect(readFilter(s('{bad'))).toBe('all');
  });
});

describe('unified modal lifecycle: work must not appear behind a blocking page', () => {
  const setup = () => {
    const {document} = parseHTML('<html><body><div class="v35"><div id="allHome"></div></div></body></html>');
    const el = (tag, cls, value) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (value !== undefined && value !== null) n.textContent = value;
      return n;
    };
    const glyph = () => '';
    return {document, el, glyph};
  };
  it('keeps Trending and Updates subpage DOM and scroll while a work opens, then restores it', () => {
    const {document,el,glyph}=setup();
    const home=document.getElementById('allHome');
    const view=createUnifiedView({
      el,glyph, data:{
        continue:()=>[],animeHome:()=>({trending:[]}),cinema:()=>({movie:[],series:[]}),
        mangaPopular:()=>[{id:'ext:one',title:'One',cover:'https://c/1'}],mangaRecent:()=>[],seriesUpdates:()=>[],
        cover:()=>false,
      }, open:{browse:()=>{},manga:()=>{},anime:()=>{},cinema:()=>{}}, reducedMotion:()=>true,
    });
    try {
      view.mount(home);
      const trending=[...home.querySelectorAll('.uv-door')].find(x=>x.textContent.includes('الرائج'));
      trending.onclick();
      const modal=document.querySelector('.uv-page');
      expect(modal).toBeTruthy();
      modal.scrollTop=380;
      expect(view.suspend()).toBe(true);
      expect(view.back()).toBe(false); // Android Back must navigate out of the work, not dismiss the suspended origin
      view.hideSuspended();
      expect(modal.style.visibility).toBe('hidden');
      expect(modal.getAttribute('aria-hidden')).toBe('true');
      expect(view.resume()).toBe(true);
      expect(modal.isConnected).toBe(true);
      expect(modal.style.visibility).toBe('');
      expect(modal.scrollTop).toBe(380);
      expect(view.back()).toBe(true);
    } finally { view.destroy(); }
  });
  it('opens real manga genre results in the unified overlay instead of handing off to source-only empty collections', async () => {
    const {document,el,glyph}=setup();
    const root=document.querySelector('.v35');
    let requested=[], opened=[];
    const view=createUnifiedDiscover({
      el,glyph, genres:()=>[{id:'Drama',label:'دراما'}],
      results:async(type,genre)=>{requested.push([type,genre]);return [{id:'ext:one',title:{english:'One'},coverImage:{large:'https://c/one'}}];},
      card:(it)=>({title:it.title.english,cover:it.coverImage.large}),open:(it,type)=>opened.push([it.id,type]),
      openMangaGenre:()=>{throw new Error('source-only route must not be used');},
      trending:()=>[],openSearch:()=>{},mount:(node)=>root.append(node),
      storage:{getItem:()=> 'manga',setItem:()=>{}},
    });
    view.render(root);
    root.querySelector('.ud-genre').onclick();
    await Promise.resolve(); await Promise.resolve();
    expect(requested).toEqual([['manga','Drama']]);
    const modal=root.querySelector('.uv-page'),poster=modal.querySelector('.uv-po');
    expect(poster).toBeTruthy();
    modal.scrollTop=220;
    poster.onclick();
    expect(opened).toEqual([['ext:one','manga']]);
    expect(view.suspend()).toBe(true);
    view.hideSuspended();
    expect(modal.style.visibility).toBe('hidden');
    expect(view.back()).toBe(false);
    view.resume();
    expect(modal.scrollTop).toBe(220);
    expect(modal.isConnected).toBe(true);
  });
});
