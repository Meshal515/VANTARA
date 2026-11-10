import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createUnifiedView } from './unified-view.js';
import { createUnifiedDiscover } from './unified-discover.js';

// Node/linkedom has no requestAnimationFrame; production WebView provides it.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
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
    await new Promise(resolve => setTimeout(resolve, 0));
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

describe('D-027/D-028: unified All Works stays opaque and reuses category results', () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  function setup(results) {
    const { document } = parseHTML('<html><body><div class="v35"><div id="area"></div></div></body></html>');
    const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className=cls; if(txt!=null)n.textContent=txt;return n; };
    const root=document.querySelector('.v35');
    const view=createUnifiedDiscover({ el,glyph:()=>'', genres:()=>[], results,
      card:(it)=>({title:it.title,cover:null}), open:()=>{},
      openMangaGenre:()=>{},openSearch:()=>{}, trending:()=>[],
      mount:(node)=>root.append(node),
      storage:{getItem:()=> 'anime',setItem:()=>{}},
    });
    return {root,view};
  }
  it('keeps the identical modal, cached cards and per-tab scroll without repeat requests', async () => {
    const calls=[];
    const {root,view}=setup(async(type)=>{calls.push(type);return [{title:type+' title'}];});
    view.openAll('anime');await tick();
    const modal=root.querySelector('.uv-page');
    expect(modal.querySelector('.uv-grid').textContent).toContain('anime title');
    modal.scrollTop=287;
    modal.querySelectorAll('[role=tab]')[1].onclick();
    expect(root.querySelector('.uv-page')).toBe(modal);
    expect(root.querySelectorAll('.uv-page')).toHaveLength(1);
    expect(modal.classList.contains('in')).toBe(true);
    await tick();
    expect(modal.querySelector('.uv-grid').textContent).toContain('manga title');
    modal.querySelectorAll('[role=tab]')[0].onclick();
    expect(modal.querySelector('.uv-grid').textContent).toContain('anime title');
    expect(modal.querySelector('.uv-grid').children).toHaveLength(1);
    expect(modal.scrollTop).toBe(287);
    expect(calls).toEqual(['anime','manga']);
    expect(view.back()).toBe(true);
  });
  it('suppresses stale responses and shares in-flight requests, and retries network errors', async () => {
    let resolveAnime, animeCalls=0, mangaCalls=0;
    const {root,view}=setup((type)=>{
      if(type==='anime'){animeCalls++;return new Promise(resolve=>{resolveAnime=resolve;});}
      mangaCalls++;return mangaCalls===1?Promise.reject(new Error('offline')):Promise.resolve([{title:'Manga'}]);
    });
    view.openAll('anime');await tick();
    const modal=root.querySelector('.uv-page');
    modal.querySelectorAll('[role=tab]')[1].onclick();await tick();
    expect(modal.textContent).toContain('تعذّر');
    modal.querySelectorAll('[role=tab]')[0].onclick();await tick();
    expect(animeCalls).toBe(1);
    modal.querySelectorAll('[role=tab]')[1].onclick();await tick();
    expect(modal.querySelector('.uv-grid').textContent).toContain('Manga');
    resolveAnime([{title:'Late Anime'}]);await tick();
    expect(modal.querySelector('.uv-grid').textContent).not.toContain('Late Anime');
    modal.querySelectorAll('[role=tab]')[0].onclick();
    expect(modal.querySelector('.uv-grid').textContent).toContain('Late Anime');
    expect(animeCalls).toBe(1);
    expect(mangaCalls).toBe(2);
  });
});

describe('D-029: internal unified category tabs retain their persistent chrome', () => {
  it('keeps identical modal, title, tab bar and parent when filtering Trending', () => {
    const {document}=parseHTML('<html><body><div class="v35"><div id="allHome"></div></div></body></html>');
    const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
    const view=createUnifiedView({
      el,glyph:()=>'', data:{
        continue:()=>[],animeHome:()=>({trending:[{id:1,title:'Anime',poster:'https://a'}]}),
        cinema:()=>({movie:[{id:2,title:'Movie',poster:'https://b'}],series:[]}),
        mangaPopular:()=>[],mangaRecent:()=>[],seriesUpdates:()=>[],
      },open:{browse:()=>{},anime:()=>{},manga:()=>{},cinema:()=>{}},reducedMotion:()=>true,
    });
    const home=document.getElementById('allHome');
    try{
      view.mount(home);
      [...home.querySelectorAll('.uv-door')].find(x=>x.textContent.includes('الرائج')).onclick();
      const modal=document.querySelector('.uv-page');
      const head=modal.querySelector('.uv-ptop'),body=modal.querySelector('.uv-pbody'),tabs=body.querySelector('.uv-tabs');
      const manga=[...tabs.children].find(x=>x.textContent==='المانجا');manga.onclick();
      expect(document.querySelector('.uv-page')).toBe(modal);
      expect(modal.querySelector('.uv-ptop')).toBe(head);
      expect(modal.querySelector('.uv-pbody')).toBe(body);
      expect(body.querySelector('.uv-tabs')).toBe(tabs);
      expect(manga.classList.contains('on')).toBe(true);
    }finally{view.destroy();}
  });
});

describe('unified latest updates are verified releases, not catalogue listings', () => {
  const NOW = Date.UTC(2026, 10, 10, 9, 0);
  const make = () => {
    const {document} = parseHTML('<html><body><div class="v35"><div id="allHome"></div></div></body></html>');
    const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!=null)n.textContent=value;return n;};
    let chapter=125;
    const data={
      continue:()=>[],animeHome:()=>({trending:[],week:[]}),cinema:()=>({movie:[],series:[]}),
      mangaPopular:()=>[],
      // A catalogue addition is NOT a new chapter and must never enter Updates.
      mangaRecent:()=>[{title:'CATALOGUE ONLY',_updateAt:NOW-1000,_latestChapter:{chapterNumber:999}}],
      mangaUpdates:()=>[{title:'RECORDED MANGA',cover:null,_updateAt:NOW-3600000,_updatePublishedAt:0,_newCount:3,
        _latestChapter:{chapterNumber:chapter},raw:{id:'ext:recorded'}}],
      seriesUpdates:()=>[{x:{id:'tt02',type:'series',title:'SERIES',poster:null},season:2,episode:7,released:NOW-7200000}],
      movieUpdates:()=>[{x:{id:'tt03',type:'movie',title:'MOVIE',poster:null},at:NOW-1800000,publishedAt:NOW-86400000}],
    };
    vi.stubGlobal('document',document);
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify('all'),setItem:()=>{}});
    const root=document.getElementById('allHome');
    const view=createUnifiedView({el,glyph:()=>'',data,now:()=>NOW,reducedMotion:()=>true,
      open:{browse:()=>{},anime:()=>{},manga:()=>{},cinema:()=>{}}});
    return {view,root,document,next:()=>{chapter=126;}};
  };

  it('shows chapter with additional count and observation time, episode number and verified movie event', () => {
    const {view,root,document}=make();
    try {
      view.mount(root);
      const door=[...root.querySelectorAll('.uv-door')].find(x=>x.textContent.includes('آخر التحديثات'));
      expect(door).toBeTruthy();
      expect(door.textContent).toContain('3 تحديثات');
      door.onclick();
      const modal=document.querySelector('.uv-page');
      expect(modal).toBeTruthy();
      expect(modal.querySelectorAll('.uv-up')).toHaveLength(3);
      expect(modal.textContent).toContain('الفصل 125 +2');
      expect(modal.textContent).toContain('رُصد قبل ساعة');
      expect(modal.textContent).toContain('م2 ح7');
      expect(modal.textContent).toContain('MOVIE');
      expect(modal.textContent).not.toContain('CATALOGUE ONLY');
      const movie=[...modal.querySelectorAll('.uv-tabs button')].find(b=>b.textContent==='الأفلام');
      expect(movie).toBeTruthy();
      movie.onclick();
      expect(modal.querySelectorAll('.uv-up')).toHaveLength(1);
      expect(modal.textContent).toContain('فيلم');
      expect(modal.textContent).toContain('رُصد قبل 30 دقيقة');
      expect(modal.textContent).not.toContain('SERIES');
    } finally {view.destroy();vi.unstubAllGlobals();}
  });

  it('repaints when a newly verified chapter replaces one with the same list length', () => {
    const {view,root,next}=make();
    try {
      view.mount(root);
      expect(root.textContent).toContain('الفصل 125');
      next();
      view.refresh({ifChanged:true});
      expect(root.textContent).toContain('الفصل 126');
      expect(root.textContent).not.toContain('الفصل 125');
    } finally {view.destroy();vi.unstubAllGlobals();}
  });

  it('does not fabricate movie or manga releases from non-event catalogues', () => {
    const {view,root}=make();
    try {
      view.mount(root);
      expect(root.textContent).not.toContain('CATALOGUE ONLY');
      expect(root.textContent).not.toContain('999');
    } finally {view.destroy();vi.unstubAllGlobals();}
  });
});
