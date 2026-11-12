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
    const animeCard=modal.querySelector('.uv-grid > button');
    modal.scrollTop=287;
    modal.querySelectorAll('[role=tab]')[1].onclick();
    expect(root.querySelector('.uv-page')).toBe(modal);
    expect(root.querySelectorAll('.uv-page')).toHaveLength(1);
    expect(modal.classList.contains('in')).toBe(true);
    await tick();
    expect(modal.querySelector('.uv-grid').textContent).toContain('manga title');
    modal.querySelectorAll('[role=tab]')[0].onclick();
    expect(modal.querySelector('.uv-grid').textContent).toContain('anime title');
    expect(modal.querySelector('.uv-grid > button')).toBe(animeCard);
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
      expect(door.textContent).toContain('3 تحديثًا');
      door.onclick();
      const modal=document.querySelector('.uv-page');
      expect(modal).toBeTruthy();
      expect(modal.querySelectorAll('.uv-up')).toHaveLength(3);
      expect(modal.textContent).toContain('الفصل 125 +2');
      expect(modal.textContent).toContain('رُصد قبل ساعة');
      expect(modal.textContent).toContain('م2 ح7');
      // On a 3-column Android grid, units and timestamps must be independent
      // elements: the old single-line .uv-t2 hid the relative time with ellipsis.
      const mangaCard = modal.querySelector('[data-update-key="manga:ext:recorded"]');
      expect([...mangaCard.querySelector('.uv-update-meta').children].map(node => node.className))
        .toEqual(['uv-update-unit', 'uv-update-when']);
      expect(mangaCard.querySelector('.uv-update-unit').textContent).toBe('الفصل 125 +2');
      expect(mangaCard.querySelector('time.uv-update-when').textContent).toBe('رُصد قبل ساعة');
      const seriesCard = modal.querySelector('[data-update-key="series:tt02"]');
      expect(seriesCard.querySelector('.uv-update-unit').textContent).toBe('م2 ح7');
      expect(seriesCard.querySelector('time.uv-update-when').textContent).toBe('قبل 2 س');
      const movieCard = modal.querySelector('[data-update-key="movie:tt03"]');
      expect(movieCard.querySelector('.uv-update-unit').textContent).toBe('فيلم');
      expect(movieCard.querySelector('time.uv-update-when').textContent).toBe('رُصد قبل 30 دقيقة');
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

  // #323 U-03: «فصول وحلقات وأفلام» بلا حلقات أنمي؛ الآن أحداث Update Engine للأنمي بتبويب «الأنمي»
  it('anime episodes from the Update Engine appear in «all» and under their own tab (U-03)', () => {
    const {view,root,document}=make();
    const original=view;
    try {
      // نفس الإعداد مع أحداث أنمي
      original.destroy();
      const {document:doc}=parseHTML('<html><body><div class="v35"><div id="allHome"></div></div></body></html>');
      const el=(tag,cls,value)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(value!=null)n.textContent=value;return n;};
      vi.stubGlobal('document',doc);
      vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify('all'),setItem:()=>{}});
      const opened=[];
      const v=createUnifiedView({el,glyph:()=>'',now:()=>NOW,reducedMotion:()=>true,
        data:{continue:()=>[],animeHome:()=>({trending:[],week:[]}),cinema:()=>({movie:[],series:[]}),mangaPopular:()=>[],mangaRecent:()=>[],mangaUpdates:()=>[],seriesUpdates:()=>[],movieUpdates:()=>[],
          animeUpdates:()=>[{x:{id:154587,title:'Frieren',poster:null},episode:12,more:2,at:NOW-3600000}]},
        open:{browse:()=>{},anime:(x)=>opened.push(x.id),manga:()=>{},cinema:()=>{}}});
      const host=doc.getElementById('allHome');
      v.mount(host);
      const card=host.querySelector('[data-update-key="anime:154587"]');
      expect(card).toBeTruthy();
      expect(card.querySelector('.uv-update-unit').textContent).toBe('الحلقة 12 +1');
      card.onclick();
      expect(opened).toEqual([154587]);
      const tab=[...host.querySelectorAll('.uv-days button')].find(b=>b.textContent==='الأنمي');
      expect(tab).toBeTruthy();
      v.destroy();
    } finally {vi.unstubAllGlobals();}
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
  it('refreshes only the update shelf without replacing hero, other rails, or the old cover DOM', () => {
    const {view,root,next}=make();
    try {
      view.mount(root);
      const hero=root.querySelector('.uv-hero');
      const browse=root.querySelector('.uv-browse');
      const main=root.querySelector('.uv-body');
      const trendDoor=[...root.querySelectorAll('.uv-door')].find(x=>x.textContent.includes('الرائج'));
      const original=[...root.querySelectorAll('.uv-body .uv-up')].find(x=>x.textContent.includes('RECORDED MANGA'));
      expect(original).toBeTruthy();
      next();
      view.refreshUpdates();
      const revised=[...root.querySelectorAll('.uv-body .uv-up')].find(x=>x.textContent.includes('RECORDED MANGA'));
      expect(revised).toBe(original);
      expect(revised.textContent).toContain('الفصل 126');
      expect(root.querySelector('.uv-hero')).toBe(hero);
      expect(root.querySelector('.uv-browse')).toBe(browse);
      expect(root.querySelector('.uv-body')).toBe(main);
      expect([...root.querySelectorAll('.uv-door')].find(x=>x.textContent.includes('الرائج'))).toBe(trendDoor);
    } finally {view.destroy();vi.unstubAllGlobals();}
  });

  it('keeps the updates modal itself and its scroll when a later chapter arrives', () => {
    const {view,root,document,next}=make();
    try {
      view.mount(root);
      const door=root.querySelector('[data-uv-door="updates"]');
      door.onclick();
      const modal=document.querySelector('.uv-page');
      expect(modal).toBeTruthy();
      modal.scrollTop=320;
      next();
      view.refreshUpdates();
      expect(document.querySelector('.uv-page')).toBe(modal);
      expect(modal.scrollTop).toBe(320);
      expect(modal.textContent).toContain('الفصل 126');
    } finally {view.destroy();vi.unstubAllGlobals();}
  });

});

it('restores each home filter with its original cards and scroll positions', () => {
  const {document}=parseHTML('<html><body><div id="allHome"></div></body></html>');
  const win=document.defaultView;
  let y=0;
  Object.defineProperty(win, 'scrollY', {configurable:true,get:()=>y});
  win.scrollTo=(_x, top)=>{y=top;};
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const view=createUnifiedView({el,glyph:()=>'',data:{continue:()=>[],animeHome:()=>({trending:[{id:1,title:'Anime',poster:'a'}]}),cinema:()=>({movie:[],series:[]}),mangaPopular:()=>[{title:'Manga',cover:'m'}],mangaUpdates:()=>[],seriesUpdates:()=>[],movieUpdates:()=>[]},open:{browse:()=>{},anime:()=>{},manga:()=>{},cinema:()=>{}},reducedMotion:()=>true});
  try {
    const host=document.getElementById('allHome');view.mount(host);
    const body=host.querySelector('.uv-body'), card=body.querySelector('.uv-po'), rail=body.querySelector('.uv-rail');
    rail.scrollLeft=175;y=1900;
    const filter=(label)=>[...host.querySelectorAll('.uv > .uv-tabs button')].find(b=>b.textContent===label).onclick();
    filter('المانجا'); y=150; view.refreshUpdates();
    filter('الكل');
    expect(host.querySelector('.uv-body')).toBe(body);
    expect(host.querySelector('.uv-body .uv-po')).toBe(card);
    expect(host.querySelector('.uv-body .uv-rail').scrollLeft).toBe(175);
    expect(y).toBe(1900);
  } finally {view.destroy();}
});

it('uses artwork arriving after the fallback deadline on the next schedule render', async () => {
  vi.useFakeTimers();
  const {document}=parseHTML('<html><body><div id="allHome"></div></body></html>');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  let resolveArt;
  const animeArt=vi.fn(()=>new Promise(r=>{resolveArt=r;}));
  const view=createUnifiedView({el,glyph:()=>'',now:()=>NOW,data:{continue:()=>[],animeHome:()=>({trending:[],week:[{id:17,title:'Episode',episode:1,airingAt:NOW+1000,banner:'/fallback'}]}),animeArt,cinema:()=>({movie:[],series:[]}),mangaPopular:()=>[],mangaUpdates:()=>[],seriesUpdates:()=>[],movieUpdates:()=>[]},open:{browse:()=>{},anime:()=>{},manga:()=>{},cinema:()=>{}},reducedMotion:()=>true});
  try {
    const host=document.getElementById('allHome');view.mount(host);
    await vi.advanceTimersByTimeAsync(4000);
    expect(host.querySelector('.uv-slot-img').getAttribute('src')).toBe('/fallback');
    resolveArt({fanart:'/late-art'});await vi.advanceTimersByTimeAsync(0);
    view.refresh();await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector('.uv-slot-img').getAttribute('src')).toBe('/late-art');
    expect(animeArt).toHaveBeenCalledTimes(1);
  } finally {view.destroy();vi.useRealTimers();}
});

it('retries schedule artwork after a failed request', async () => {
  vi.useFakeTimers();
  const {document}=parseHTML('<html><body><div id="allHome"></div></body></html>');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const animeArt=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({fanart:'/recovered'});
  const view=createUnifiedView({el,glyph:()=>'',now:()=>NOW,data:{continue:()=>[],animeHome:()=>({trending:[],week:[{id:17,title:'Episode',episode:1,airingAt:NOW+1000,banner:'/fallback'}]}),animeArt,cinema:()=>({movie:[],series:[]}),mangaPopular:()=>[],mangaUpdates:()=>[],seriesUpdates:()=>[],movieUpdates:()=>[]},open:{browse:()=>{},anime:()=>{},manga:()=>{},cinema:()=>{}},reducedMotion:()=>true});
  try {
    const host=document.getElementById('allHome');view.mount(host);await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector('.uv-slot-img').getAttribute('src')).toBe('/fallback');
    view.refresh();await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector('.uv-slot-img').getAttribute('src')).toBe('/recovered');
    expect(animeArt).toHaveBeenCalledTimes(2);
  } finally {view.destroy();vi.useRealTimers();}
});

it('loads additional unified manga catalogue pages without losing cached cards', async () => {
  const {document}=parseHTML('<html><body><div class="v35"></div></body></html>');
  const root=document.querySelector('.v35');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const results=vi.fn(async(_type,_genre,page)=>page===1?{items:[{id:'1',title:'First'}],hasNext:true}:{items:[{id:'2',title:'Second'}],hasNext:false});
  const view=createUnifiedDiscover({el,glyph:()=>'',genres:()=>[],results,card:x=>({title:x.title}),open:()=>{},openMangaGenre:()=>{},openSearch:()=>{},trending:()=>[],mount:n=>root.append(n),storage:{getItem:()=> 'manga',setItem:()=>{}}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  view.openAll('manga');await tick();
  const modal=root.querySelector('.uv-page'), first=modal.querySelector('.uv-grid button');
  const more=[...modal.querySelectorAll('button')].find(b=>b.textContent==='تحميل المزيد');
  expect(more).toBeTruthy();more.click();more.click();await tick();
  expect(results.mock.calls.map(c=>c[2])).toEqual([1,2]);
  expect([...modal.querySelectorAll('.uv-grid button')].map(n=>n.textContent)).toEqual(['First','Second']);
  expect(modal.querySelector('.uv-grid button')).toBe(first);
  expect([...modal.querySelectorAll('button')].some(b=>b.textContent==='تحميل المزيد')).toBe(false);
});

it('keeps the correct category while a second page is delayed and retries a failed page', async () => {
  const {document}=parseHTML('<html><body><div class="v35"></div></body></html>');
  const root=document.querySelector('.v35');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  let resolvePage, attempts=0;
  const results=vi.fn((type,_genre,page)=>{
    if(type==='anime')return Promise.resolve({items:[{id:'a',title:'Anime'}],hasNext:false});
    if(page===1)return Promise.resolve({items:[{id:'1',title:'First'}],hasNext:true});
    if(++attempts===1)return Promise.reject(new Error('offline'));
    return new Promise(resolve=>{resolvePage=resolve;});
  });
  const view=createUnifiedDiscover({el,glyph:()=>'',genres:()=>[],results,card:x=>({title:x.title}),open:()=>{},openMangaGenre:()=>{},openSearch:()=>{},trending:()=>[],mount:n=>root.append(n),storage:{getItem:()=> 'manga',setItem:()=>{}}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  view.openAll('manga');await tick();const modal=root.querySelector('.uv-page');
  const more=()=>[...modal.querySelectorAll('button')].find(b=>b.textContent==='تحميل المزيد'||b.textContent==='أعد المحاولة');
  more().click();await tick();expect(more().textContent).toBe('أعد المحاولة');
  more().click();await tick();modal.querySelectorAll('[role=tab]')[0].click();await tick();
  resolvePage({items:[{id:'1',title:'Duplicate'},{id:'2',title:'Second'}],hasNext:false});await tick();
  expect(modal.querySelector('.uv-grid').textContent).toContain('Anime');
  modal.querySelectorAll('[role=tab]')[1].click();
  expect([...modal.querySelectorAll('.uv-grid button')].map(n=>n.textContent)).toEqual(['First','Second']);
  expect(attempts).toBe(2);
});

it('loads the next catalogue page when the sentinel is visible and disconnects it on close', async () => {
  const observers=[];
  class Observer { constructor(cb){this.cb=cb;this.disconnect=vi.fn();observers.push(this);} observe(node){this.node=node;} }
  vi.stubGlobal('IntersectionObserver',Observer);
  const {document}=parseHTML('<html><body><div class="v35"></div></body></html>');
  const root=document.querySelector('.v35');const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const results=vi.fn(async(_type,_genre,page)=>({items:[{id:String(page),title:'Page '+page}],hasNext:page===1}));
  const view=createUnifiedDiscover({el,glyph:()=>'',genres:()=>[],results,card:x=>({title:x.title}),open:()=>{},openMangaGenre:()=>{},openSearch:()=>{},trending:()=>[],mount:n=>root.append(n),storage:{getItem:()=> 'manga',setItem:()=>{}}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  try {
    view.openAll('manga');await tick();expect(observers).toHaveLength(1);
    observers[0].cb([{isIntersecting:true}]);await tick();
    expect(root.querySelector('.uv-grid').textContent).toContain('Page 2');
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(view.back()).toBe(true);
  } finally {vi.unstubAllGlobals();}
});

it('does not start catalogue scrolling while its origin is suspended behind a work', async () => {
  const observers=[];
  class Observer {constructor(cb){this.cb=cb;observers.push(this);}observe(){}disconnect(){}}
  vi.stubGlobal('IntersectionObserver',Observer);
  const {document}=parseHTML('<html><body><div class="v35"></div></body></html>');const root=document.querySelector('.v35');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const view=createUnifiedDiscover({el,glyph:()=>'',genres:()=>[],results:async()=>({items:[{id:'1',title:'First'}],hasNext:true}),card:x=>({title:x.title}),open:()=>{},openMangaGenre:()=>{},openSearch:()=>{},trending:()=>[],mount:n=>root.append(n),storage:{getItem:()=> 'manga',setItem:()=>{}}});
  try {
    view.openAll('manga');expect(view.suspend()).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,0));expect(observers).toHaveLength(0);
    expect(view.resume()).toBe(true);expect(observers).toHaveLength(1);
    view.back();
  } finally {vi.unstubAllGlobals();}
});

it('ignores an observer callback queued before switching catalogue type', async () => {
  const observers=[];
  class Observer {constructor(cb){this.cb=cb;observers.push(this);}observe(){}disconnect(){}}
  vi.stubGlobal('IntersectionObserver',Observer);
  const {document}=parseHTML('<html><body><div class="v35"></div></body></html>');const root=document.querySelector('.v35');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const results=vi.fn(async(type,_genre,page)=>({items:[{id:type,title:type}],hasNext:type==='manga'&&page===1}));
  const view=createUnifiedDiscover({el,glyph:()=>'',genres:()=>[],results,card:x=>({title:x.title}),open:()=>{},openMangaGenre:()=>{},openSearch:()=>{},trending:()=>[],mount:n=>root.append(n),storage:{getItem:()=> 'manga',setItem:()=>{}}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  try {
    view.openAll('manga');await tick();const old=observers[0];
    root.querySelectorAll('[role=tab]')[0].click();await tick();
    old.cb([{isIntersecting:true}]);await tick();
    expect(results.mock.calls.map(c=>[c[0],c[2]])).toEqual([['manga',1],['anime',1]]);
    view.back();
  } finally {vi.unstubAllGlobals();}
});

it('retains the first card while loading fifty catalogue pages without duplicates', async () => {
  const {document}=parseHTML('<html><body><div class="v35"></div></body></html>');const root=document.querySelector('.v35');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  const results=vi.fn(async(_type,_genre,page)=>({items:[{id:String(page),title:'Work '+page}],hasNext:page<50}));
  const view=createUnifiedDiscover({el,glyph:()=>'',genres:()=>[],results,card:x=>({title:x.title}),open:()=>{},openMangaGenre:()=>{},openSearch:()=>{},trending:()=>[],mount:n=>root.append(n),storage:{getItem:()=> 'manga',setItem:()=>{}}});
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  view.openAll('manga');await tick();const first=root.querySelector('.uv-grid button');
  for(let page=2;page<=50;page++){root.querySelector('[data-ud-more]').click();await tick();}
  expect(results).toHaveBeenCalledTimes(50);
  expect(root.querySelectorAll('.uv-grid button')).toHaveLength(50);
  expect(root.querySelector('.uv-grid button')).toBe(first);
  expect(root.querySelector('[data-ud-more]')).toBeNull();view.back();
});

it('keeps loaded manga cards and horizontal scroll when anime data arrives', () => {
  const {document}=parseHTML('<html><body><div id="allHome"></div></body></html>');
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;};
  let anime=null, manga={id:'m1',title:'Manga',cover:'/manga'};const openManga=vi.fn();
  const view=createUnifiedView({el,glyph:()=>'',data:{continue:()=>[],animeHome:()=>anime,cinema:()=>({movie:[],series:[]}),mangaPopular:()=>[manga],mangaUpdates:()=>[],seriesUpdates:()=>[],movieUpdates:()=>[]},open:{browse:()=>{},anime:()=>{},manga:openManga,cinema:()=>{}},reducedMotion:()=>true});
  try {
    const host=document.getElementById('allHome');view.mount(host);
    const section=[...host.querySelectorAll('.uv-body .uv-sec')].find(n=>n.querySelector('h2')?.textContent==='المانجا الرائجة');
    const card=section.querySelector('.uv-po'),rail=section.querySelector('.uv-rail');rail.scrollLeft=170;
    anime={trending:[{id:1,title:'Anime',poster:'/anime'}]};view.refresh();
    const next=[...host.querySelectorAll('.uv-body .uv-sec')].find(n=>n.querySelector('h2')?.textContent==='المانجا الرائجة');
    expect(next.querySelector('.uv-po')===card).toBe(true);expect(next.querySelector('.uv-rail').scrollLeft).toBe(170);
    expect(host.textContent).toContain('Anime');
    manga={id:'m1',title:'Updated manga',cover:'/new'};view.refresh();
    const updated=[...host.querySelectorAll('.uv-body .uv-sec')].find(n=>n.querySelector('h2')?.textContent==='المانجا الرائجة').querySelector('.uv-po');
    expect(updated===card).toBe(false);updated.click();expect(openManga).toHaveBeenCalledWith(manga);
  } finally {view.destroy();}
});

// #323 U-05/U-10: «اكتشف» الموحد يُبنى مرة، ويتحدث «الرائج» وحده حين تصل البيانات
describe('#323 unified discover keeps its page and fills trending when data arrives', () => {
  function setup() {
    const { document } = parseHTML('<html><body><div class="v35"><div id="area"></div></div></body></html>');
    const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
    let tr = [];
    const view = createUnifiedDiscover({ el, glyph: () => '', genres: () => [{ id: 'Drama', label: 'دراما' }], results: async () => [],
      card: (it) => ({ title: it.title, cover: null }), open: () => {}, openMangaGenre: () => {}, openSearch: () => {},
      trending: () => tr, mount: () => {}, storage: { getItem: () => 'anime', setItem: () => {} } });
    return { host: document.querySelector('#area'), view, setTrending: (v) => { tr = v; } };
  }
  it('a page shown before the data leaves «نجهّز الرائج…» as soon as trending arrives (U-05)', () => {
    const { host, view, setTrending } = setup();
    view.render(host);
    expect(host.textContent).toContain('نجهّز الرائج');
    setTrending([{ item: { id: 1, title: 'Frieren' }, group: 'anime' }]);
    view.refreshTrending?.();
    expect(host.querySelectorAll('.us-rank-row')).toHaveLength(1);
    expect(host.textContent).not.toContain('نجهّز الرائج');
  });
  it('visiting again keeps the same nodes; unchanged trending is not rebuilt (U-10)', () => {
    const { host, view, setTrending } = setup();
    setTrending([{ item: { id: 1, title: 'Frieren' }, group: 'anime' }]);
    view.render(host);
    const page = host.firstChild, row = host.querySelector('.us-rank-row'), tile = host.querySelector('.ud-genre');
    view.render(host);
    expect(host.firstChild).toBe(page);
    expect(host.querySelector('.us-rank-row')).toBe(row);
    expect(host.querySelector('.ud-genre')).toBe(tile);
    setTrending([{ item: { id: 2, title: 'Dandadan' }, group: 'anime' }]);
    view.render(host);
    expect(host.firstChild).toBe(page);
    expect(host.querySelector('.us-rank-row .us-t1').textContent).toBe('Dandadan');
  });
});
