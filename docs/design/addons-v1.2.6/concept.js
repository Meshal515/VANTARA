(() => {
'use strict';
const IMG = window.Y_IMG || {};
const SHELLS = window.Y_SHELLS;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
// نظام الحركة (اعتماد المالك، حد أعلى 270ms): منحنى خروج واحد للدخول، ومنحنى دخول للمغادرة
const M = { enter: 260, leave: 110, sheetIn: 260, sheetOut: 160, press: 160, tab: 160, ind: 240, flip: 260, toast: 200 };
const EASE = 'cubic-bezier(.22,1,.36,1)';
const EIN = 'cubic-bezier(.4,0,1,1)';
const SPRING = 'cubic-bezier(.34,1.45,.64,1)';
let D = innerWidth >= 1000;

// ── الأيقونات: شبكة 24، خط 2، أطراف دائرية ──
const P = {
  pin: '<path d="M8.75 3.5h6.5l-.7 5.5 3.7 3.65v2.1H5.75v-2.1L9.45 9z"/><path d="M12 14.75v6"/>',
  pinOn: '<path d="M8.75 3.5h6.5l-.7 5.5 3.7 3.65v2.1H5.75v-2.1L9.45 9z" fill="currentColor"/><path d="M12 14.75v6"/>',
  open: '<path d="M14.5 6 8.5 12l6 6"/>',
  back: '<path d="M9.5 6l6 6-6 6"/>',
  search: '<circle cx="10.75" cy="10.75" r="6.25"/><path d="m15.5 15.5 4.75 4.75"/>',
  plus: '<path d="M12 5.25v13.5M5.25 12h13.5"/>',
  sliders: '<path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="15" cy="7.5" r="2.5"/><circle cx="9" cy="16.5" r="2.5"/>',
  update: '<path d="M12 4v10.5M7.75 10.25 12 14.5l4.25-4.25M5 19.5h14"/>',
  retry: '<path d="M4.75 12a7.25 7.25 0 1 0 2.2-5.2L4.75 9"/><path d="M4.75 4.75V9H9"/>',
  trash: '<path d="M4.75 7h14.5M9.75 7V4.75h4.5V7M6.75 7l.75 12.25h9L17.25 7"/>',
  grip: '<path d="M7 9h10M7 15h10"/>',
  more: '<circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l2.5-2.5a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-2.5 2.5a4.2 4.2 0 0 0 6 6l1-1"/>',
  check: '<path d="m5.5 12.5 4.25 4.25 8.75-9.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  globe: '<circle cx="12" cy="12" r="8.25"/><path d="M3.75 12h16.5M12 3.75c2.4 2.3 3.6 5 3.6 8.25S14.4 18 12 20.25C9.6 18 8.4 15.25 8.4 12S9.6 6.05 12 3.75z"/>',
  downMove: '<path d="M12 5v14m-5.5-5.5L12 19l5.5-5.5"/>',
  down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="3"/><path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5"/>',
  repo: '<rect x="4" y="4.5" width="16" height="15" rx="3.5"/><path d="M4 9.5h16M8.5 14h7"/>',
  palette: '<path d="M12 3.75a8.25 8.25 0 1 0 0 16.5c1.1 0 1.75-.8 1.75-1.7 0-1.3-1.2-1.6-1.2-2.8 0-.9.75-1.6 1.7-1.6h2.2a3.8 3.8 0 0 0 3.8-3.8C20.25 6.8 16.6 3.75 12 3.75z"/><circle cx="8" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="11.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>',
};
const g = (k, s = D ? 26 : 24) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:${s}px;height:${s}px;stroke-width:2;flex:none">${P[k]}</svg>`;
// علامات المزوّدات: رسم فانتارا الخاص، شبكة 32، عنصر مصمت واحد لكل علامة
const MARK = {
  stremio: '<rect x="4" y="5" width="24" height="22" rx="5" stroke="currentColor" stroke-width="2.5"/><path d="m13 11 8 5-8 5z" fill="currentColor" stroke="none"/>',
  mihon: '<path fill="currentColor" stroke="none" d="M3 6c5-1 9 0 12 3v18c-3-3-7-4-12-3zm26 0c-5-1-9 0-12 3v18c3-3 7-4 12-3z"/><path d="M7 11h4M7 15h4M21 11h4M21 15h4" stroke="var(--surface-2)" stroke-width="1.6"/>',
  cloudstream: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 26a7 7 0 0 1-1-14 9 9 0 0 1 17 2 6 6 0 0 1-1 12zm5-12v9l7-4.5z"/>',
  aniyomi: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 8 4 3l2-1 6 7h8l6-7 2 1-3 5a6 6 0 0 1 5 6v9a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-9a6 6 0 0 1 5-6zm4 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-10 7 5 4 5-4z"/>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const logo = (k, n, cls = '') => MARK[k]
  ? `<span class="y-lg y-mk ${cls}" data-brand="${k}"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:58%;height:58%;stroke-width:2.1">${MARK[k]}</svg></span>`
  : `<span class="y-lg ${cls}">${IMG[k] ? `<img src="${IMG[k]}" alt="">` : `<b>${esc([...String(n).replace(/^[^\p{L}\p{N}]+/u, '')][0] || '?').toUpperCase()}</b>`}</span>`;
const sz = (d, m) => (D ? d : m);

// ── البيانات ──
const PROV = {
  stremio: { name: 'Stremio', kind: 'addons' },
  mihon: { name: 'Mihon', kind: 'ext' },
  cloudstream: { name: 'CloudStream', kind: 'ext' },
  aniyomi: { name: 'Aniyomi', kind: 'ext' },
};
const TYPE = { links: 'روابط', subs: 'ترجمات', cat: 'كتالوج' };
const S = {
  stack: [{ v: 'hub' }],
  provPins: ['stremio', 'mihon'],
  tab: { cloudstream: 'inst', mihon: 'inst', aniyomi: 'inst' },
  filter: 'all', q: '', searching: false, url: '',
  langs: { cloudstream: new Set(['العربية']), mihon: new Set(['العربية']), aniyomi: new Set(['العربية']) },
  repoFilter: { cloudstream: 'all', mihon: 'all', aniyomi: 'all' },
  items: {
    stremio: [
      { id: 'torrentio', name: 'Torrentio', logo: 'torrentio', ver: '0.0.15', nv: '0.0.16', pin: 1, on: 1, conf: 1, type: 'links', cont: 'أفلام · مسلسلات · أنمي', url: 'https://torrentio.strem.fun/manifest.json' },
      { id: 'subsense', name: 'SubSense', logo: 'subsense', ver: '2.4.3', on: 1, conf: 1, type: 'subs', cont: 'أفلام · مسلسلات' },
      { id: 'anicat', name: 'AniCat', logo: 'anicat', ver: '1.2.1', on: 1, conf: 1, type: 'links', cont: 'أنمي' },
      { id: 'opensubs', name: 'OpenSubtitles v3', ver: '1.0.0', on: 1, type: 'subs', cont: 'أفلام · مسلسلات', url: 'https://opensubtitles-v3.strem.io/manifest.json' },
      { id: 'cinemeta', name: 'Cinemeta', ver: '3.0.14', on: 1, type: 'cat', cont: 'أفلام · مسلسلات', url: 'https://v3-cinemeta.strem.io/manifest.json' },
      { id: 'nuviocat', name: 'Nuvio Catalog', ver: '1.2.0', on: 0, conf: 1, type: 'cat', cont: 'أفلام · مسلسلات' },
    ],
    cloudstream: [
      { id: 'Anime4up', name: 'Anime4up', logo: 'cs_anime4up', ver: '1', pin: 1 },
      { id: 'Akwam', name: 'Akwam', logo: 'cs_akwam', ver: '3', pin: 1 },
      { id: 'AnimeRift', name: 'AnimeRift', logo: 'cs_animerift', ver: '1', nv: '2' },
      { id: 'Animewitcher', name: 'Animewitcher', logo: 'cs_animewitcher', ver: '3' },
      { id: 'Shahid4u', name: 'Shahid4u', logo: 'cs_shahid4u', ver: '2', nv: '3' },
      { id: 'Witanime', name: 'Witanime', logo: 'cs_witanime', ver: '1' },
      { id: '3isk', name: 'قصة عشق', logo: 'cs_3isk', ver: '1' },
      { id: '5TV', name: '5TV', logo: 'cs_5tv', ver: '1', bad: 1 },
      { id: 'Anim3rb', name: 'Anim3rb', ver: '1' },
    ],
    mihon: [
      { id: 'teamx', name: 'Team X', logo: 'teamx', pin: 1 },
      { id: 'azora', name: 'Azora', logo: 'azora', pin: 1 },
      { id: 'hijala', name: 'Hijala', logo: 'hijala' },
      { id: 'mangalek', name: 'مانجا ليك', logo: 'mangalek' },
      { id: 'mangaswat', name: 'MangaSwat', logo: 'mangaswat' },
      { id: 'starz', name: 'Manga Starz', logo: 'starz' },
      { id: 'lionz', name: 'MangaLionz', logo: 'lionz' },
      { id: 'lava', name: 'Lava Scans', logo: 'lava' },
      { id: 'mangalink', name: 'مانجا لينك', logo: 'mangalink' },
      { id: 'million', name: 'Manga Million', logo: 'million' },
    ],
    aniyomi: [],
  },
  avail: {
    // مستودع 3rabi الفعلي (docs/repository-compat/CS3_HOST_SURFACE_ARB.json) ناقص المثبت
    cloudstream: [['Aflaam', 1], ['Aia2tv 2', 3], ['Alooytv', 1], ['Anime-Phoenix', 1, 'phoenix'], ['Animerco', 3], ['Bristege', 1], ['Cee', 1], ['CimaClub', 1], ['Cimalight', 1], ['Cimatn', 1], ['cinemana', 4], ['dima-toon', 1], ['Egy', 1], ['Egydead', 1], ['Elif', 1], ['eseek', 3], ['Faselhd', 3], ['Krmzy', 1], ['Lodynet', 2], ['MyCimaProvider', 1], ['OscarTv', 1], ['Rate', 1], ['Replaymatch', 2], ['Shahidwbas', 1], ['Syria-live', 1], ['Topcinema', 1], ['TukTukcima', 1], ['TuniflexBlog', 1], ['Tuniflix', 1], ['TVgarden', 1], ['Viu', 1], ['Wecima', 1], ['Yacintv', 1], ['Youtube', 2]]
      .map(([n, v, l]) => ({ id: n, name: n, ver: String(v), logo: l, lang: 'العربية' })),
    mihon: [['Onma', 'onma'], ['Manga Tales', 'tales'], ['Despair Manga', 'despair'], ['Dilar', 'dilar'], ['Goon Scans', 'goon'], ['Anyone Manga', 'anyone'], ['MangaSpark', 'spark']]
      .map(([n, l]) => ({ id: l, name: n, logo: l, lang: 'العربية' }))
      .concat([['MangaDex', 'متعدد اللغات'], ['Bato.to', 'متعدد اللغات'], ['Webtoons.com', 'متعدد اللغات'], ['MANGA Plus', 'متعدد اللغات'], ['Asura Scans', 'الإنجليزية'], ['Flame Comics', 'الإنجليزية']].map(([n, lg]) => ({ id: n, name: n, lang: lg }))),
    aniyomi: [],
  },
  repos: {
    cloudstream: [{ name: '3rabi', url: 'https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json', n: 43 }],
    mihon: [{ name: 'Keiyoushi', url: 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json', n: 1248 }],
    aniyomi: [],
  },
  busy: {}, // id -> {p, kind}
};
// A repository ID is stable even if another repository is removed.
for (const p of ['cloudstream','mihon','aniyomi']) {
  for (const r of S.repos[p]) r.id = r.url;
  for (const it of [...S.items[p], ...S.avail[p]]) { it.repoId = S.repos[p][0]?.id; it.repoName = S.repos[p][0]?.name; it.on = 1; }
}
const REPO_STORE='vantara.addons.repositories.v12';
const repoImage = u => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u||'') ? u : safeImage(u);
try{const saved=JSON.parse(localStorage.getItem(REPO_STORE)||'null');if(saved)for(const p of ['cloudstream','mihon','aniyomi'])if(Array.isArray(saved[p]))S.repos[p]=saved[p].filter(r=>r&&typeof r.name==='string'&&typeof r.url==='string'&&/^https?:\/\//.test(r.url));}catch{}
const persistRepos=()=>{try{localStorage.setItem(REPO_STORE,JSON.stringify(S.repos));return true;}catch{return false;}};
const repoOf = (p,it) => S.repos[p]?.find(r=>r.id===it.repoId);
const repoName = (p,it) => repoOf(p,it)?.name || it.repoName || 'غير محدد';
const safeImage = u => { try { const x = new URL(u); return ['https:','http:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
const repoLogo = (r,cls='') => `<span class="y-lg y-repo-logo ${cls}"><b>${esc((r.name||'?').slice(0,1).toUpperCase())}</b>${!r.imageFailed&&repoImage(r.image) ? `<img src="${esc(repoImage(r.image))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
const repoMatches = (p,it) => S.repoFilter[p]==='all' || it.repoId===S.repoFilter[p];
const availFor = p => S.avail[p].filter(it=>!S.items[p].some(x=>x.id===it.id) && S.repos[p].some(r=>r.id===it.repoId) && repoMatches(p,it) && (S.q ? true : S.langs[p]?.has(it.lang)) && match(it.name));
const KNOWN = {
  'torrentio.strem.fun': { name: 'Torrentio', logo: 'torrentio', ver: '0.0.15', conf: 1, type: 'links', cont: 'أفلام · مسلسلات · أنمي' },
  'opensubtitles-v3.strem.io': { name: 'OpenSubtitles v3', ver: '1.0.0', type: 'subs', cont: 'أفلام · مسلسلات' },
  'v3-cinemeta.strem.io': { name: 'Cinemeta', ver: '3.0.14', type: 'cat', cont: 'أفلام · مسلسلات' },
  'watchhub.strem.io': { name: 'WatchHub', ver: '0.4.0', type: 'links', cont: 'أفلام · مسلسلات' },
};
const cur = () => S.stack[S.stack.length - 1];
const pinFirst = (arr) => [...arr.filter((x) => x.pin), ...arr.filter((x) => !x.pin)];
const orderGroups=(p,arr,draw,cls)=>[true,false].map(pin=>{const list=arr.filter(x=>!!x.pin===pin);return list.length?`<section class="y-order-section" data-k="order-${p}-${+pin}"><div class="y-order-head"><span>${pin?'المفضّلة':'البقية'}</span><span>${list.length}</span></div><div class="${cls} y-order-list" data-order="${p}" data-list="installed" data-pin="${+pin}">${list.map(draw).join('')}</div></section>`:'';}).join('');
const shiftGroup=(p,it,top)=>{const a=S.items[p],group=a.filter(x=>!!x.pin===!!it.pin);const idx=group.indexOf(it);if(idx<0)return;group.splice(idx,1);top?group.unshift(it):group.push(it);let i=0;S.items[p]=pinFirst(a.map(x=>!!x.pin===!!it.pin?group[i++]:x));};

// ── الأنماط ──
const css = () => `
.y{color:var(--text-1);padding-bottom:96px;-webkit-tap-highlight-color:transparent}
.y button,.y-sheet button,.y-bar button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:inherit}
.y .y-lg,.y-sheet .y-lg{width:${sz(52, 48)}px;height:${sz(52, 48)}px;border-radius:${sz(14, 13)}px;flex:none;overflow:hidden;background:var(--surface-3);display:grid;place-items:center}
.y-lg img{width:100%;height:100%;object-fit:cover;display:block}
.y-lg b{font-size:${sz(21, 19)}px;font-weight:700;color:var(--text-1)}
.y-lg.y-mk{background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-strong);color:var(--text-1)}
.y .y-lg.xl,.y-sheet .y-lg.xl{width:${sz(72, 64)}px;height:${sz(72, 64)}px;border-radius:${sz(20, 18)}px}
.y .y-lg.xxl{width:${sz(96, 88)}px;height:${sz(96, 88)}px;border-radius:${sz(26, 24)}px}
.y-tx{flex:1;min-width:0}
.y-nm{font-size:${sz(19, 18)}px;font-weight:700;line-height:1.3;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-mt{font-size:${sz(15.5, 15)}px;color:var(--text-3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px}
.y-dot{width:7px;height:7px;border-radius:50%;background:var(--text-1);flex:none}
.y-up{color:var(--text-1);font-weight:600}
.y-bad{color:var(--danger);font-weight:600}
.y-ib{width:${sz(52, 48)}px;height:${sz(52, 48)}px;display:grid!important;place-items:center;color:var(--text-1)!important;flex:none;border-radius:16px;transition:background-color .15s,color .2s}
.y-ib.on{color:var(--accent)!important}
.y-ib.dim{color:var(--text-2)!important}
@media (hover:hover){.y-ib:hover{background:var(--surface-2)}}
.y-spin{animation:y-rot .8s linear infinite}
@keyframes y-rot{to{transform:rotate(-360deg)}}
.y-tools{display:flex;align-items:center;gap:12px;margin-bottom:${sz(20, 16)}px}
.y-lang{height:${sz(48, 46)}px;padding:0 ${sz('16px 0 20px', '14px 0 18px')}!important;border-radius:24px;background:var(--surface-1)!important;display:inline-flex!important;align-items:center;gap:10px;font-size:${sz(16.5, 16)}px!important;font-weight:700!important;color:var(--text-1)!important;max-width:70%}
.y-lang span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-lang i{font-style:normal;font-weight:600;color:var(--text-3)}
.y-head{display:grid;grid-template-columns:auto minmax(0,1fr);gap:${sz(18, 14)}px;align-items:center;margin-bottom:${sz(28, 22)}px}
.y-head .y-nm{font-size:${sz(28, 25)}px}
.y-head .y-mt{font-size:${sz(16, 15)}px}
.y-tabs{position:relative;display:flex;align-items:center;gap:${sz(32, 24)}px;border-bottom:1px solid var(--line-strong);margin-bottom:${sz(22, 18)}px}
.y-tab{height:${sz(54, 50)}px;display:flex!important;align-items:center;gap:8px;font-size:${sz(17, 16.5)}px!important;font-weight:700!important;color:var(--text-3)!important;border-bottom:2px solid transparent!important;margin-bottom:-1px!important;transition:color .15s}
.y-tab.on{color:var(--text-1)!important}
.y-ind{position:absolute;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--accent);pointer-events:none}
.y-tab i{font-style:normal;font-weight:600;font-size:14.5px;color:var(--text-3)}
.y-pri{height:${sz(44, 42)}px;padding:0 ${sz(20, 18)}px!important;border-radius:${sz(14, 13)}px;background:var(--accent)!important;color:var(--on-accent,#fff)!important;font-size:${sz(16, 15.5)}px!important;font-weight:700!important;display:inline-flex!important;align-items:center;justify-content:center;gap:8px;flex:none;transition:opacity .2s}
.y-pri.big{height:52px;font-size:16.5px!important;border-radius:16px}
.y-pri[disabled]{opacity:.35;pointer-events:none}
.y-sec{height:52px;padding:0 20px!important;border-radius:16px;background:var(--surface-3)!important;color:var(--text-1)!important;font-size:16.5px!important;font-weight:700!important;display:inline-flex!important;align-items:center;justify-content:center}
.y-chips{display:flex;gap:8px;margin-bottom:${sz(20, 16)}px;overflow-x:auto;scrollbar-width:none}
.y-chips::-webkit-scrollbar{display:none}
.y-chip{height:${sz(42, 40)}px;padding:0 ${sz(18, 16)}px!important;border-radius:21px;background:var(--surface-1)!important;font-size:${sz(15.5, 15)}px!important;font-weight:600!important;color:var(--text-2)!important;display:inline-flex!important;align-items:center;white-space:nowrap;flex:none;transition:background-color .15s,color .15s}
.y-chip.on{background:var(--text-1)!important;color:var(--bg)!important}
.y-list{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:${sz('6px 10px 6px 18px', '4px 6px 4px 14px')};display:grid;grid-template-columns:repeat(${D ? 2 : 1},minmax(0,1fr));column-gap:${sz(36, 0)}px}
.y-row{display:flex;align-items:center;gap:${sz(16, 14)}px;min-height:${sz(80, 74)}px;padding:${sz(12, 10)}px 0;position:relative;border-top:1px solid var(--line)}
.y-list>.y-row:nth-child(-n+${D ? 2 : 1}){border-top:0}
.y-row[data-y="open"]{cursor:pointer}
.y-prog{position:absolute;inset:auto 0 -1px 0;height:2px;background:var(--surface-3);border-radius:2px;overflow:hidden}
.y-prog i{display:block;height:100%;background:var(--accent);transition:width .25s linear}
.y-out{height:40px;padding:0 18px!important;border-radius:12px;border:1.5px solid var(--line-strong)!important;font-size:15px!important;font-weight:700!important;color:var(--text-1)!important;display:inline-flex!important;align-items:center;flex:none}
.y-out.muted{border-color:transparent!important;color:var(--text-3)!important;pointer-events:none}
.y-sw{width:52px;height:32px;border-radius:16px!important;background:var(--text-1)!important;position:relative;flex:none;transition:background-color .2s}
.y-sw{transition:background-color .2s,box-shadow .2s!important}
.y-sw::after{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:13px;background:var(--bg);transition:left 240ms ${SPRING},width 160ms ${EASE},background-color .2s}
.y-sw:active::after{width:33px}
.y-sw.off:active::after{left:16px}
.y-sw.off{background:var(--surface-3)!important;box-shadow:inset 0 0 0 1px var(--line-strong)}
.y-sw.off::after{left:23px;background:var(--text-3)}
.y-grid{display:grid;grid-template-columns:repeat(${innerWidth >= 1700 ? 3 : D ? 2 : 1},minmax(0,1fr));gap:${sz(16, 12)}px}
.y-card{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:${sz('18px 20px', '16px 16px')};display:grid;gap:${sz(14, 12)}px;position:relative}
.y-card.drag{z-index:5;box-shadow:0 18px 50px rgba(0,0,0,.55),inset 0 0 0 1px var(--line-strong);background:var(--surface-2)}
.y-card .y-r1{display:flex;align-items:center;gap:${sz(14, 12)}px;cursor:pointer}
.y-card .y-r2{display:flex;align-items:center;gap:2px;margin:0 -8px -6px;padding-top:${sz(10, 8)}px;border-top:1px solid var(--line)}
.y-sp{flex:1}
.y-grip{width:28px;align-self:stretch;color:var(--text-3)!important;display:grid!important;place-items:center;flex:none;touch-action:none;cursor:grab;margin-inline-start:-6px}
.y-add{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:${sz(20, 16)}px;display:grid;gap:12px;margin-bottom:${sz(16, 14)}px}
${D ? '.y-add{grid-template-columns:1fr auto;align-items:center}.y-add .y-pri.big{padding:0 28px!important}' : ''}
.y-in{height:56px;border-radius:16px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line-strong);display:flex;align-items:center;gap:12px;padding:0 18px;color:var(--text-3);transition:box-shadow .15s}
.y-in:focus-within{box-shadow:inset 0 0 0 1.5px var(--text-2)}
.y-in input{all:unset;flex:1;min-width:0;font-size:16.5px;color:var(--text-1);height:100%}
.y-in input::placeholder{color:var(--text-3)}
.y-in input.ltr{direction:ltr;text-align:left}
.y-sum{font-size:${sz(15.5, 15)}px;color:var(--text-3);margin:0 4px ${sz(22, 18)}px}
.y-prov-main{display:flex!important;align-items:center;gap:14px;min-width:0;flex:1;text-align:start!important}.y-prov-main .y-nm{display:block;text-align:right}.y-prov .y-mt{flex-wrap:wrap;white-space:normal;gap:3px 8px}.y-prov .y-up{font-size:.9em}.y-hub{display:grid;grid-template-columns:repeat(${D ? 2 : 1},minmax(0,1fr));gap:${sz(14, 12)}px}
.y-prov{display:flex;align-items:center;gap:${sz(18, 14)}px;padding:${sz('20px 14px 20px 22px', '16px 8px 16px 16px')};border-radius:${sz(24, 22)}px;background:var(--surface-1);cursor:pointer;transition:background-color .15s}
@media (hover:hover){.y-prov:hover,.y-row[data-y="open"]:hover{background:var(--surface-2)}}
.y .y-prov .y-lg{width:${sz(60, 56)}px;height:${sz(60, 56)}px;border-radius:${sz(17, 16)}px}
.y-prov .y-nm{font-size:${sz(21, 19.5)}px}
.y-sheet{position:fixed;inset:0;z-index:2000;display:flex;align-items:${D ? 'center' : 'flex-end'};justify-content:center;background:rgba(0,0,0,.62);color:var(--text-1);font-family:inherit}
.y-pan{width:${D ? '520px' : '100%'};max-height:88vh;overflow:auto;background:var(--surface-1);border-radius:${D ? '28px' : '28px 28px 0 0'};padding:${sz('26px', '12px 18px calc(28px + env(safe-area-inset-bottom))')};display:grid;gap:16px;box-sizing:border-box}
.y-grab{width:40px;height:4px;border-radius:2px;background:var(--line-strong);margin:2px auto 6px}
.y-prev{display:flex;align-items:center;gap:16px}
.y-prev .y-nm{font-size:23px}
.y-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.y-ttl{display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700}
.y-ttl span{color:var(--text-3);font-size:15px;font-weight:500}
.y-ls>button{display:flex!important;align-items:center;gap:14px;min-height:60px;width:100%;font-size:17px!important;font-weight:600!important;color:var(--text-1)!important}
.y-ls>button+button{border-top:1px solid var(--line)!important}
.y-ls span{flex:1}
.y-ls i{font-style:normal;color:var(--text-3);font-weight:500;font-size:15.5px}
.y-ck{width:26px;height:26px;border-radius:8px;box-shadow:inset 0 0 0 2px var(--line-strong);display:grid;place-items:center;flex:none;transition:background-color .15s}
.y-ck.on{background:var(--text-1);box-shadow:none;color:var(--bg)}
.y-menu>button{display:flex!important;align-items:center;gap:16px;min-height:60px;width:100%;font-size:17px!important;font-weight:600!important;color:var(--text-1)!important}
.y-menu>button+button{border-top:1px solid var(--line)!important}
.y-menu>button.red{color:var(--danger)!important}
.y-det{display:grid;justify-items:center;text-align:center;gap:6px;margin-bottom:${sz(24, 20)}px}
.y-det .y-nm{font-size:${sz(30, 26)}px;margin-top:10px}
.y-acts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:${sz(16, 14)}px}
.y-act{height:${sz(84, 80)}px;border-radius:20px;background:var(--surface-1)!important;display:grid!important;place-items:center;align-content:center;gap:6px;font-size:14.5px!important;font-weight:600!important;color:var(--text-2)!important;text-align:center!important}
.y-act svg{color:var(--text-1)}
.y-act.on svg{color:var(--accent)}
.y-act[disabled]{opacity:.4;pointer-events:none}
.y-kv{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:4px ${sz(20, 16)}px;margin-bottom:${sz(16, 14)}px}
.y-kv>div{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:60px;font-size:16px}
.y-kv>div+div{border-top:1px solid var(--line)}
.y-kv span{color:var(--text-3)}
.y-kv b{font-weight:600;text-align:end}
.y-del{height:56px;width:100%;border-radius:18px;background:var(--surface-1)!important;color:var(--danger)!important;font-size:16.5px!important;font-weight:700!important;display:flex!important;align-items:center;justify-content:center;gap:10px}
.y-wide{max-width:${D ? '760px' : 'none'};margin-inline:auto}
.y-empty{display:grid;justify-items:center;text-align:center;gap:10px;padding:${sz('70px 0', '56px 0')}}
.y-empty .y-nm{font-size:22px;margin-top:8px}
.y-empty .y-pri{margin-top:14px}
.y-sec-t{font-size:15px;font-weight:700;color:var(--text-3);margin:${sz('26px 4px 12px', '22px 4px 10px')}}
.y-toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3000;background:var(--text-1);color:var(--bg);font-weight:700;font-size:15.5px;padding:14px 22px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.5);white-space:nowrap;pointer-events:none}
.y-bar-tools{display:flex;align-items:center;gap:4px;margin-inline-start:auto}
.y-bar-tools .y-ib{width:48px;height:48px}
.y-bar-q{flex:1;display:flex;align-items:center;gap:10px;height:46px;border-radius:23px;background:var(--surface-1);padding:0 16px;margin-inline:8px;color:var(--text-3)}
.y-bar-q input{all:unset;flex:1;min-width:0;font-size:17px;color:var(--text-1)}
.y-bar-q input::placeholder{color:var(--text-3)}
.y-sw-row{display:flex;gap:12px;flex-wrap:wrap}
.y-swatch{width:48px;height:48px;border-radius:50%!important;box-shadow:inset 0 0 0 2px rgba(255,255,255,.08)}
.y-swatch.on{box-shadow:0 0 0 3px var(--surface-1),0 0 0 5px var(--text-1)}
@media (prefers-reduced-motion:reduce){.y *,.y-sheet *{transition:none!important;animation:none!important}}

/* VANTARA · Mobile refinement. Shell and desktop layout remain intact. */
@media (max-width:999px){
.v35 #utilityBody:has([data-y-root]){padding:0!important}
.v35 [data-y-root]{padding:0!important;margin:0!important;max-width:none!important;width:100%!important}
.y{--yg:clamp(14px,4.1vw,20px);padding:18px var(--yg) calc(36px + env(safe-area-inset-bottom,0px));max-width:540px;margin-inline:auto;line-height:1.5}
.y-bar{padding-inline:8px!important;min-height:calc(60px + env(safe-area-inset-top,0px))!important;gap:4px!important;position:sticky!important;top:0;z-index:40;isolation:isolate}
.y-bar h1{font-size:18px!important;flex:1;min-width:0;text-align:start!important;line-height:1.4}
.y-bar .page-top-right{flex:none}.y-bar-tools{gap:0!important;flex:none;margin-inline-start:auto!important}
.y-bar button,.y-bar-tools .y-ib{width:44px!important;height:44px!important;border-radius:12px!important}
.y-bar .y-bar-q{min-width:0;margin:0 2px!important;height:46px;border-radius:23px;gap:8px;padding-inline:12px;background:var(--surface-1);box-shadow:inset 0 0 0 1px var(--line-strong)}
.y-bar .y-bar-q:focus-within{box-shadow:inset 0 0 0 1px var(--text-3)}
.y-bar-q:before,.y-bar-q:after{content:none!important;display:none!important}
.y-bar-q input{font-size:16px!important;min-width:0!important;width:100%!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;outline:none!important}
.y-overview{margin:0 0 26px}.y-overview h2{font-size:26px;letter-spacing:-.35px;line-height:1.35;font-weight:760;margin:0 0 5px;color:var(--text-1)}
.y-overview p{font-size:13px;color:var(--text-3);margin:0;line-height:1.65}
.y-overview-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line-strong);border-radius:16px;margin-top:18px;padding:14px 0;background:var(--surface-1)}
.y-overview-stats>div{display:grid;gap:2px;justify-items:center;min-width:0;padding-inline:3px}.y-overview-stats>div+div{border-inline-start:1px solid var(--line-strong)}
.y-overview-stats b{font-size:25px;line-height:1.12;font-weight:700;font-variant-numeric:tabular-nums;direction:ltr}.y-overview-stats span{font-size:11.5px;color:var(--text-2);text-align:center;white-space:normal}
.y-hub-group{margin-bottom:24px}.y-group-head{display:flex;align-items:center;justify-content:space-between;margin:0 2px 10px;color:var(--text-3)}.y-group-head h3{font-size:13px;font-weight:650;margin:0;color:var(--text-2)}.y-group-head span{font-size:12px;font-variant-numeric:tabular-nums}
.y-hub{gap:8px}.y-prov{gap:6px;padding:12px 10px 12px 12px;border:1px solid var(--line);border-radius:16px;min-height:80px;background:var(--surface-1)}
.y-prov-main{gap:12px!important;min-height:52px}.y .y-prov .y-lg{width:48px;height:48px;border-radius:13px}.y-prov .y-nm{font-size:17px;line-height:1.35;white-space:normal;overflow-wrap:anywhere;overflow:visible}.y-prov .y-mt{font-size:12px;line-height:1.55;gap:2px 8px;margin-top:3px}.y-prov .y-up{font-size:12px;color:var(--text-2);font-weight:600}.y-prov .y-up:before{content:'•';margin-inline-end:5px;color:var(--text-3)}
.y .y-ib{width:44px;height:44px;border-radius:12px}.y .y-ib svg{width:21px!important;height:21px!important}.y .y-prov>span.y-ib,.y .y-row>span.y-ib{width:22px;height:44px;color:var(--text-3)!important}.y .y-prov>span.y-ib svg,.y .y-row>span.y-ib svg{width:19px!important;height:19px!important}
.y-head{gap:13px;margin-bottom:22px;padding:0 1px}.y .y-lg.xl{width:58px;height:58px;border-radius:15px}.y-head .y-nm{font-size:24px;line-height:1.2;white-space:normal;overflow-wrap:anywhere}.y-head .y-mt{font-size:13px;display:block;white-space:normal;line-height:1.5;margin-top:5px;overflow-wrap:anywhere}
.y-add{border:1px solid var(--line);border-radius:16px;padding:12px!important;gap:10px;margin-bottom:16px;min-width:0}.y-add:before{content:'إضافة باستخدام رابط';font-size:13px;font-weight:650;color:var(--text-2);padding:0 2px}
.y .y-in,.y-sheet .y-in{height:50px;border-radius:12px;gap:10px;padding:0 12px!important;margin:0!important;min-width:0;max-width:100%;width:100%;box-shadow:inset 0 0 0 1px var(--line-strong);border:0!important;background:var(--bg)!important;box-sizing:border-box}
.y-in:before,.y-in:after{content:none!important}.y .y-in input,.y-sheet .y-in input{min-width:0!important;width:100%!important;font-size:16px!important;padding:0!important;margin:0!important;box-shadow:none!important;border:0!important;background:transparent!important}
.y .y-pri,.y-sheet .y-pri{min-height:44px;height:44px;border-radius:12px;font-size:14px!important;color:var(--on-accent,#fff)!important;white-space:nowrap}.y .y-pri.big,.y-sheet .y-pri.big{height:48px;font-size:14px!important;border-radius:12px}.y .y-pri[disabled]{background:var(--surface-3)!important;color:var(--text-3)!important;opacity:1!important}
.y-chips{gap:6px;margin-bottom:14px;overflow-x:auto;justify-content:stretch}.y .y-chip{height:44px;min-width:0;flex:1;justify-content:center;padding:0 9px!important;font-size:13px!important;border-radius:12px;border:1px solid var(--line)!important}.y .y-chip.on{background:var(--text-1)!important;color:var(--bg)!important}
.y-grid{gap:9px}.y-card{padding:12px!important;border-radius:16px;border:1px solid var(--line);gap:9px;min-width:0}.y-card .y-r1{gap:9px;min-width:0}.y-card .y-r1 .y-lg{width:44px;height:44px;border-radius:11px}.y .y-grip{width:30px;min-height:44px;margin-inline-start:-5px}.y-grip svg{width:20px!important}.y-card .y-r2{gap:0;margin:0 -3px -5px;padding-top:4px}.y-card .y-r2>.y-ib{width:44px}.y-card .y-r2>.y-ib:last-child{color:var(--text-3)!important}.y-card .y-mt{white-space:normal;display:flex;flex-wrap:wrap;gap:4px;line-height:1.4}.y-card .y-nm{font-size:16px;overflow-wrap:anywhere;white-space:normal}
.y .y-sw,.y-sheet .y-sw{width:46px;height:28px;box-sizing:border-box;min-width:46px}.y-sw:after{width:22px;height:22px;left:3px}.y-sw.off:after{left:21px}.y-sw:active:after{width:22px}.y-sw.off:active:after{left:21px}
.y .y-sw:before,.y-sheet .y-sw:before{content:'';position:absolute;inset:-8px -2px}
.y-tabs{gap:0;margin-bottom:16px;justify-content:space-between}.y .y-tab{height:48px;min-width:0;gap:5px;justify-content:center;flex:1;font-size:13px!important;white-space:nowrap}.y-tab i{font-size:12px;font-variant-numeric:tabular-nums}.y-ind{height:2px}
.y-tools{gap:8px;margin-bottom:10px}.y .y-lang{height:44px;font-size:13px!important;border-radius:12px;padding:0 12px!important;max-width:100%;gap:7px}.y-lang svg{width:18px!important;height:18px!important}
.y-list{padding:0 12px!important;border:1px solid var(--line);border-radius:16px;gap:0}.y-row{gap:9px;min-height:69px;padding:10px 0!important;min-width:0}.y-row .y-lg{width:42px;height:42px;border-radius:11px}.y-row .y-nm{font-size:15.5px;white-space:normal;overflow-wrap:anywhere;line-height:1.35}.y-row .y-mt{font-size:12px;gap:5px;white-space:normal;flex-wrap:wrap;line-height:1.4}.y .y-out{min-height:44px;border-radius:10px;padding:0 13px!important;font-size:13px!important}.y-dot{width:5px;height:5px}
.y-det{gap:5px;margin:8px 0 24px}.y .y-det .y-lg.xxl{width:82px;height:82px;border-radius:22px}.y-det .y-nm{font-size:25px;white-space:normal;overflow-wrap:anywhere;max-width:100%}.y-det .y-mt{font-size:13px;white-space:normal}
.y-acts{gap:6px;margin-bottom:16px}.y .y-act{height:76px;border:1px solid var(--line)!important;border-radius:14px;font-size:12px!important;gap:5px}.y-act svg{width:23px!important;height:23px!important}
.y-kv{border:1px solid var(--line);border-radius:16px;padding:0 14px;margin-bottom:12px}.y-kv>div{min-height:54px;font-size:14px;gap:12px;flex-wrap:wrap}.y-kv b{overflow-wrap:anywhere;min-width:0}.y .y-del{height:48px;border-radius:12px;font-size:14px!important;border:1px solid var(--line)!important}.y-empty{padding:40px 6px;gap:6px}.y-empty .y-nm{font-size:20px;white-space:normal}.y-empty .y-mt{white-space:normal;font-size:13px;text-align:center;display:block}
.y-sheet{padding:0;overscroll-behavior:contain}.y-pan{max-height:calc(100dvh - max(24px,env(safe-area-inset-top)));max-width:540px;border-radius:24px 24px 0 0;padding:10px 18px calc(20px + env(safe-area-inset-bottom,0px));gap:14px;border:1px solid var(--line-strong);border-bottom:0;overscroll-behavior:contain}.y-grab{width:36px;height:4px;background:var(--text-4);margin-bottom:4px}.y-ttl{font-size:19px;gap:10px;line-height:1.4;flex-wrap:wrap}.y-ttl span{font-size:13px}.y-prev{gap:12px;min-width:0}.y-prev .y-nm{font-size:19px;white-space:normal;overflow-wrap:anywhere}.y-prev .y-mt{font-size:13px;white-space:normal;overflow-wrap:anywhere;display:block}.y-sheet .y-sec{min-height:48px;height:48px;border-radius:12px;font-size:14px!important}.y-menu>button,.y-ls>button{min-height:52px;font-size:15px!important;gap:12px}.y-toast{max-width:calc(100% - 32px);width:max-content;white-space:normal;text-align:center;font-size:13px;padding:12px 16px;border-radius:12px;overflow-wrap:anywhere}
.y button:focus-visible,.y-bar button:focus-visible,.y-sheet button:focus-visible{outline:2px solid var(--accent-text)!important;outline-offset:2px}
@media(max-width:359px){.y{--yg:12px}.y-prov{gap:3px;padding:10px 7px}.y-prov-main{gap:8px!important}.y .y-prov .y-lg{width:42px;height:42px}.y-prov .y-nm{font-size:16px}.y .y-prov>span.y-ib,.y .y-row>span.y-ib{width:18px}.y-card .y-r1{gap:6px}.y-card .y-r2>.y-ib{width:42px}.y .y-tab{font-size:12px!important;gap:3px}.y-overview-stats span{font-size:10.5px}.y-overview h2{font-size:24px}}
}


/* V1.1: localized controls; maintain existing layout and theme. */
.y .y-mk,.y-sheet .y-mk{color:var(--accent-text)}
.y .y-add:before{content:none!important;display:none!important}.y-add-label{font-size:13px;font-weight:650;color:var(--text-2);display:block;padding:0 2px}.y .y-add{background:transparent;border:0;padding:0!important;gap:9px}.y .y-add .y-in{background:var(--surface-1)!important;box-shadow:inset 0 0 0 1px var(--line-strong)}
.y .y-card.drag{cursor:grabbing;box-shadow:0 12px 28px #0007,inset 0 0 0 1px var(--line-strong);will-change:transform;transition:none!important}.y-grid{overflow-anchor:none}.y-grip{touch-action:none!important}.y-grip:active{cursor:grabbing}
.y .y-ext-row{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:12px 0!important}.y-ext-main,.y-ext-actions{display:flex;align-items:center;gap:8px;min-width:0}.y .y-ext-info{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:start;min-height:48px}.y-ext-info .y-tx{min-width:0;display:block}.y-ext-info .y-nm{display:block}.y-ext-info .y-mt{display:flex;flex-wrap:wrap;gap:3px 7px}.y-repo-name{color:var(--text-3);font-size:11.5px;unicode-bidi:isolate}.y-repo-name:before{content:'· ';color:var(--text-3)}.y-ext-actions{border-top:1px solid var(--line);padding-top:4px}.y-switch-label{font-size:12px;color:var(--text-3);white-space:nowrap}.y .y-enter{display:inline-flex;align-items:center;justify-content:center;gap:4px;border-radius:10px;background:var(--surface-2);min-height:44px;padding:0 10px!important;font-size:12px;font-weight:650;white-space:nowrap}.y .y-enter:disabled{opacity:.4;cursor:default}.y-ext-row.is-off .y-ext-info .y-lg{opacity:.55}.y .y-detail-enter{width:100%;margin:0 0 12px}.y-source-note{font-size:14px;color:var(--text-2);line-height:1.7}
.y .y-repo-filter{min-width:0;flex:1;justify-content:center}.y-repo-filter span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.y-repo-logo{position:relative}.y-repo-logo img{position:absolute;inset:0}.y-repo-options>button{gap:12px;min-height:64px}.y-repo-options .y-lg{flex:none;width:42px;height:42px;border-radius:10px}.y-repo-options .y-ck{flex:none!important}.y-repo-option-name{min-width:0;overflow-wrap:anywhere}.y .y-sw:focus-visible{outline:2px solid var(--accent-text)!important;outline-offset:3px}
@media(min-width:1000px){.y .y-add{grid-template-columns:1fr auto}.y-add-label{grid-column:1/-1}.y-ext-row{max-width:100%}}
@media(max-width:359px){.y-ext-actions{gap:5px}.y .y-enter{padding:0 7px!important;font-size:11px}.y-switch-label{font-size:11px}.y .y-repo-filter{padding:0 7px!important}}

/* V1.2.2 — vertical-only sorting, independent installed/available and priority groups */
.y .y-order-list.y-grid,.y .y-order-list.y-list{grid-template-columns:minmax(0,1fr)}
.y .y-order-list.is-sorting>.drag{touch-action:none;z-index:8}
.y .y-order-list>.y-avail-row{gap:8px}.y .y-avail-row .y-grip{width:24px!important;flex:none}.y .y-avail-row .y-tx{min-width:0}.y .y-avail-row .y-mt{white-space:normal;line-height:1.4;overflow-wrap:anywhere}.y .y-avail-row.drag .y-lg{animation:y-jiggle .16s ease-in-out 3 alternate}.y .y-order-section:has([data-list="available"]) .y-order-head{color:var(--text-2)}
@media(max-width:359px){.y .y-avail-row{gap:6px}.y .y-avail-row .y-lg{width:36px;height:36px}.y .y-avail-row .y-grip{width:22px!important}}

.y-order-section{margin:0 0 22px;min-width:0}.y-order-head{display:flex;justify-content:space-between;align-items:center;margin:0 2px 9px;color:var(--text-2);font-size:12.5px;font-weight:650}.y-order-head span:last-child{font-variant-numeric:tabular-nums;color:var(--text-3);font-weight:500}.y-order-list{position:relative;overflow-anchor:none;isolation:isolate}.y-order-list[data-pin="1"]{--group-border:var(--accent-line)}.y-order-list[data-pin="1"].y-list{border-color:var(--group-border)}.y-order-list[data-pin="1"]>.y-card{border-color:var(--group-border)}.y-order-list>.y-row.drag{z-index:6;background:var(--surface-2);box-shadow:0 8px 24px #0006;outline:1px solid var(--line-strong);border-radius:12px;transition:none!important}.y-order-list .y-grip{width:28px!important;min-height:44px;touch-action:none!important;margin-inline-start:0!important}.y-ext-main .y-grip{align-self:stretch}.y-order-list.is-sorting>.drag{cursor:grabbing;z-index:8;outline:1px solid var(--accent-line);will-change:transform}.y-order-list:not([data-order="stremio"]).is-sorting>.drag>.y-ext-main{animation:y-jiggle .16s ease-in-out 3 alternate;transform-origin:center}.y-order-list.is-sorting{touch-action:none}.y-order-list.is-sorting>*{user-select:none}.y-order-list[data-pin="1"]{border-radius:16px}.y-order-list[data-pin="1"]>.y-card{background:color-mix(in srgb,var(--surface-1) 96%,var(--accent));border-color:var(--accent-line)}.y-order-list[data-pin="1"].y-list{background:color-mix(in srgb,var(--surface-1) 96%,var(--accent));border:1px solid var(--accent-line);padding-inline:10px}.y-order-list[data-pin="1"] .y-ib.on{color:var(--accent-text)!important}.y-order-section:has([data-pin="1"]) .y-order-head{color:var(--accent-text)}.y-order-section+.y-order-section{border-top:1px solid var(--line);padding-top:16px}.y .y-sw:not(.off),.y-sheet .y-sw:not(.off){background:var(--accent)!important}.y .y-sw:not(.off)::after,.y-sheet .y-sw:not(.off)::after{background:var(--on-accent)}.y :focus-visible,.y-sheet :focus-visible,.y-bar :focus-visible{outline:2px solid var(--accent)!important;outline-offset:3px}.y-bar .y-bar-q:focus-within{box-shadow:inset 0 0 0 1px var(--accent-line)}@keyframes y-jiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
.y-bar .y-bar-q{min-width:0;flex:1 1 0;overflow:hidden}.y-bar .y-bar-q input{flex:1 1 0;width:0!important;min-width:0!important}.y-bar:has(.y-bar-q) .page-top-right,.y-bar:has(.y-bar-q) .y-bar-tools{width:44px!important;flex:0 0 44px!important}
.y .y-repo-add-row{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:12px;width:100%;min-height:50px;border:1px solid var(--line-strong);border-radius:14px;background:var(--surface-1);color:var(--text-1);font-size:14px;font-weight:650}.y .y-repo-add-row svg{color:var(--accent-text)}.y .y-repo-add-row:active{background:var(--surface-2)}.y-repo-editor{display:grid;gap:22px;min-width:0}.y-editor-title{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.y-editor-title h2{font-size:23px;font-weight:750;margin:3px 0 4px;line-height:1.35}.y-editor-kicker{font-size:12px;font-weight:650;color:var(--accent-text);direction:ltr;text-align:right}.y-editor-title p,.y-photo-copy p,.y-editor-help{font-size:12px;line-height:1.65;color:var(--text-3);margin:0}.y-editor-title .y-ib{width:44px;height:44px;background:var(--surface-2);border-radius:12px}.y-photo-block{display:flex;align-items:center;gap:16px;padding:15px;background:var(--surface-2);border:1px solid var(--line);border-radius:16px;position:relative}.y-repo-photo{width:80px;height:80px;flex:none;display:grid;place-items:center;position:relative;border-radius:19px;background:var(--surface-3);color:var(--text-2);border:1px dashed var(--line-strong);cursor:pointer}.y-repo-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}.y-repo-photo.has-photo{border-style:solid}.y-photo-plus{position:absolute;bottom:-4px;inset-inline-end:-4px;width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent,#fff);border:2px solid var(--surface-2)}.y-photo-copy{min-width:0;flex:1}.y-photo-copy strong{font-size:14px;font-weight:700}.y-photo-label,.y-sheet .y-photo-remove{display:inline-flex;align-items:center;min-height:38px;font-size:13px;font-weight:650;color:var(--accent-text);cursor:pointer;margin-inline-end:12px}.y-sheet .y-photo-remove{color:var(--text-3)}.y-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}.y-editor-fields{display:grid;gap:8px}.y-editor-fields>label:not(.y-in){display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:650}.y-editor-fields>label small{font-size:11px;color:var(--text-3);font-weight:500}.y-editor-fields .y-in{height:52px!important;border-radius:13px!important;background:var(--bg)!important;border:1px solid var(--line-strong)!important;box-shadow:none!important}.y-editor-fields .y-in:focus-within{border-color:var(--accent)!important}.y-editor-fields .y-in+label{margin-top:8px}.y-editor-help{margin-top:0}.y-repo-error{color:var(--danger);font-size:12px;line-height:1.6;margin:0}.y-editor-footer{display:grid;gap:8px;padding-top:14px;border-top:1px solid var(--line)}.y-editor-footer .y-pri,.y-editor-footer .y-sec{width:100%;justify-content:center;display:flex;align-items:center;gap:8px;min-height:48px}.y-editor-footer .y-sec{background:transparent!important;min-height:44px}.y-repo-editor [hidden]{display:none!important}.y-sheet .y-repo-editor .y-photo-label{touch-action:manipulation}.y-pan:has(.y-repo-editor){overflow-y:auto;max-height:calc(100dvh - 18px);overscroll-behavior:contain}.y-repo-photo:focus-within{outline:2px solid var(--accent-text)}@media(max-width:359px){.y-photo-block{padding:12px;gap:12px}.y-repo-photo{width:68px;height:68px}.y-repo-editor{gap:16px}.y-order-list .y-grip{width:24px!important}.y-ext-main{gap:5px}.y-editor-title h2{font-size:21px}}

/* v1.2.3: discovery list, native keyboard geometry and stable navigation */
.y-bar .y-back-fixed{width:48px!important;height:48px!important;min-width:48px!important;min-height:48px!important;flex:0 0 48px!important;display:grid!important;place-items:center!important;margin:0!important;padding:0!important;transform:none!important;touch-action:manipulation}
.y-bar .y-back-fixed svg{width:24px!important;height:24px!important;flex:none;transform:none!important}
.y-bar .page-top-right{flex:0 0 48px!important;min-width:48px!important}.y-bar:has(.y-bar-q) .page-top-right{width:48px!important;flex:0 0 48px!important}
.y .y-available-list>.y-avail-row{gap:10px;min-height:65px;touch-action:pan-y}.y .y-available-list .y-tx{min-width:0}.y .y-available-list .y-nm{overflow-wrap:anywhere}.y .y-available-list .y-out{min-height:44px;min-width:60px}
.y-sheet{inset:auto 0 auto 0;top:var(--visible-top,0px);height:var(--visible-h,100dvh);max-height:var(--visible-h,100dvh)}
.y-sheet .y-pan{max-height:calc(var(--visible-h,100dvh) - 16px)}
.y-sheet.y-editor-sheet .y-pan{display:flex;flex-direction:column;gap:6px;overflow:hidden;padding:8px 0 0;max-height:calc(var(--visible-h,100dvh) - 12px);width:min(100%,540px);min-height:0}
.y-editor-sheet .y-repo-editor{display:flex;flex-direction:column;gap:0;min-height:0;overflow:hidden}
.y-editor-sheet .y-editor-title{flex:none;padding:8px 18px 12px;align-items:center;border-bottom:1px solid var(--line)}
.y-editor-sheet .y-editor-title h2{font-size:21px}.y-editor-sheet .y-editor-title .y-ib{flex:0 0 44px;background:transparent!important;border:1px solid var(--line)}
.y-editor-sheet .y-editor-body{min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px 18px;display:flex;flex-direction:column;gap:18px;scroll-padding:10px;touch-action:pan-y}
.y-editor-sheet .y-photo-block{background:transparent;border:0;padding:0;gap:12px;flex:none}.y-editor-sheet .y-repo-photo{width:68px;height:68px;border-radius:16px}.y-editor-sheet .y-photo-copy p{font-size:12px}.y-editor-sheet .y-photo-plus{bottom:-2px;inset-inline-end:-2px}
.y-editor-sheet .y-editor-fields{flex:none;gap:8px}.y-editor-sheet .y-editor-fields .y-in{height:48px!important;border-radius:12px!important;overflow:visible}.y-sheet .y-in input:focus,.y-sheet .y-in input:focus-visible,.y .y-in input:focus,.y .y-in input:focus-visible,.y-bar .y-bar-q input:focus,.y-bar .y-bar-q input:focus-visible{outline:none!important;box-shadow:none!important;border:0!important}
.y-sheet .y-in:focus-within,.y .y-in:focus-within,.y-bar .y-bar-q:focus-within{border-color:var(--accent)!important;box-shadow:0 0 0 1px var(--accent-line)!important}
.y-editor-sheet .y-editor-footer{flex:none;padding:12px 18px max(14px,env(safe-area-inset-bottom));background:var(--surface-1);border-top:1px solid var(--line);margin:0}
.y-editor-sheet .y-editor-footer .y-pri{min-height:48px}.y-compact-sheet.y-editor-sheet .y-pan{max-height:var(--visible-h,100dvh);border-radius:16px 16px 0 0;padding-top:4px}.y-compact-sheet .y-grab,.y-compact-sheet .y-editor-title p,.y-compact-sheet .y-editor-kicker{display:none!important}.y-compact-sheet .y-editor-title{padding:4px 14px}.y-compact-sheet .y-editor-title h2{font-size:18px;margin:0}.y-compact-sheet .y-editor-body{padding:10px 14px;gap:14px}.y-compact-sheet .y-editor-footer{padding:8px 14px}.y-compact-sheet .y-editor-footer .y-pri{min-height:44px}
@media(max-width:359px){.y-editor-sheet .y-editor-body{padding-inline:14px}.y-editor-sheet .y-editor-title,.y-editor-sheet .y-editor-footer{padding-inline:14px}.y .y-available-list>.y-avail-row{gap:7px}.y .y-available-list .y-out{min-width:54px}}
/* v1.2.4 — لون الثيم في مواضعه فقط، سطر واحد، المعطّلة باهتة */
.y{padding-bottom:140px!important}
.y .y-mk,.y-sheet .y-mk{color:var(--text-1)}
.y-order-list[data-pin="1"].y-list{background:var(--surface-1)!important;border-color:var(--line)!important}
.y-order-list[data-pin="1"]>.y-card{background:var(--surface-1)!important;border-color:var(--line)!important}
.y-order-section:has([data-pin="1"]) .y-order-head{color:var(--text-2)!important}
.y-order-list[data-pin="1"] .y-ib.on{color:var(--accent)!important}
.y .y-sw:not(.off),.y-sheet .y-sw:not(.off){background:var(--text-1)!important}
.y .y-sw:not(.off)::after,.y-sheet .y-sw:not(.off)::after{background:var(--bg)!important}
.y .y-overview{margin-top:4px}
.y-stat-btn{cursor:pointer;border-radius:14px;transition:background-color .15s}
.y-stat-btn.has b{color:var(--accent)}
@media (hover:hover){.y-stat-btn.has:hover{background:var(--surface-2)}}
.y .y-ext-row{display:flex!important;align-items:center;gap:2px!important;min-height:72px;padding:8px 0!important}
.y .y-ext-row .y-ext-info{display:flex!important;align-items:center;gap:12px;flex:1;min-width:0;text-align:start!important;padding:0!important;background:none!important}
.y .y-ext-row .y-tx{display:grid;min-width:0}
.y .y-ext-row .y-nm{font-size:17px}
.y .y-ext-row .y-mt{font-size:13.5px;flex-wrap:nowrap}
.y .y-ext-row .y-ext-info,.y .y-ext-row .y-lg,.y .y-ext-row .y-nm,.y .y-card .y-r1>[data-y="open"]>*,.y .y-card .y-r2{transition:opacity 260ms ${EASE},filter 260ms ${EASE}}
.y .y-ext-row.is-off .y-ext-info{opacity:.36}
.y .y-ext-row.is-off .y-lg,.y .y-card.is-off .y-lg{filter:grayscale(1) blur(1.6px)}
.y .y-ext-row.is-off .y-nm{filter:blur(.4px)}
.y .y-ext-row .y-sw{margin-inline:8px 10px}
.y .y-card.is-off .y-r1>[data-y="open"]>*,.y .y-card.is-off .y-r2{opacity:.36}
.y .y-card.is-off .y-r1>[data-y="open"]>.y-lg{opacity:.5}
.y-ra{display:grid;gap:12px;padding:2px 0 4px}
.y-ra-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.y-ra-head h2{font-size:20px;font-weight:700;margin:0;color:var(--text-1)}
.y-ra-head .y-ib{width:40px!important;height:40px!important;margin-inline-end:-8px}
.y-ra .y-in{height:52px;border-radius:14px}
.y-ra .y-pri.big{height:50px!important;min-height:50px!important;border-radius:14px}
.y-ra .y-pri[disabled]{opacity:1!important;background:var(--surface-3)!important;color:var(--text-3)!important}
.y-ra .y-in{padding-inline:16px 8px}
.y-ra-url input{direction:ltr;text-align:left}
.y-ra-paste{height:36px;padding:0 14px!important;border-radius:11px;background:var(--surface-3)!important;font-size:14px!important;font-weight:700!important;color:var(--text-1)!important;flex:none}
.y-ra-msg{margin:-4px 6px -2px;font-size:13.5px;min-height:18px;line-height:18px;color:var(--text-3);display:flex;align-items:center;gap:10px}
.y-ra-msg[data-kind="err"]{color:var(--danger)}
.y-ra-msg button{color:var(--text-1)!important;font-weight:700!important;text-decoration:underline!important;text-underline-offset:3px}
.y-ra-prev{display:flex;align-items:center;gap:14px;padding:12px;border-radius:16px;background:var(--surface-2);height:88px;box-sizing:border-box}
.y-ra-prev.is-empty .y-ra-img{pointer-events:none}
.y-ra-prev.is-empty .y-ra-img b{color:var(--text-3);background:transparent;box-shadow:inset 0 0 0 1.5px var(--line-strong)}
.y-ra-prev.is-empty .y-photo-plus{display:none}
.y-ra-prev.is-empty .y-ra-count{color:var(--text-3)}
.y-ra-img{position:relative;width:64px;height:64px;flex:none;cursor:pointer}
.y-ra-sheet .y-pan{transition:none}
.y-ra-img img,.y-ra-img b{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;object-fit:cover;background:var(--surface-3);font-size:26px;font-weight:700;color:var(--text-1)}
.y-ra-img .y-photo-plus{background:var(--text-1)!important;color:var(--bg)!important}
.y-ra-meta{flex:1;min-width:0;display:grid;gap:6px}
.y-ra-nick{display:grid;gap:2px;cursor:text}
.y-ra-nick span{font-size:12px;color:var(--text-3);font-weight:600}
.y-ra-nick input{all:unset;font-size:19px;font-weight:700;color:var(--text-1);border-bottom:1px solid var(--line-strong);padding:2px 0 5px;min-width:0}
.y-ra-nick input:focus{border-color:var(--text-2)}
.y-ra-count{font-size:13.5px;color:var(--text-3)}
.y-up-h{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;color:var(--text-2);margin:4px 0 2px}
.y-up-h .y-lg{width:28px!important;height:28px!important;border-radius:9px!important}
.y-up-row{position:relative;display:flex;align-items:center;gap:12px;min-height:64px}
.y-up-row+.y-up-row{border-top:1px solid var(--line)}
.y-up-row .y-lg{width:44px!important;height:44px!important;border-radius:12px!important}
.y-up-row.done .y-up{color:var(--text-3)}
.y-sheet .y-grab{touch-action:none;cursor:grab;padding:8px 40px;margin:-6px auto 0;box-sizing:content-box;background-clip:content-box}

/* v1.2.5 — الكمبيوتر: عمود واحد مثل Nuvio */
${D?`
.v35 [data-y-root]{max-width:1240px!important;width:100%!important;margin-inline:auto!important}
.y{max-width:1240px;margin-inline:auto}
.y .y-hub,.y .y-list,.y .y-grid{grid-template-columns:minmax(0,1fr)!important}
.y .y-list,.y .y-order-list[data-pin="1"].y-list{padding:0!important;background:none!important;border:0!important;display:grid;gap:10px;column-gap:0}
.y .y-grid{gap:10px}
.y .y-drow,.y .y-list>.y-avail-row,.y .y-list>.y-row{background:var(--surface-1);border-radius:20px;padding:14px 16px 14px 20px!important;min-height:96px;border-top:0!important;gap:16px!important;transition:background-color .15s;box-sizing:border-box}
@media (hover:hover){.y .y-drow:hover,.y .y-list>.y-avail-row:hover,.y .y-list>.y-row:hover{background:var(--surface-2)}}
.y .y-drow .y-ext-info{gap:18px!important}
.y .y-lg.dl{width:72px!important;height:72px!important;border-radius:20px!important}
.y .y-drow{min-height:108px!important}
.y-dn{font-size:21px!important}
.y .y-list>.y-avail-row .y-lg,.y .y-list>.y-row>.y-lg{width:56px!important;height:56px!important;border-radius:16px!important}
.y-dn{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:var(--text-1);line-height:1.3;min-width:0}
.y-dn>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-chipv{font-size:12.5px;font-weight:600;color:var(--text-2);background:var(--surface-3);padding:3px 9px;border-radius:8px;direction:ltr;flex:none}
.y .y-drow .y-mt,.y .y-list>.y-avail-row .y-mt{font-size:14.5px!important;margin-top:5px}
.y .y-list>.y-avail-row .y-nm,.y .y-list>.y-row .y-nm{font-size:18px}
.y-dacts{display:flex;align-items:center;gap:4px;flex:none}
.y .y-dacts .y-ib{width:50px!important;height:50px!important;border-radius:14px}
.y .y-dacts .y-ib[disabled]{opacity:.25;pointer-events:none}
.y-dsep{width:1px;height:28px;background:var(--line-strong);margin-inline:8px;flex:none}
.y-dup{height:46px;padding:0 16px!important;border-radius:14px;font-size:15.5px!important;background:var(--surface-3)!important;color:var(--text-1)!important;font-weight:700!important;font-size:14.5px!important;display:inline-flex!important;align-items:center;gap:8px;flex:none;transition:background-color .15s}
@media (hover:hover){.y-dup:hover{background:var(--line-strong)!important}}
.y .y-drow.is-off .y-ext-info,.y .y-drow.is-off .y-ext-info .y-lg{opacity:.4}
.y .y-drow .y-sw{margin:0 6px}
.y .y-dprov{min-height:128px!important;padding:22px 24px!important;gap:22px!important;border-radius:24px!important;border:0!important}
.y .y-dprov .y-lg.dxl{width:96px!important;height:96px!important;border-radius:28px!important}
.y .y-dprov{min-height:148px!important}
.y .y-faces .y-lg{width:34px!important;height:34px!important;border-radius:10px!important}
.y .y-dprov .y-dn{font-size:25px}
.y .y-dprov .y-mt{font-size:15px!important;margin-top:4px}
.y-faces{display:flex;align-items:center;gap:6px;margin-top:12px}
.y .y-faces .y-lg{width:30px!important;height:30px!important;border-radius:9px!important;box-shadow:none}
.y-faces i{font-style:normal;font-size:13px;font-weight:600;color:var(--text-3);margin-inline-start:4px}
.y .y-overview{display:block!important;margin:0 0 8px}
.y .y-overview-stats{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line-strong);border-radius:22px;padding:22px 0;background:var(--surface-1)}
.y .y-overview-stats>div{display:grid;gap:4px;justify-items:center;align-content:center;margin:0 10px;padding:6px 0}
.y .y-overview-stats>div+div{border-inline-start:1px solid var(--line-strong)}
.y .y-overview-stats b{font-size:36px;line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums;direction:ltr;color:var(--text-1)}
.y .y-overview-stats .y-stat-btn.has b{color:var(--accent)}
.y .y-overview-stats span{font-size:14px;color:var(--text-2)}
.y .y-hub-group{margin-top:26px}
.y .y-hub-group .y-group-head{display:flex;align-items:center;justify-content:space-between;margin:0 4px 12px}
.y .y-hub-group .y-group-head h3{font-size:15px;font-weight:700;margin:0;color:var(--text-2)}
.y .y-hub-group .y-group-head span{font-size:13px;color:var(--text-3)}
.y .y-hub{display:grid;gap:12px}
.y .y-ib.danger{color:var(--text-2)!important}
@media (hover:hover){.y .y-ib.danger:hover{color:var(--danger)!important}}
.y .y-head .y-lg.xl{width:96px!important;height:96px!important;border-radius:28px!important}
.y .y-tab{font-size:18px!important;height:58px!important}
.y .y-lang{height:50px!important;font-size:17px!important}
.y-bar .y-ib{width:52px!important;height:52px!important}
.y-bar .y-ib svg{width:28px!important;height:28px!important}
.y .y-drow .y-sw{transform:scale(1.12)}
.y .y-head .y-nm{font-size:30px}
.y [data-tip]{position:relative}
.y [data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--text-1);color:var(--bg);font-size:12.5px;font-weight:700;padding:6px 10px;border-radius:8px;white-space:nowrap;pointer-events:none;z-index:30;animation:y-tip .14s ease-out}
@keyframes y-tip{from{opacity:0;transform:translate(-50%,4px)}}
.y .y-wide{max-width:900px}
`:''}

`;

// ── المكوّنات ──
const ib = (act, icon, { cls = '', id = '', label = '', s } = {}) => `<button class="y-ib ${cls}" data-y="${act}" ${id ? `data-id="${esc(id)}"` : ''} aria-label="${esc(label)}">${g(icon, s)}</button>`;
const pinBtn = (p, it) => ib('pin', it.pin ? 'pinOn' : 'pin', { cls: it.pin ? 'on' : 'dim', id: `${p}|${it.id}`, label: it.pin ? 'إلغاء التثبيت' : 'ثبّت' });
const header = (k, line) => `<div class="y-head">${logo(k, PROV[k].name, 'xl')}<div class="y-tx"><div class="y-nm">${PROV[k].name}</div><div class="y-mt">${line}</div></div></div>`;
const tabs = (p, arr) => `<div class="y-tabs" role="tablist">${arr.map(([k, t, n]) => `<button class="y-tab ${S.tab[p] === k ? 'on' : ''}" data-y="tab" data-id="${p}|${k}" role="tab" aria-selected="${S.tab[p] === k}">${t}${n != null ? ` <i>${n}</i>` : ''}</button>`).join('')}<span class="y-ind"></span></div>`;
const indPos = () => { const t = content?.querySelector('.y-tabs'); const o = t?.querySelector('.y-tab.on'); if (!o) return null; const a = t.getBoundingClientRect(), b = o.getBoundingClientRect(); return { l: b.left - a.left, w: b.width }; };
function placeInd(from) {
  const i = content.querySelector('.y-ind'); const to = indPos(); if (!i || !to) return;
  i.style.left = to.l + 'px'; i.style.width = to.w + 'px';
  if (from && !RM && (from.l !== to.l || from.w !== to.w)) i.animate([{ left: from.l + 'px', width: from.w + 'px' }, { left: to.l + 'px', width: to.w + 'px' }], { duration: M.ind, easing: EASE });
}
const prog = (id) => S.busy[id] ? `<span class="y-prog"><i style="width:${S.busy[id].p}%"></i></span>` : '';
const match = (n) => !S.q || n.toLowerCase().includes(S.q.toLowerCase());
const upCount = (p) => S.items[p].filter((x) => x.nv).length;
const langPill = (p) => {
  const sel = [...S.langs[p]]; const n = S.avail[p].filter((x) => !S.items[p].some(i=>i.id===x.id)&&repoMatches(p,x)&&S.langs[p].has(x.lang)).length;
  return `<button class="y-lang" data-y="langs" data-id="${p}">${g('globe', 21)}<span>${sel.length === 1 ? sel[0] : `${sel.length} لغات`}</span> <i>${n}</i>${g('down', 20)}</button>`;
};

const provLine = (k) => {
  const n = S.items[k].length; const up = upCount(k);
  if (!n) return 'لا شيء مثبت';
  const base = k === 'stremio' ? `${n} إضافات` : `${n} مثبتة`;
  return up ? `<span>${base}</span><span class="y-up">${up} ${up === 1 ? 'تحديث' : 'تحديثات'}</span>` : base;
};
const provCard = (k) => { if (D) return deskProv(k);
  const pin = S.provPins.includes(k);
  return `<div class="y-prov" data-y="prov" data-id="${k}" data-k="p-${k}"><button class="y-prov-main" data-y="prov" data-id="${k}" aria-label="فتح ${PROV[k].name}">${logo(k, PROV[k].name)}<span class="y-tx"><span class="y-nm" dir="ltr">${PROV[k].name}</span><span class="y-mt">${provLine(k)}</span></span></button>${ib('ppin', pin ? 'pinOn' : 'pin', { cls: pin ? 'on' : 'dim', id: k, label: pin ? 'إلغاء التثبيت' : 'ثبّت' })}<span class="y-ib" aria-hidden="true">${g('open')}</span></div>`;
};

const extLine = (p, it) => {
  const b = S.busy[it.id];
  if (b) return `<span class="y-up">${b.kind === 'install' ? 'يثبّت' : b.kind === 'retry' ? 'يتصل' : 'يحدّث'}… ${Math.round(b.p)}%</span>`;
  if (it.bad) return '<span class="y-bad">تعذّر الاتصال</span>';
  if (it.nv) return '<span class="y-dot"></span><span class="y-up">تحديث</span>';
  return p === 'cloudstream' ? `عربي · v${it.ver}` : (it.lang || 'عربي');
};
const switchBtn = (p,it) => `<button class="y-sw ${it.on ? '' : 'off'}" data-y="toggle" data-id="${esc(p+'|'+it.id)}" role="switch" aria-checked="${!!it.on}" aria-label="تفعيل ${esc(it.name)}"></button>`;
const instRow = (p,it) => D ? deskExtRow(p,it) : `<div class="y-row y-ext-row ${it.on?'':'is-off'}" data-k="${p}-${esc(it.id)}" data-id="${esc(it.id)}"><button class="y-ext-info" data-y="open" data-id="${esc(p+'|'+it.id)}" aria-label="تفاصيل ${esc(it.name)}">${logo(it.logo,it.name)}<span class="y-tx"><span class="y-nm">${esc(it.name)}</span><span class="y-mt">${extLine(p,it)}${S.repos[p].length>1?` · <span class="y-repo-name" dir="auto">${esc(repoName(p,it))}</span>`:''}</span></span></button>${!it.on?switchBtn(p,it):it.bad&&!S.busy[it.id]?ib('retry','retry',{id:p+'|'+it.id,label:'أعد المحاولة'}):S.busy[it.id]?'':pinBtn(p,it)+ib('enterSource','open',{id:p+'|'+it.id,label:'افتح '+it.name})}${prog(it.id)}</div>`;
const availRow = (p, it) => {
  const have = S.items[p].some((x) => x.id === it.id); const b = S.busy[it.id];
  return `<div class="y-row y-avail-row" data-k="${p}-a-${esc(it.id)}" data-id="${esc(it.id)}">${logo(it.logo, it.name)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${b ? `<span class="y-up">يثبّت… ${Math.round(b.p)}%</span>` : `${esc(it.lang)}${it.ver ? ` · v${esc(it.ver)}` : ''} · <span dir="auto">${esc(repoName(p,it))}</span>`}</div></div>${
    have ? '<span class="y-out muted">مثبتة</span>' : b ? ib('cancel', 'close', { id: `${p}|${it.id}`, label: 'إلغاء' }) : `<button class="y-out" data-y="install" data-id="${p}|${it.id}">تثبيت</button>`}${prog(it.id)}</div>`;
};

// ── مكوّنات الكمبيوتر (عمود واحد، إجراءات ظاهرة) ──
const dib=(act,icon,id,tip,cls='',dis=false)=>`<button class="y-ib ${cls}" data-y="${act}" data-id="${esc(id)}" aria-label="${esc(tip)}" data-tip="${esc(tip)}" ${dis?'disabled':''}>${g(icon,26)}</button>`;
const grpPos=(p,it)=>{const grp=S.items[p].filter(x=>!!x.pin===!!it.pin);const i=grp.indexOf(it);return [i===0,i===grp.length-1];};
const moveBtns=(p,it)=>{const [f,l]=grpPos(p,it),k=p+'|'+it.id;return dib('moveUp','up',k,'للأعلى','',f)+dib('moveDown','downMove',k,'للأسفل','',l);};
const deskExtRow=(p,it)=>{const k=p+'|'+it.id,b=S.busy[it.id];return `<div class="y-row y-ext-row y-drow ${it.on?'':'is-off'}" data-k="${p}-${esc(it.id)}" data-id="${esc(it.id)}"><button class="y-ext-info" data-y="open" data-id="${esc(k)}" aria-label="تفاصيل ${esc(it.name)}">${logo(it.logo,it.name,'dl')}<span class="y-tx"><span class="y-dn"><span>${esc(it.name)}</span>${it.ver?`<span class="y-chipv">v${esc(it.ver)}</span>`:''}</span><span class="y-mt">${b||it.bad||it.nv?extLine(p,it):esc(it.lang||'عربي')} · <span dir="auto">${esc(repoName(p,it))}</span></span></span></button><div class="y-dacts">${moveBtns(p,it)}<span class="y-dsep"></span>${pinBtnD(p,it)}${it.nv&&!b?`<button class="y-dup" data-y="update" data-id="${esc(k)}">${g('update',18)}تحديث v${esc(it.nv)}</button>`:''}${it.bad&&!b?dib('retry','retry',k,'أعد المحاولة'):''}${dib('copy','link',k,'انسخ الرابط')}${dib('askDel','trash',k,'احذف','danger')}<span class="y-dsep"></span>${switchBtn(p,it)}${dib('enterSource','open',k,'افتح المصدر','',!it.on||!!it.bad)}</div>${prog(it.id)}</div>`;};
const pinBtnD=(p,it)=>dib('pin',it.pin?'pinOn':'pin',p+'|'+it.id,it.pin?'أزل من المفضّلة':'للمفضّلة',it.pin?'on':'dim');
const deskStCard=it=>{const k='stremio|'+it.id,b=S.busy[it.id];return `<div class="y-row y-drow y-card-d ${it.on?'':'is-off'}" data-k="st-${it.id}" data-id="${it.id}"><button class="y-ext-info" data-y="open" data-id="${esc(k)}" aria-label="تفاصيل ${esc(it.name)}">${logo(it.logo,it.name,'dl')}<span class="y-tx"><span class="y-dn"><span>${esc(it.name)}</span><span class="y-chipv">v${esc(it.ver)}</span></span><span class="y-mt">${b?`<span class="y-up">يحدّث… ${Math.round(b.p)}%</span>`:`${TYPE[it.type]||''}${it.cont?' · '+it.cont:''}`}</span></span></button><div class="y-dacts">${moveBtns('stremio',it)}<span class="y-dsep"></span>${pinBtnD('stremio',it)}${it.nv&&!b?`<button class="y-dup" data-y="update" data-id="${esc(k)}">${g('update',18)}تحديث ${esc(it.nv)}</button>`:''}${it.conf?dib('conf','sliders',it.id,'اضبط'):''}${dib('copy','link',k,'انسخ الرابط','',!it.url)}${dib('askDel','trash',k,'احذف','danger')}<span class="y-dsep"></span><button class="y-sw ${it.on?'':'off'}" data-y="toggle" data-id="${esc(k)}" role="switch" aria-checked="${!!it.on}" aria-label="تفعيل ${esc(it.name)}" data-tip="${it.on?'عطّلها':'فعّلها'}"></button></div>${prog(it.id)}</div>`;};
const deskProv=k=>{const pin=S.provPins.includes(k),a=S.items[k],up=upCount(k);return `<div class="y-prov y-dprov" data-y="prov" data-id="${k}" data-k="p-${k}">${logo(k,PROV[k].name,'dxl')}<div class="y-tx"><div class="y-dn"><span dir="ltr">${PROV[k].name}</span></div><div class="y-mt">${provLine(k)}</div>${a.length?`<div class="y-faces">${a.slice(0,8).map(it=>logo(it.logo,it.name)).join('')}${a.length>8?`<i>+${a.length-8}</i>`:''}</div>`:''}</div><div class="y-dacts">${up?`<button class="y-dup" data-y="provUpd" data-id="${k}">${g('update',18)}حدّث ${up}</button>`:''}${k!=='stremio'?dib('provAddRepo','plus',k,'أضف مستودعًا'):''}${dib('ppin',pin?'pinOn':'pin',k,pin?'إلغاء التثبيت':'ثبّت في الأعلى',pin?'on':'dim')}${dib('prov','open',k,'افتح')}</div></div>`;};
const deskRepoRow=(p,r,i)=>`<div class="y-row" data-k="${p}-r-${esc(r.id)}">${repoLogo(r)}<div class="y-tx"><div class="y-nm">${esc(r.name)}</div><div class="y-mt" dir="ltr" style="justify-content:flex-end">${esc(r.url.replace(/^https?:\/\//,''))}</div></div><div class="y-dacts"><span class="y-chipv">${r.n!=null?r.n+' إضافة':'—'}</span><span class="y-dsep"></span>${dib('editRepo','sliders',p+'|'+i,'عدّل اللقب والصورة')}${dib('copyRaw','link',r.url,'انسخ الرابط')}${dib('repoDel','trash',p+'|'+i,'أزل المستودع','danger')}</div></div>`;
const stepGroup=(p,it,dir)=>{const a=S.items[p];const grp=a.filter(x=>!!x.pin===!!it.pin);const i=grp.indexOf(it),j=i+dir;if(i<0||j<0||j>=grp.length)return false;[grp[i],grp[j]]=[grp[j],grp[i]];let n=0;S.items[p]=pinFirst(a.map(x=>!!x.pin===!!it.pin?grp[n++]:x));return true;};
const repoRow = (p, r, i) => D ? deskRepoRow(p, r, i) : `<div class="y-row" data-k="${p}-r-${esc(r.id)}">${repoLogo(r)}<div class="y-tx"><div class="y-nm">${esc(r.name)}</div><div class="y-mt">${r.n != null ? `${r.n.toLocaleString('en')} إضافة` : 'لم يُجلب بعد'}</div></div>${ib('repoMenu', 'more', { id: `${p}|${i}`, label: 'خيارات' })}</div>`;
const stCard = (it) => D ? deskStCard(it) : `<div class="y-card ${it.on?'':'is-off'}" data-k="st-${it.id}" data-id="${it.id}">
  <div class="y-r1"><button class="y-grip" data-y="grip" data-id="${it.id}" aria-label="اسحب للترتيب">${g('grip')}</button><div style="display:contents" data-y="open" data-id="stremio|${it.id}">${logo(it.logo, it.name)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${S.busy[it.id] ? `<span class="y-up">يحدّث… ${Math.round(S.busy[it.id].p)}%</span>` : it.nv ? `<span class="y-dot"></span><span class="y-up">تحديث ${it.nv}</span>` : `${TYPE[it.type]} · ${it.ver}`}</div></div></div><button class="y-sw ${it.on ? '' : 'off'}" data-y="toggle" data-id="stremio|${esc(it.id)}" role="switch" aria-checked="${!!it.on}" aria-label="تفعيل ${esc(it.name)}"></button></div>
  <div class="y-r2">${pinBtn('stremio', it)}${it.conf ? ib('conf', 'sliders', { id: it.id, label: 'ضبط' }) : ''}${it.nv && !S.busy[it.id] ? ib('update', 'update', { id: `stremio|${it.id}`, label: 'تحديث' }) : ''}<span class="y-sp"></span>${ib('itemMenu', 'more', { id: `stremio|${it.id}`, label: 'خيارات' })}${ib('open', 'open', { id: `stremio|${it.id}`, label: 'افتح' })}</div>${prog(it.id)}</div>`;

// ── الشاشات ──
const views = {
  hub() {
    if (S.q) {
      const hits = Object.keys(PROV).flatMap((p) => S.items[p].filter((x) => match(x.name)).map((x) => [p, x]));
      return hits.length ? `<div class="y-list">${hits.map(([p, it]) => `<div class="y-row" data-y="open" data-id="${p}|${it.id}" data-k="h-${p}-${it.id}">${logo(it.logo, it.name)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${PROV[p].name}</div></div><span class="y-ib" aria-hidden="true">${g('open')}</span></div>`).join('')}</div>` : empty('لا نتائج', `لا شيء مثبت باسم «${esc(S.q)}»`);
    }
    const order = [...S.provPins, ...Object.keys(PROV).filter((k) => !S.provPins.includes(k))];
    const total = Object.values(S.items).reduce((n,a)=>n+a.length,0), updates = Object.keys(PROV).reduce((n,k)=>n+upCount(k),0);
    const group = (label, keys) => keys.length ? `<section class="y-hub-group"><div class="y-group-head"><h3>${label}</h3><span>${keys.length}</span></div><div class="y-hub">${keys.map(provCard).join('')}</div></section>` : '';
    return `<div class="y-overview"><div class="y-overview-stats"><div><b>${total}</b><span>مثبّتة</span></div><div class="y-stat-btn ${updates?'has':''}" ${updates?'data-y="updSheet" role="button" tabindex="0" aria-label="عرض التحديثات"':''}><b>${updates}</b><span>تحديثات</span></div><div><b>${Object.keys(PROV).length}</b><span>مزوّدون</span></div></div></div>${group('المفضّلة',S.provPins)}${group('المزوّدون الآخرون',order.filter(k=>!S.provPins.includes(k)))}`;
  },
  stremio() {
    const all = S.items.stremio; const list = all.filter((x) => (S.filter === 'all' || x.type === S.filter) && match(x.name));
    const on = all.filter((x) => x.on).length;
    return `${header('stremio', `${all.length} إضافات · ${on} مفعّلة`)}
      <form class="y-add" data-y="addForm"><label class="y-in">${g('link', 22)}<input id="y-addon-url" class="${S.url ? 'ltr' : ''}" name="u" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="رابط الإضافة" placeholder="رابط الإضافة" value="${esc(S.url)}" data-y="url"></label><button class="y-pri big" type="submit" ${validUrl(S.url) ? '' : 'disabled'}>تثبيت الإضافة</button></form>
      <div class="y-chips">${[['all', 'الكل'], ['links', 'روابط'], ['subs', 'ترجمات'], ['cat', 'كتالوج']].map(([k, t]) => `<button class="y-chip ${S.filter === k ? 'on' : ''}" data-y="filter" data-id="${k}">${t}</button>`).join('')}</div>
      ${list.length ? `${orderGroups('stremio',list,stCard,'y-grid')}` : empty('لا شيء هنا', 'غيّر التصنيف أو أضف رابطًا')}`;
  },
  ext(p) {
    const inst = pinFirst(S.items[p]).filter((x) => match(x.name));
    const av = availFor(p);
    const repos = S.repos[p]; const up = upCount(p);
    const line = repos.length ? `${repos.map((r) => esc(r.name)).join(' · ')} · ${S.items[p].length} مثبتة` : 'بلا مستودع';
    if (!repos.length && !S.items[p].length) {
      return `${header(p, line)}<div class="y-empty">${`<span class="y-lg xl">${g('repo', 30)}</span>`}<div class="y-nm">أضف مستودعًا</div><div class="y-mt">الإضافات تأتي من المستودعات</div><button class="y-pri big" data-y="addRepo" data-id="${p}">${g('plus', 22)}مستودع</button></div>`;
    }
    const t = S.tab[p];
    const body = t === 'inst'
      ? `${up ? `<div class="y-tools"><span class="y-sp"></span><button class="y-pri" data-y="updAll" data-id="${p}">${g('update', 20)}حدّث الكل <i style="font-style:normal;opacity:.75">${up}</i></button></div>` : ''}${inst.length ? `${orderGroups(p,inst,x=>instRow(p,x),'y-list')}` : empty('لا شيء مثبت', 'ثبّت من «متاحة»')}`
      : t === 'avail'
        ? `<div class="y-tools">${langPill(p)}<button class="y-lang y-repo-filter" data-y="reposFilter" data-id="${p}" aria-haspopup="dialog">${g('repo',18)}<span>المستودعات: ${esc(S.repos[p].find(r=>r.id===S.repoFilter[p])?.name||'الكل')}</span>${g('down',16)}</button></div>${av.length ? `<section class="y-order-section" data-k="available-${p}"><div class="y-list y-available-list">${av.map((x) => availRow(p, x)).join('')}</div></section>` : empty('لا توجد إضافات مطابقة', 'غيّر المستودع أو اللغة أو البحث')}`
        : `<div class="y-list" style="grid-template-columns:1fr">${repos.map((r, i) => repoRow(p, r, i)).join('')}</div>`;
    return `${header(p, line)}${tabs(p, [['inst', 'مثبتة', S.items[p].length], ['avail', 'متاحة', S.avail[p].filter((x) => !S.items[p].some(i=>i.id===x.id)&&S.repos[p].some(r=>r.id===x.repoId)&&S.langs[p]?.has(x.lang)).length], ['repos', 'المستودعات', repos.length]])}<div class="y-tb">${body}</div>`;
  },
  details({ p, id }) {
    const it = S.items[p].find((x) => x.id === id); if (!it) return '';
    const st = p === 'stremio'; const idx = st ? S.items.stremio.indexOf(it) + 1 : 0;
    const kv = [
      `<div>تفعيل الإضافة${switchBtn(p,it)}</div>`,
      st ? `<div><span>الترتيب</span><b>${idx === 1 ? 'الأولى' : idx} من ${S.items.stremio.length}</b></div>` : '',
      st ? `<div><span>تقدّم</span><b>${TYPE[it.type]}</b></div>` : '',
      it.cont ? `<div><span>المحتوى</span><b>${it.cont}</b></div>` : '',
      !st ? `<div><span>المستودع</span><b>${esc(repoName(p,it))}</b></div>` : '',
      !st ? `<div><span>اللغة</span><b>${it.lang || 'العربية'}</b></div>` : '',
      it.bad ? '<div><span>الحالة</span><b class="y-bad">تعذّر الاتصال</b></div>' : '',
    ].join('');
    const b = S.busy[it.id];
    return `<div class="y-wide"><div class="y-det">${logo(it.logo, it.name, 'xxl')}<div class="y-nm">${esc(it.name)}</div><div class="y-mt" style="justify-content:center">${PROV[p].name}${it.ver ? ` · الإصدار ${b ? '…' : it.ver}` : ''}</div></div>
      <div class="y-acts"><button class="y-act ${it.pin ? 'on' : ''}" data-y="pin" data-id="${p}|${it.id}">${g(it.pin ? 'pinOn' : 'pin', 26)}${it.pin ? 'مفضّلة' : 'للمفضّلة'}</button><button class="y-act" data-y="conf" data-id="${it.id}" ${it.conf ? '' : 'disabled'}>${g('sliders', 26)}ضبط</button><button class="y-act" data-y="update" data-id="${p}|${it.id}" ${it.nv && !b ? '' : 'disabled'}>${g(b ? 'retry' : 'update', 26)}${b ? `${Math.round(b.p)}%` : it.nv ? 'تحديث' : 'محدّثة'}</button><button class="y-act" data-y="copy" data-id="${p}|${it.id}" ${it.url || !st ? '' : 'disabled'}>${g('link', 26)}الرابط</button></div>
      ${kv ? `<div class="y-kv">${kv}</div>` : ''}${!st?`<button class="y-pri big y-detail-enter" data-y="enterSource" data-id="${esc(p+'|'+it.id)}" ${it.on&&!it.bad?'':'disabled'}>فتح الإضافة ${g('open',20)}</button>`:''}
      <button class="y-del" data-y="askDel" data-id="${p}|${it.id}">${g('trash')}حذف الإضافة</button></div>`;
  },
};
const empty = (t, s) => `<div class="y-empty"><div class="y-nm">${t}</div><div class="y-mt">${s}</div></div>`;
const validUrl = (u) => /^(https?:\/\/|stremio:\/\/)[^\s/]+\.[^\s]+/i.test(u.trim());

// ── التركيب والرسم ──
const THEME = {accent:'#8f5cff',oled:false};
const THEME_COLORS=['#8f5cff','#4d8dff','#ff4f6d','#e8b04b','#3ccf9a','#f2f2f5'];
try{const t=JSON.parse(localStorage.getItem('vantara.addons.theme')||'null');if(t&&THEME_COLORS.includes(t.accent)){THEME.accent=t.accent;THEME.oled=t.oled===true;}}catch{}
function applyTheme(){
 const c=THEME.accent,o=THEME.oled, mix=(n,base)=>`color-mix(in srgb, ${c} ${n}%, ${base})`;
 const lum=c.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
 const vars={'--accent':c,'--brand':c,'--on-accent':lum>.179?'#08080a':'#fff','--accent-text':mix(62,'#fff'),'--accent-soft':mix(16,'transparent'),'--accent-line':mix(42,'transparent'),'--accent-press':mix(82,'#000'),'--bg':o?'#000':mix(4,'#050508'),'--bg-raised':o?'#090909':mix(5,'#08080c'),'--surface-1':o?'#101010':mix(6,'#0c0c11'),'--surface-2':o?'#171717':mix(7,'#131319'),'--surface-3':o?'#232323':mix(8,'#1b1b23'),'--line':o?'rgba(255,255,255,.09)':mix(10,'rgba(255,255,255,.06)'),'--line-strong':o?'rgba(255,255,255,.17)':mix(16,'rgba(255,255,255,.12)'),'--text-2':'#b9bac3','--text-3':'#94959f','--text-4':'#666873'};
 for(const e of new Set([document.documentElement,document.body,host])){for(const [k,v] of Object.entries(vars))e.style.setProperty(k,v);e.style.accentColor=c;e.style.caretColor=c;e.toggleAttribute('data-y-oled',o);}
 document.documentElement.style.background='var(--bg)';document.body.style.background='var(--bg)';host.style.background='var(--bg)';
 const probe=document.createElement('span');probe.style.color='var(--bg)';host.append(probe);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(probe).color);probe.remove();
 try{localStorage.setItem('vantara.addons.theme',JSON.stringify(THEME));}catch{}
}
let root, bar, titleEl, toolsEl, content, host = document.body;
const titleFor = (c) => c.v === 'details' ? PROV[c.p].name : 'الإضافات';
let renderedView = '', deferredRender = false;
const nodeKey = n => n.nodeType===1 ? (n.getAttribute('data-k') || (n.hasAttribute('data-y') ? n.tagName+'|'+n.getAttribute('data-y')+'|'+(n.getAttribute('data-id')||'') : '')) : '';
const compatible = (a,b) => a && a.nodeType===b.nodeType && (a.nodeType!==1 || (a.tagName===b.tagName && nodeKey(a)===nodeKey(b)));
function patchNode(a,b) {
  if(a.nodeType!==1){if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue;return;}
  for(const x of [...a.attributes]) if(!b.hasAttribute(x.name)) a.removeAttribute(x.name);
  for(const x of [...b.attributes]) if(a.getAttribute(x.name)!==x.value) a.setAttribute(x.name,x.value);
  if(a instanceof HTMLInputElement){if(a!==document.activeElement && a.value!==b.value)a.value=b.value;return;}
  patchChildren(a,b);
}
function patchChildren(parent,next){
  const old=[...parent.childNodes], used=new Set(), byKey=new Map();for(const x of old){const k=nodeKey(x);if(k){if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(x);}}let at=parent.firstChild;
  for(const n of [...next.childNodes]){
    const k=nodeKey(n);let found=k?(byKey.get(k)||[]).find(x=>!used.has(x)&&compatible(x,n)): (compatible(at,n)&&!used.has(at)?at:old.find(x=>!used.has(x)&&compatible(x,n)));
    if(found){used.add(found);if(found!==at)parent.insertBefore(found,at);if(!found.isEqualNode(n))patchNode(found,n);at=found.nextSibling;}
    else{const c=n.cloneNode(true);parent.insertBefore(c,at);at=c.nextSibling;}
  }
  for(const x of old)if(!used.has(x))x.remove();
}
function render({ anim=null, flip=true }={}){
  if(drag){deferredRender=true;return;}
  const c=cur(), key=c.v+(c.id||'');const same=renderedView===key;
  const before=flip&&!anim&&same?snap():null;
  const html=c.v==='hub'?views.hub():c.v==='stremio'?views.stremio():c.v==='details'?views.details(c):views.ext(c.v);
  const tpl=document.createElement('template');tpl.innerHTML=html;
  if(same)patchChildren(content,tpl.content);else{content.replaceChildren(tpl.content);renderedView=key;}
  renderBar();placeInd();if(before)play(before);
}
function renderBar() {
  const c = cur();
  if (S.searching) {
    titleEl.hidden = true;
    if (!bar.querySelector('.y-bar-q')) {
      const q = document.createElement('label'); q.className = 'y-bar-q'; q.innerHTML = `${g('search', 22)}<input data-y="q" aria-label="البحث في الإضافات" placeholder="${c.v === 'hub' ? 'ابحث في كل الإضافات' : 'ابحث'}" autocomplete="off">`;
      titleEl.after(q); q.querySelector('input').value = S.q; q.querySelector('input').focus();
    }
    const html=ib('closeSearch','close',{label:'إغلاق البحث',s:24}); if(toolsEl.dataset.mode!=='search'){toolsEl.innerHTML=html;toolsEl.dataset.mode='search';}
    return;
  }
  bar.querySelector('.y-bar-q')?.remove(); titleEl.hidden = false; titleEl.textContent = titleFor(c);
  const t = [];
  if (c.v !== 'details') t.push(ib('search', 'search', { label: 'بحث', s: 24 }));
  if (['cloudstream', 'mihon', 'aniyomi'].includes(c.v)) t.push(ib('addRepo', 'plus', { id: c.v, label: 'أضف مستودعًا', s: 24 }));
  if (c.v === 'hub') t.push(ib('theme', 'palette', { label: 'لون الثيم', s: 24 }));
  if (c.v === 'details') t.push(ib('itemMenu', 'more', { id: c.p + '|' + c.id, label: 'خيارات', s: 24 }));
  const html=t.join('');if(toolsEl.dataset.mode!==html){toolsEl.innerHTML=html;toolsEl.dataset.mode=html;}
}
// FLIP: كل عنصر بمفتاح data-k ينزلق من مكانه القديم
function snap() { const m = new Map(); content?.querySelectorAll('[data-k]').forEach((e) => m.set(e.dataset.k, e.getBoundingClientRect())); return m; }
function play(m) {
  if (RM) return;
  content.querySelectorAll('[data-k]').forEach((e) => {
    const a = m.get(e.dataset.k); const b = e.getBoundingClientRect();
    if (!a) { e.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: M.flip, easing: EASE }); return; }
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) > 1) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: M.flip, easing: EASE });
  });
}

// ── التنقّل والرجوع (زر الرجوع في الجوال يعمل) ──
let HIST=true,popPending=false,popTimer=0,navBusy=false;
const stateNow=()=>({y:true,d:S.stack.length,search:!!S.searching,sheet:!!sheetEl});
const hist=(o={})=>{if(!HIST)return;try{history.pushState({...stateNow(),...o},'');}catch{HIST=false;}};
function popOne(){if(popPending)return;if(!HIST){back();return;}popPending=true;try{history.back();popTimer=setTimeout(()=>{if(!popPending)return;popPending=false;back();try{history.replaceState(stateNow(),'');}catch{}},350);}catch{popPending=false;HIST=false;back();}}
function uiBack(){if(drag){finishDrag(drag.id,true);return;}if(sheetEl||S.searching||S.stack.length>1){popOne();return;}toast('هنا ترجع لفانتارا');}
function replayToggle(){if(!S.justToggled||RM)return;const [jp,jid]=S.justToggled.split('|');S.justToggled=null;const it=S.items[jp]?.find(x=>x.id===jid);const r=content.querySelector(jp==='stremio'?`[data-k="st-${CSS.escape(jid)}"]`:`[data-k="${CSS.escape(jp+'-'+jid)}"]`);if(!r||!it)return;r.classList.toggle('is-off',!!it.on);setTimeout(()=>{r.classList.toggle('is-off',!it.on);[...r.querySelectorAll(':scope>.y-ib,:scope>.y-sw')].forEach((x,n)=>x.animate([{opacity:0,transform:'scale(.86) translateX(10px)'},{opacity:1,transform:'none'}],{duration:240,delay:n*50,easing:EASE,fill:'backwards'}));},M.enter);}
function transition(dir,mutate){transition0(dir,mutate);if(dir==='out')replayToggle();}
function transition0(dir,mutate){if(drag)finishDrag(drag.id,true);clearHold();content?.getAnimations().forEach(a=>a.cancel());mutate();render({flip:false});if(dir==='in')scrollTo(0,0);if(!RM&&content){const dx=dir==='in'?-1:1;content.animate([{opacity:0,transform:`translateX(${dx*12}px)`},{opacity:1,transform:'none'}],{duration:180,easing:EASE});}}
function go(c){if(popPending)return;cur().savedFilter=S.filter;cur().savedScroll=scrollY;const wasSearch=S.searching;S.q='';S.searching=false;S.filter='all';transition('in',()=>S.stack.push(c));if(wasSearch&&HIST){try{history.replaceState(stateNow(),'');}catch{HIST=false;}}else hist();}
function back(){if(drag)finishDrag(drag.id,true);clearHold();if(sheetEl){closeSheet();return;}if(S.searching){S.searching=false;S.q='';render({flip:false});return;}if(S.stack.length>1){transition('out',()=>{S.stack.pop();S.filter=cur().savedFilter||'all';});scrollTo(0,cur().savedScroll||0);}}
addEventListener('popstate',e=>{clearTimeout(popTimer);popPending=false;if(e.state?.y){const s=e.state;if(sheetEl&&!s.sheet)closeSheet(true);if(S.searching&&!s.search){S.searching=false;S.q='';render({flip:false});}if(s.d<S.stack.length){transition('out',()=>{while(S.stack.length>s.d)S.stack.pop();S.filter=cur().savedFilter||'all';S.searching=false;S.q='';});scrollTo(0,cur().savedScroll||0);}else if(!sheetEl&&s.sheet){try{history.replaceState(stateNow(),'');}catch{}}}else back();});
// ── الأوراق والتنبيهات ──
let sheetEl = null,afterSheetClose=null;
function sheet(html, { onMount } = {}) {
  const replacing=!!sheetEl;closeSheet(true);
  sheetEl = document.createElement('div'); sheetEl.className = 'y-sheet'; sheetEl.dataset.y = 'scrim';
  sheetEl.innerHTML = `<div class="y-pan" role="dialog" aria-modal="true" aria-label="خيارات الإضافات">${D ? '' : '<div class="y-grab"></div>'}${html}</div>`;
  host.append(sheetEl);root.inert=true;bar.inert=true;if(!replacing)hist();syncSheetViewport();
  if (!RM) {
    sheetEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: M.sheetIn, easing: 'linear' });
    sheetEl.firstElementChild.animate(D ? [{ opacity: 0, transform: 'translateY(18px) scale(.98)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, offset: .45 }, { opacity: 1, transform: 'none' }], { duration: M.sheetIn, easing: EASE });
  }
  onMount?.(sheetEl);
}
function closeSheet(instant) {
  const el = sheetEl; if (!el) return; if(el.contains(document.activeElement))document.activeElement.blur(); sheetEl = null; root.inert=false;bar.inert=false;const next=afterSheetClose;afterSheetClose=null;if(next)queueMicrotask(next);
  if (instant || RM || el.dataset.dragged) { el.remove(); return; }
  el.style.pointerEvents = 'none';
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: M.sheetOut, easing: 'linear', fill: 'forwards' });
  el.firstElementChild.animate(D ? [{ opacity: 1 }, { opacity: 0, transform: 'translateY(12px) scale(.98)' }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(60%)' }], { duration: M.sheetOut, easing: EIN, fill: 'forwards' }).onfinish = () => el.remove();
}
const dismiss = () => { if (sheetEl) popOne(); };
let toastEl, toastT;
function toast(t) {
  toastEl?.remove(); clearTimeout(toastT);
  toastEl = Object.assign(document.createElement('div'), { className: 'y-toast', textContent: t }); toastEl.setAttribute('role','status'); host.append(toastEl);
  if (!RM) toastEl.animate([{ opacity: 0, transform: 'translate(-50%,12px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: M.toast, easing: EASE });
  toastT = setTimeout(() => { const e = toastEl; e?.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%,6px)' }], { duration: M.sheetOut, easing: EIN, fill: 'forwards' }).finished.then(() => e.remove()); }, 1900);
}

// Keep the sheet anchored to the visible viewport, not the keyboard-covered layout viewport.
let viewportRAF=0;
function syncSheetViewport(){if(!sheetEl)return;const v=window.visualViewport;const h=v?.height||innerHeight,t=v?.offsetTop||0;sheetEl.style.setProperty('--visible-h',`${Math.round(h)}px`);sheetEl.style.setProperty('--visible-top',`${Math.round(t)}px`);sheetEl.classList.toggle('y-compact-sheet',h<520&&!sheetEl.classList.contains('y-ra-sheet'));}
function scheduleSheetViewport(){cancelAnimationFrame(viewportRAF);viewportRAF=requestAnimationFrame(()=>{syncSheetViewport();const el=document.activeElement,body=sheetEl?.querySelector('.y-editor-body');if(!body||!body.contains(el)||!el.matches('input:not([type=file])'))return;const r=el.getBoundingClientRect(),b=body.getBoundingClientRect();if(r.bottom>b.bottom-8)body.scrollTop+=r.bottom-b.bottom+12;else if(r.top<b.top+8)body.scrollTop+=r.top-b.top-12;});}
window.visualViewport?.addEventListener('resize',scheduleSheetViewport);window.visualViewport?.addEventListener('scroll',scheduleSheetViewport);window.addEventListener('resize',scheduleSheetViewport);document.addEventListener('focusin',scheduleSheetViewport);
// ── عمليات بتقدّم مرئي ──
function run(id, kind, ms, done) {
  if (S.busy[id]) return; const job = S.busy[id] = { p: 0, kind }; const t0 = performance.now(); render({ flip: false });
  const tick = () => {
    if (S.busy[id] !== job) return;
    const p = Math.min(100, ((performance.now() - t0) / ms) * 100); S.busy[id].p = p;
    const bars = document.querySelectorAll(`[data-k$="-${CSS.escape(id)}"] .y-prog i, [data-k$="-a-${CSS.escape(id)}"] .y-prog i`);
    bars.forEach((b) => (b.style.width = p + '%'));
    document.querySelectorAll(`[data-k$="-${CSS.escape(id)}"] .y-up`).forEach((e) => (e.textContent = e.textContent.replace(/\d+%$/, Math.round(p) + '%')));
    if (cur().v === 'details') {const b=content.querySelector('[data-y="update"]');if(b&&b.dataset.id.endsWith('|'+id)&&b.lastChild?.nodeType===3)b.lastChild.nodeValue=Math.round(p)+'%';}
    if (p < 100) setTimeout(tick, 90); else { delete S.busy[id]; done(); render(); }
  };
  setTimeout(tick, 90);
}
const popPin = (sel) => { if (RM) return; content.querySelectorAll(sel).forEach((b) => b.firstElementChild?.animate([{ transform: 'scale(.6) rotate(-20deg)' }, { transform: 'scale(1.18) rotate(4deg)', offset: .6 }, { transform: 'none' }], { duration: M.enter, easing: EASE })); };
const find = (key) => { const [p, id] = key.split('|'); return [p, id, S.items[p]?.find((x) => x.id === id)]; };

const photoIcon='<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/></svg>';
function repoError(el,msg){const e=el?.querySelector('.y-repo-error');if(e){e.textContent=msg;e.hidden=!msg;}}
function refreshPhoto(el){const pic=el.querySelector('.y-repo-photo'),img=pic.querySelector('img');const u=repoImage(el.repoImage);img.hidden=!u;if(u)img.src=u;else img.removeAttribute('src');pic.classList.toggle('has-photo',!!u);el.querySelector('[data-y="removePhoto"]').hidden=!u;el.querySelector('.y-photo-label').textContent=u?'تغيير الصورة':'اختيار صورة';}
function openRepoEditor(p,r=null){sheet(`<div class="y-repo-editor"><div class="y-editor-title"><div><div class="y-editor-kicker">${esc(PROV[p].name)}</div><h2>${r?'تعديل المستودع':'إضافة مستودع'}</h2><p>أضف الرابط وخصّص الاسم والصورة.</p></div>${ib('done','close',{label:'إغلاق',s:22})}</div><div class="y-editor-body"><div class="y-photo-block"><label class="y-repo-photo" for="y-repo-file">${photoIcon}<img alt="صورة المستودع" hidden><span class="y-photo-plus">${g('plus',14)}</span></label><div class="y-photo-copy"><strong>صورة المستودع</strong><p>اختيارية · من جهازك</p><label class="y-photo-label" for="y-repo-file">اختيار صورة</label><button class="y-photo-remove" data-y="removePhoto" hidden>إزالة</button></div><input id="y-repo-file" class="y-file" type="file" accept="image/*" data-y="repoFile" aria-label="اختيار صورة المستودع"></div><div class="y-editor-fields"><label for="y-repo-name">لقب المستودع <small>اختياري</small></label><label class="y-in" for="y-repo-name"><input id="y-repo-name" data-y="repoName" maxlength="80" autocomplete="off" autocapitalize="off" enterkeyhint="next" value="${esc(r?.name||'')}" placeholder="مثال: مستودع الأنمي" dir="auto"></label><label for="y-repo-url">رابط المستودع <small>مطلوب</small></label><label class="y-in" for="y-repo-url">${g('link',20)}<input id="y-repo-url" class="ltr" data-y="repoUrl" type="url" inputmode="url" autocomplete="off" enterkeyhint="done" dir="ltr" autocapitalize="off" spellcheck="false" value="${esc(r?.url||'')}" placeholder="https://…/repo.json"></label><p class="y-editor-help">رابط ملف المستودع، وليس رابط صورة أو موقع عادي.</p><p class="y-repo-error" role="alert" hidden></p></div></div><div class="y-editor-footer"><button class="y-pri big" data-y="repoAdd" data-id="${p}">${g(r?'check':'plus',20)}${r?'حفظ التغييرات':'إضافة المستودع'}</button></div></div>`,{onMount:el=>{el.classList.add("y-editor-sheet");el.querySelector(".y-pan").setAttribute("aria-label",r?"تعديل المستودع":"إضافة مستودع");el.repoEditing=r;el.repoImage=r?.image||'';refreshPhoto(el);syncSheetViewport();}});}
async function choosePhoto(input){const el=sheetEl,file=input.files?.[0];if(!el||!file||el.dataset.saving==='1')return;const btn=el.querySelector('[data-y="repoAdd"]');el.dataset.imageBusy='1';btn.disabled=true;repoError(el,'');let url;try{if(file.size>20*1024*1024)throw Error('size');url=URL.createObjectURL(file);const im=new Image();im.src=url;await im.decode();if(!im.naturalWidth||!im.naturalHeight)throw Error('image');const c=document.createElement('canvas');c.width=c.height=384;const ctx=c.getContext('2d');const side=Math.min(im.naturalWidth,im.naturalHeight);ctx.fillStyle="#181818";ctx.fillRect(0,0,384,384);ctx.drawImage(im,(im.naturalWidth-side)/2,(im.naturalHeight-side)/2,side,side,0,0,384,384);if(sheetEl===el){el.repoImage=c.toDataURL('image/webp',.85);el.imageRemoved=false;refreshPhoto(el);}}catch{if(sheetEl===el)repoError(el,'تعذّر قراءة الصورة. اختر PNG أو JPEG أو WebP بحجم أقل من 20MB.');}finally{if(url)URL.revokeObjectURL(url);if(sheetEl===el){el.dataset.imageBusy='0';btn.disabled=false;input.value='';}}}

const LANGS={ar:'العربية',en:'الإنجليزية',ja:'اليابانية',es:'الإسبانية','es-419':'الإسبانية',id:'الإندونيسية',fr:'الفرنسية',pt:'البرتغالية','pt-BR':'البرتغالية',tr:'التركية',ru:'الروسية',ko:'الكورية',zh:'الصينية',de:'الألمانية',it:'الإيطالية',vi:'الفيتنامية',th:'التايلاندية',all:'متعدد اللغات',multi:'متعدد اللغات',mul:'متعدد اللغات'};
const langName=c=>LANGS[String(c||'').trim()]||LANGS[String(c||'').split('-')[0]]||(c?String(c):'متعدد اللغات');
async function getJson(u,ms=7000){const ab=new AbortController(),t=setTimeout(()=>ab.abort(),ms);try{const r=await fetch(u,{signal:ab.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw Object.assign(Error('http'),{code:'http'});return await r.json().catch(()=>{throw Object.assign(Error('json'),{code:'json'});});}finally{clearTimeout(t);}}
function ghAvatar(u){try{const x=new URL(u);const parts=x.pathname.split('/').filter(Boolean);if(x.hostname==='raw.githubusercontent.com'&&parts[0])return `https://github.com/${parts[0]}.png?size=128`;if(x.hostname.endsWith('github.io'))return `https://github.com/${x.hostname.split('.')[0]}.png?size=128`;if(x.hostname==='github.com'&&parts[0])return `https://github.com/${parts[0]}.png?size=128`;}catch{}return '';}
function ghOwner(u){try{const x=new URL(u);const parts=x.pathname.split('/').filter(Boolean);return x.hostname==='raw.githubusercontent.com'||x.hostname==='github.com'?parts[0]:x.hostname.split('.')[0];}catch{return '';}}
async function parseRepo(p,data,url){
  if(p==='cloudstream'){
    if(!data||Array.isArray(data)||!Array.isArray(data.pluginLists))throw Object.assign(Error('kind'),{code:Array.isArray(data)?'wrongProv':'kind'});
    const lists=await Promise.allSettled(data.pluginLists.slice(0,6).map(l=>getJson(new URL(l,url).href)));
    const items=lists.flatMap(r=>r.status==='fulfilled'&&Array.isArray(r.value)?r.value:[]).filter(x=>x&&x.name).map(x=>({id:String(x.internalName||x.name),name:String(x.name),ver:String(x.version??''),lang:langName(x.language),icon:typeof x.iconUrl==='string'&&/^https?:/.test(x.iconUrl)?x.iconUrl.replace('%size%','128'):''}));
    if(!items.length&&lists.every(r=>r.status==='rejected'))throw Object.assign(Error('lists'),{code:'net'});
    return {name:String(data.name||ghOwner(url)||'مستودع').slice(0,40),image:(typeof data.iconUrl==='string'&&/^https?:/.test(data.iconUrl)?data.iconUrl:'')||ghAvatar(url),items};
  }
  if(!Array.isArray(data))throw Object.assign(Error('kind'),{code:data&&Array.isArray(data.pluginLists)?'wrongProv':'kind'});
  const base=url.replace(/[^/]*$/,'');
  const items=data.filter(x=>x&&x.name&&x.pkg).map(x=>({id:String(x.pkg),name:String(x.name).replace(/^(Tachiyomi|Aniyomi|Mihon):\s*/i,''),ver:String(x.version??''),lang:langName(x.lang),icon:`${base}icon/${x.pkg}.png`}));
  let meta=null;try{meta=await getJson(base+'repo.json',3000);}catch{}
  return {name:String(meta?.meta?.name||meta?.name||ghOwner(url)||'مستودع').slice(0,40),image:ghAvatar(url),items};
}
function openRepoAdd(p){
  sheet(`<div class="y-ra"><div class="y-ra-head"><h2>مستودع جديد</h2>${ib('done','close',{label:'إغلاق',s:22})}</div>
    <label class="y-in y-ra-url">${g('link',20)}<input data-y="raUrl" type="url" inputmode="url" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="https://…/repo.json" aria-label="رابط المستودع"><button class="y-ra-paste" data-y="raPaste" type="button">لصق</button></label>
    <p class="y-ra-msg" role="status" aria-live="polite"></p>
    <div class="y-ra-prev is-empty"><label class="y-ra-img" aria-label="غيّر الصورة"><b>${g('link',24)}</b><img alt="" hidden><span class="y-photo-plus">${g('plus',14)}</span><input class="y-file" type="file" accept="image/*" data-y="raFile" hidden></label><div class="y-ra-meta"><label class="y-ra-nick"><span>اللقب</span><input data-y="raNick" maxlength="40" dir="auto" autocomplete="off" enterkeyhint="done" disabled placeholder="—"></label><div class="y-ra-count">الصورة واللقب يأتيان من الرابط</div></div></div>
    <button class="y-pri big" data-y="raAdd" data-id="${p}" disabled>${g('plus',20)}أضف</button></div>`,{onMount:el=>{el.raP=p;el.classList.add('y-ra-sheet');try{syncSheetViewport();}catch{}if(matchMedia('(pointer:fine)').matches)setTimeout(()=>{if(sheetEl===el)el.querySelector('[data-y="raUrl"]').focus();},M.sheetIn);}});
}
async function raCheck(el){
  const p=el.raP,inp=el.querySelector('[data-y="raUrl"]'),btn=el.querySelector('[data-y="raAdd"]'),msg=el.querySelector('.y-ra-msg'),prev=el.querySelector('.y-ra-prev');
  const tok=el.raTok=(el.raTok||0)+1;el.raData=null;btn.disabled=true;
  const say=(h,k='')=>{msg.innerHTML=h;msg.dataset.kind=k;};
  const nickEl=prev.querySelector('[data-y="raNick"]'),cnt=prev.querySelector('.y-ra-count'),pimg=prev.querySelector('img'),pb=prev.querySelector('b');
  const hide=()=>{if(prev.classList.contains('is-empty'))return;prev.classList.add('is-empty');pimg.hidden=true;pb.hidden=false;pb.innerHTML=g('link',24);if(!nickEl.dataset.touched)nickEl.value='';nickEl.disabled=true;cnt.textContent='الصورة واللقب يأتيان من الرابط';};
  const raw=inp.value.trim();if(!raw){say('');hide();return;}
  let url;try{url=new URL(raw.replace(/^cloudstreamrepo:\/\//i,'https://'));if(!/^https?:$/.test(url.protocol))throw 0;}catch{say('ليس رابطًا','err');hide();return;}
  const dup=S.repos[p].find(r=>r.url===url.href);if(dup){say(`مضاف مسبقًا<button data-y="raOpen" data-id="${esc(p+'|'+dup.id)}">افتحه</button>`,'err');hide();return;}
  say('يفحص…');
  try{const data=await getJson(url.href);if(tok!==el.raTok)return;const d=await parseRepo(p,data,url.href);if(tok!==el.raTok||sheetEl!==el)return;
    if(!d.items.length){say('المستودع فارغ','err');hide();return;}
    el.raData={...d,url:url.href};say('');
    pb.textContent=(d.name[0]||'?').toUpperCase();
    const pic=el.raImage||d.image;pimg.hidden=!pic;pb.hidden=!!pic;if(pic){pimg.onerror=()=>{pimg.hidden=true;pb.hidden=false;};pimg.src=pic;}
    nickEl.disabled=false;if(!nickEl.dataset.touched)nickEl.value=d.name;
    const langs=[...new Set(d.items.map(x=>x.lang))];cnt.textContent=`${d.items.length} ${d.items.length>=3&&d.items.length<=10?'إضافات':'إضافة'} · ${langs.length>2?langs.length+' لغات':langs.join(' · ')}`;
    const was=prev.classList.contains('is-empty');prev.classList.remove('is-empty');if(was&&!RM)[...prev.children].forEach(x=>x.animate([{opacity:0},{opacity:1}],{duration:M.enter,easing:EASE}));
    btn.disabled=false;
  }catch(e){if(tok!==el.raTok)return;hide();const c=e?.code;
    say(c==='kind'||c==='json'?'ليس ملف مستودع':c==='wrongProv'?`هذا مستودع ${p==='cloudstream'?'Mihon':'CloudStream'}`:'تعذّر الوصول<button data-y="raRetry">أعد</button>','err');
  }
}
async function raPhoto(input){const el=sheetEl,f=input.files?.[0];if(!el||!f)return;let u;try{u=URL.createObjectURL(f);const im=new Image();im.src=u;await im.decode();const c=document.createElement('canvas');c.width=c.height=256;const side=Math.min(im.naturalWidth,im.naturalHeight);c.getContext('2d').drawImage(im,(im.naturalWidth-side)/2,(im.naturalHeight-side)/2,side,side,0,0,256,256);el.raImage=c.toDataURL('image/webp',.85);const img=el.querySelector('.y-ra-img img');img.src=el.raImage;img.hidden=false;el.querySelector('.y-ra-img b').hidden=true;}catch{toast('تعذّر قراءة الصورة');}finally{if(u)URL.revokeObjectURL(u);input.value='';}}
// سحب مقبض الورقة لتحت يقفلها
let grabD=null;
document.addEventListener('pointerdown',e=>{const gb=e.target.closest('.y-sheet .y-grab');if(!gb||!sheetEl)return;const pan=gb.closest('.y-pan');grabD={pan,y:e.clientY,t:performance.now(),dy:0,id:e.pointerId};try{gb.setPointerCapture(e.pointerId);}catch{}pan.getAnimations().forEach(a=>a.cancel());},true);
document.addEventListener('pointermove',e=>{if(!grabD||e.pointerId!==grabD.id)return;grabD.dy=Math.max(0,e.clientY-grabD.y);grabD.pan.style.transform=`translateY(${grabD.dy}px)`;});
const grabEnd=e=>{if(!grabD||e.pointerId!==grabD.id)return;const g0=grabD;grabD=null;const v=g0.dy/Math.max(1,performance.now()-g0.t);if(g0.dy>90||v>.6){const el=sheetEl;if(el)el.dataset.dragged='1';g0.pan.animate([{transform:`translateY(${g0.dy}px)`},{transform:'translateY(100%)'}],{duration:M.sheetOut,easing:EIN,fill:'forwards'});el?.animate([{opacity:1},{opacity:0}],{duration:M.sheetOut,fill:'forwards'}).finished.then(()=>dismiss());}else{g0.pan.animate([{transform:`translateY(${g0.dy}px)`},{transform:'none'}],{duration:M.enter,easing:SPRING});g0.pan.style.transform='';}};
document.addEventListener('pointerup',grabEnd);document.addEventListener('pointercancel',grabEnd);
// ── الأحداث ──
const A = {
  prov: (k) => go({ v: k }),
  ppin(k) { const i = S.provPins.indexOf(k); if (i >= 0) S.provPins.splice(i, 1); else S.provPins.push(k); render(); if (i < 0) popPin(`[data-y="ppin"][data-id="${k}"]`); toast(i >= 0 ? 'أُلغي التثبيت' : 'ثُبّت في الأعلى'); },
  pin(key) {
    const [p,,it]=find(key);if(!it)return;it.pin=!it.pin;
    S.items[p]=pinFirst(S.items[p]);
    render(); if (it.pin) popPin(`[data-y="pin"][data-id="${CSS.escape(key)}"]`); toast(it.pin ? 'في المفضّلة: أولوية في آخر التحديثات' : 'أُزيلت من المفضّلة');
  },
  open(key) { const [p,id,it]=find(key);if(it)go({v:'details',p,id}); },
  tab(key) {
    const [p, k] = key.split('|'); if (S.tab[p] === k) return; const from = indPos(); S.tab[p] = k; render({ flip: false }); placeInd(from);
    if (!RM) content.querySelector('.y-tb')?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: M.tab, easing: EASE });
  },
  filter(k) { S.filter = k; render(); },
  toggle(key) {
    const [p,id,it]=find(key.includes('|')?key:'stremio|'+key);if(!it)return;it.on=!it.on;
    document.querySelectorAll(`[data-y="toggle"][data-id="${CSS.escape(p+'|'+id)}"]`).forEach(b=>{b.classList.toggle('off',!it.on);b.setAttribute('aria-checked',String(!!it.on));});
    const sel=p==='stremio'?`[data-k="st-${CSS.escape(id)}"]`:`[data-k="${CSS.escape(p+'-'+id)}"]`;const row=content.querySelector(sel);
    if(cur().v==='details'){S.justToggled=p+'|'+id;return;}
    if(RM||!row){render({flip:false});return;}
    const swaps=p!=='stremio'&&!D; // في الجوال: المفتاح يحل محل 📌 و›
    setTimeout(()=>{
      row.classList.toggle('is-off',!it.on);
      if(!swaps)return;
      const out=[...row.querySelectorAll(':scope>.y-ib,:scope>.y-sw')];
      out.forEach(x=>x.animate([{opacity:1,transform:'none'},{opacity:0,transform:'scale(.86) translateX(-6px)'}],{duration:M.sheetOut,easing:EIN,fill:'forwards'}));
      setTimeout(()=>{render({flip:false});const r2=content.querySelector(sel);if(!r2)return;
        [...r2.querySelectorAll(':scope>.y-ib,:scope>.y-sw')].forEach((x,n)=>x.animate([{opacity:0,transform:'scale(.86) translateX(10px)'},{opacity:1,transform:'none'}],{duration:240,delay:n*50,easing:EASE,fill:'backwards'}));},M.sheetOut);
    },200);
  },
  enterSource(key){const [p,id,it]=find(key);if(!it?.on||it.bad)return;sheet(`<div class="y-prev">${logo(it.logo,it.name,'xl')}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${esc(PROV[p].name)}</div></div></div><div class="y-source-note">هذه شاشة دخول الإضافة في التصور. عرض محتواها يتطلب ربط محرك ${esc(PROV[p].name)} الفعلي.</div><button class="y-sec" data-y="done">رجوع</button>`);},
  reposFilter(p){const selected=S.repoFilter[p];sheet(`<div class="y-ttl">المستودعات</div><div class="y-ls y-repo-options">${[{id:'all',name:'الكل'},...S.repos[p]].map(r=>`<button data-y="pickRepo" data-id="${esc(p+'|'+r.id)}" aria-pressed="${selected===r.id}">${r.id==='all'?`<span class="y-lg">${g('repo',22)}</span>`:repoLogo(r)}<span class="y-repo-option-name">${esc(r.name)}</span><span class="y-ck ${selected===r.id?'on':''}">${selected===r.id?g('check',18):''}</span></button>`).join('')}</div>`);},
  pickRepo(key){const i=key.indexOf('|'),p=key.slice(0,i),id=key.slice(i+1);S.repoFilter[p]=id;dismiss();render({flip:false});},
  conf: () => toast('يفتح صفحة ضبط الإضافة'),
  update(key) { const [p,id,it]=find(key);if(!it?.nv)return;run(id, 'update', 1600, () => { it.ver = it.nv; delete it.nv; toast(`${it.name} محدّثة`); }); },
  updAll(p) {
    const q = S.items[p].filter((x) => x.nv && !S.busy[x.id]); let i = 0;
    const next = () => { const it = q[i++]; if (!it) { toast('كل الإضافات محدّثة'); return; } run(it.id, 'update', 1300, () => { it.ver = it.nv; delete it.nv; next(); }); };
    next();
  },
  retry(key) { const [, id, it] = find(key); run(id, 'retry', 1100, () => { delete it.bad; toast(`${it.name} اتصلت`); }); },
  install(key) {
    const [p,id]=key.split('|');const it=S.avail[p].find(x=>x.id===id);if(!it||S.items[p].some(x=>x.id===id))return;
    run(id, 'install', 1700, () => { if(!S.items[p].some(x=>x.id===it.id))S.items[p].push({ ...it,on:1 }); toast(`${it.name} مثبتة`); });
  },
  cancel(key) { const [, id] = key.split('|'); delete S.busy[id]; render(); toast('أُلغي التثبيت'); },
  langs(p) {
    const counts = {}; S.avail[p].forEach((x) => (counts[x.lang] = (counts[x.lang] || 0) + 1));
    const list = Object.entries(counts).sort((a, b) => (a[0] === 'العربية' ? -1 : b[0] === 'العربية' ? 1 : b[1] - a[1]));
    const draw = (el) => { el.querySelector('.y-ls').innerHTML = list.map(([t, n]) => { const on = S.langs[p].has(t); return `<button data-y="lang" data-id="${p}|${t}"><span>${t}</span><i>${n}</i><span class="y-ck ${on ? 'on' : ''}" style="flex:none">${on ? g('check', 18) : ''}</span></button>`; }).join(''); };
    sheet(`<div class="y-ttl">اللغات<span data-y-cnt>${S.langs[p].size} مختارة</span></div><div class="y-ls"></div><button class="y-pri big" data-y="done">تم</button>`, { onMount: draw });
  },
  lang(key, btn) {
    const [p, t] = key.split('|'); const s = S.langs[p];
    if (s.has(t)) { if (s.size === 1) { btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: M.press }); return; } s.delete(t); } else s.add(t);
    const on = s.has(t); const ck = btn.querySelector('.y-ck'); ck.classList.toggle('on', on); ck.innerHTML = on ? g('check', 18) : '';
    if (on && !RM) { const pth = ck.querySelector('path'); const L = pth.getTotalLength(); pth.animate([{ strokeDasharray: L, strokeDashoffset: L }, { strokeDasharray: L, strokeDashoffset: 0 }], { duration: M.enter, easing: EASE }); ck.animate([{ transform: 'scale(.8)' }, { transform: 'scale(1.08)', offset: .6 }, { transform: 'none' }], { duration: M.press, easing: EASE }); }
    sheetEl.querySelector('[data-y-cnt]').textContent = `${s.size} مختارة`; render({ flip: false });
  },
  done: () => dismiss(),
  search() { if(S.searching)return;S.searching = true; render({ flip: false });hist(); },
  closeSearch() { if(S.searching)popOne(); },
  removePhoto(){if(!sheetEl)return;sheetEl.repoImage='';sheetEl.imageRemoved=true;refreshPhoto(sheetEl);},
  addRepo(p){openRepoAdd(p);},
  provAddRepo(k){openRepoAdd(k);},
  moveUp(key){const [p,,it]=find(key);if(it&&stepGroup(p,it,-1))render();},
  moveDown(key){const [p,,it]=find(key);if(it&&stepGroup(p,it,1))render();},
  provUpd(k){const q=S.items[k].filter(x=>x.nv&&!S.busy[x.id]);let i=0;const next=()=>{const it=q[i++];if(!it){toast(`${PROV[k].name}: كل الإضافات محدّثة`);return;}run(it.id,'update',900,()=>{it.ver=it.nv;delete it.nv;next();});};next();},
  raPaste(){const el=sheetEl;const inp=el?.querySelector('[data-y="raUrl"]');if(!inp)return;(navigator.clipboard?.readText?.()||Promise.reject()).then(t=>{inp.value=(t||'').trim();raCheck(el);}).catch(()=>{inp.focus();toast('الصق الرابط يدويًا');});},
  raRetry(){if(sheetEl)raCheck(sheetEl);},
  raOpen(key){const [p,id]=key.split('|');S.tab[p]='avail';S.repoFilter[p]=id;dismiss();render({flip:false});},
  raAdd(p){const el=sheetEl,d=el?.raData;if(!d)return;const nick=el.querySelector('[data-y="raNick"]').value.trim()||d.name;const image=el.raImage||d.image||'';const r={id:d.url,name:nick.slice(0,40),url:d.url,image,n:d.items.length};S.repos[p].push(r);const have=new Set(S.avail[p].map(x=>x.id));for(const it of d.items){if(have.has(it.id))continue;let k='';if(it.icon){k='r:'+it.id;IMG[k]=it.icon;}S.avail[p].push({id:it.id,name:it.name,ver:it.ver,lang:it.lang,logo:k,repoId:r.id,repoName:r.name});}for(const it of d.items)S.langs[p]?.add(it.lang);persistRepos();S.tab[p]='avail';S.repoFilter[p]=r.id;dismiss();render({flip:false});toast(`أُضيف ${r.name} · ${r.n}`);},
  updSheet(){const groups=Object.keys(PROV).map(p=>[p,S.items[p].filter(x=>x.nv)]).filter(([,a])=>a.length);if(!groups.length){toast('كل الإضافات محدّثة');return;}const n=groups.reduce((s,[,a])=>s+a.length,0);
    sheet(`<div class="y-ttl">التحديثات<span>${n}</span></div><div>${groups.map(([p,a])=>`<div class="y-up-h">${logo(p,PROV[p].name)}<span>${PROV[p].name}</span></div>${a.map(it=>`<div class="y-up-row" data-k="u-${p}-${esc(it.id)}">${logo(it.logo,it.name)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt"><span class="y-up"><bdi>${esc(it.ver)}</bdi> ← <bdi>${esc(it.nv)}</bdi></span></div></div><span class="y-prog"><i style="width:0"></i></span></div>`).join('')}`).join('')}</div><button class="y-pri big" data-y="updEverything">${g('update',20)}حدّث الكل</button>`);},
  updEverything(_,btn){if(btn)btn.disabled=true;const q=Object.keys(PROV).flatMap(p=>S.items[p].filter(x=>x.nv&&!S.busy[x.id]).map(x=>[p,x]));let i=0;const next=()=>{const e=q[i++];if(!e){toast('كل الإضافات محدّثة');setTimeout(()=>{if(sheetEl)dismiss();},450);return;}const [p,it]=e;run(it.id,'update',900,()=>{it.ver=it.nv;delete it.nv;const r=sheetEl?.querySelector(`[data-k="u-${p}-${CSS.escape(it.id)}"]`);if(r){r.classList.add('done');r.querySelector('.y-up').textContent='محدّثة';}next();});};next();},
  toFirst(key){const [p,,it]=find(key);if(!it)return;it.pin=1;const a=S.items[p];a.splice(a.indexOf(it),1);a.unshift(it);dismiss();render();toast('صارت الأولى');},
  editRepo(key){const [p,i]=key.split('|');const r=S.repos[p][+i];if(!r)return;openRepoEditor(p,r);},
  async repoAdd(p,btn){
    const el=sheetEl;if(!el||el.dataset.imageBusy==='1'||el.dataset.saving==='1')return;const u=el.querySelector('[data-y="repoUrl"]').value.trim();if(!safeImage(u)){repoError(el,'أدخل رابط HTTP أو HTTPS صالحًا.');return;}
    const url=new URL(u).href,old=el.repoEditing;if(S.repos[p].some(r=>r.url===url&&r!==old)){repoError(el,'هذا المستودع مضاف مسبقًا.');return;}
    const manualName=el.querySelector('[data-y="repoName"]').value.trim();let image=el.repoImage||'',name=manualName||new URL(url).hostname,n=old?.n??null,loaded=false;
    el.dataset.saving='1';btn.disabled=true;el.querySelectorAll('input').forEach(x=>x.disabled=true);btn.textContent='جارٍ الحفظ…';repoError(el,'');
    if(!old||old.url!==url){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),4500);try{const res=await fetch(url,{signal:abort.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!res.ok)throw Error('HTTP');const data=await res.json();if(data&&typeof data==='object'){if(!Array.isArray(data)){name=manualName||String(data.name||data.title||name).slice(0,80);const raw=data.iconUrl||data.icon||data.logo||data.image||data.logoUrl;if(!image&&!el.imageRemoved&&typeof raw==='string')image=safeImage(new URL(raw,url).href);}loaded=true;}}catch{}finally{clearTimeout(timer);}}
    if(sheetEl!==el)return;const r={id:old?.id||url,name,url,image,n};if(old){Object.assign(old,r);delete old.imageFailed;}else S.repos[p].push(r);const stored=persistRepos();dismiss();S.tab[p]='repos';render({flip:false});toast(!stored?'حُفظ لهذه الجلسة فقط':old?'تم حفظ المستودع':loaded?'أُضيف المستودع؛ جلب الإضافات غير مربوط':'أُضيف محليًا؛ تعذّر جلب بيانات الرابط');
  },
  repoMenu(key) {
    const [p, i] = key.split('|'); const r = S.repos[p][+i];
    sheet(`<div class="y-prev">${repoLogo(r,'xl')}<div class="y-tx"><div class="y-nm">${esc(r.name)}</div><div class="y-mt" style="direction:ltr;justify-content:flex-end">${esc(r.url.replace(/^https?:\/\//, ''))}</div></div></div><div class="y-menu"><button data-y="editRepo" data-id="${key}">${g('sliders')}تعديل اللقب والصورة والرابط</button><button data-y="copyRaw" data-id="${esc(r.url)}">${g('copy')}انسخ الرابط</button><button class="red" data-y="repoDel" data-id="${key}">${g('trash')}أزل المستودع</button></div>`);
  },
  repoDel(key) { const [p, i] = key.split('|'); const [r]=S.repos[p].splice(+i,1);if(!r)return;S.avail[p]=S.avail[p].filter(x=>x.repoId!==r.id);if(S.repoFilter[p]===r.id)S.repoFilter[p]='all';persistRepos();dismiss();render();toast('أُزيل المستودع؛ الإضافات المثبتة باقية'); },
  itemMenu(key) {
    const [p, , it] = find(key);
    sheet(`<div class="y-prev">${logo(it.logo, it.name, 'xl')}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${esc(p==='stremio'?(TYPE[it.type]||'')+' · '+(it.ver||''):repoName(p,it))}</div></div></div><div class="y-menu">${it.pin&&S.items[p].indexOf(it)===0?'':`<button data-y="toFirst" data-id="${key}">${g('pinOn')}اجعلها الأولى</button>`}<button data-y="toTop" data-id="${key}">${g('up')}للأعلى</button><button data-y="toBottom" data-id="${key}">${g('downMove')}للأسفل</button>${it.url ? `<button data-y="copy" data-id="${key}">${g('copy')}انسخ الرابط</button>` : ''}<button class="red" data-y="askDel" data-id="${key}">${g('trash')}احذف</button></div>`);
  },
  toTop(key) { const [p,,it]=find(key);if(!it)return;shiftGroup(p,it,true); dismiss(); render(); },
  toBottom(key){const [p,,it]=find(key);if(!it)return;shiftGroup(p,it,false);dismiss();render();},
  copy(key) { const [p, , it] = find(key); const u=it.url||repoOf(p,it)?.url;if(!u){toast('لا يوجد رابط متاح');return;} A.copyRaw(u); },
  async copyRaw(u){try{await navigator.clipboard.writeText(u);dismiss();toast('نُسخ الرابط');}catch{toast('تعذّر النسخ');}},
  askDel(key) {
    const [, , it] = find(key);
    const open = () => sheet(`<div class="y-prev">${logo(it.logo, it.name, 'xl')}<div class="y-tx"><div class="y-nm">حذف ${esc(it.name)}؟</div><div class="y-mt">تقدر تثبّتها من جديد</div></div></div><div class="y-btns"><button class="y-sec" data-y="done">إلغاء</button><button class="y-pri big" style="background:var(--danger)!important;color:#fff!important" data-y="del" data-id="${key}">احذف</button></div>`);
    open();
  },
  del(key) {
    const [p,id,it]=find(key);if(!it)return;delete S.busy[id];if(p!=='stremio'&&repoOf(p,it)&&!S.avail[p].some(x=>x.id===id)){const {pin,on,bad,nv,...rest}=it;S.avail[p].push({...rest,lang:it.lang||'العربية'});}S.items[p]=S.items[p].filter(x=>x.id!==id);if(cur().v==='details'){if(sheetEl)afterSheetClose=popOne;else popOne();}dismiss();
    setTimeout(() => { render(); toast(`حُذفت ${it.name}`); }, 120);
  },
  theme() {
    const cols = [['#8f5cff', 'بنفسجي'], ['#4d8dff', 'أزرق'], ['#ff4f6d', 'أحمر'], ['#e8b04b', 'ذهبي'], ['#3ccf9a', 'نعناعي'], ['#f2f2f5', 'أبيض']];
    const accent = getComputedStyle(host).getPropertyValue('--accent').trim();
    sheet(`<div class="y-ttl">لون الثيم<span>للتجربة</span></div><div class="y-sw-row">${cols.map(([c, n]) => `<button class="y-swatch ${accent === c ? 'on' : ''}" style="background:${c}" data-y="accent" data-id="${c}" aria-label="${n}"></button>`).join('')}</div><div class="y-kv" style="margin:0;background:var(--surface-2)"><div>أسود OLED<button class="y-sw ${THEME.oled ? '' : 'off'}" data-y="oled" role="switch" aria-label="أسود OLED" aria-checked="${THEME.oled}"></button></div></div><button class="y-pri big" data-y="done">تم</button>`);
  },
  accent(c) {if(!THEME_COLORS.includes(c))return;THEME.accent=c;applyTheme();sheetEl?.querySelectorAll('.y-swatch').forEach(b=>{b.classList.toggle('on',b.dataset.id===c);b.setAttribute('aria-pressed',String(b.dataset.id===c));});},
  oled(_,btn){THEME.oled=!THEME.oled;applyTheme();btn.classList.toggle('off',!THEME.oled);btn.setAttribute('aria-checked',String(THEME.oled));},
};
function onClick(e) {
  if(performance.now()<suppressClickUntil&&e.target.closest('.y-order-list')){e.preventDefault();e.stopPropagation();return;}
  const t = e.target.closest('[data-y]');
  if (!t) {
    const b = e.target.closest('[data-act="goBack"]'); if (b) { e.preventDefault(); uiBack(); return; }
    if (e.target.closest('a,button,[data-act]') && !e.target.closest('.y,.y-sheet,.y-bar-tools')) { e.preventDefault(); toast('هذا تصور لقسم الإضافات فقط'); }
    return;
  }
  const a = t.dataset.y;
  if (navBusy) { e.preventDefault(); return; }
  if (a === 'scrim') { if (e.target === t) dismiss(); return; }
  if (['url', 'q', 'repoUrl', 'repoName', 'repoImage', 'repoFile', 'addForm', 'grip', 'raUrl', 'raNick', 'raFile'].includes(a)) return;
  e.preventDefault(); e.stopPropagation();
  A[a]?.(t.dataset.id, t);
}
function onInput(e) {
  const a = e.target.dataset.y;
  if (a === 'q') { S.q = e.target.value; render({ flip: false }); }
  if (a === 'raNick') e.target.dataset.touched = '1';
  if (a === 'raUrl' && sheetEl) { clearTimeout(sheetEl.raT); sheetEl.raT = setTimeout(() => raCheck(sheetEl), 400); }
  if (a === 'url') { S.url = e.target.value; e.target.classList.toggle('ltr', !!S.url); content.querySelector('.y-add .y-pri').disabled = !validUrl(S.url); }
}
function onSubmit(e) {
  if (e.target.dataset.y !== 'addForm') return; e.preventDefault();
  const u = S.url.trim(); if (!validUrl(u)) return;
  let host = ''; try { host = new URL(u.replace(/^stremio:/, 'https:')).host; } catch {}
  const k = KNOWN[host]; const base = k || { name: host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()), ver: '—', type: 'links', cont: 'غير معروف حتى يُقرأ الملف' };
  if (S.items.stremio.some((x) => x.name === base.name)) { toast(`${base.name} مثبتة مسبقًا`); return; }
  const btn = content.querySelector('.y-add .y-pri'); btn.disabled = true; btn.innerHTML = `<span class="y-spin" style="display:grid">${g('retry', 20)}</span>`;
  setTimeout(() => {
    if(cur().v!=='stremio')return;render({ flip: false });
    sheet(`<div class="y-prev">${logo(base.logo, base.name, 'xl')}<div class="y-tx"><div class="y-nm">${esc(base.name)}</div><div class="y-mt">الإصدار ${base.ver}${base.conf ? ' · قابلة للضبط' : ''}</div></div></div><div class="y-kv" style="margin:0;background:var(--surface-2)"><div><span>تقدّم</span><b>${TYPE[base.type]}</b></div><div><span>المحتوى</span><b>${base.cont}</b></div></div><div class="y-btns">${base.conf ? '<button class="y-sec" data-y="conf">اضبط أولًا</button>' : '<button class="y-sec" data-y="done">إلغاء</button>'}<button class="y-pri big" data-y="confirmAdd">تثبيت</button></div>`);
    A.confirmAdd = () => { const id = 'n' + Date.now(); S.items.stremio.splice(S.items.stremio.filter(x=>x.pin).length,0,{ id, ...base, on: 1, url: u }); S.url = ''; const input=content.querySelector('[data-y="url"]');if(input)input.value='';dismiss(); setTimeout(() => { render(); toast(`${base.name} مثبتة`); const el = content.querySelector(`[data-k="st-${id}"]`); el?.scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' }); }, 80); };
  }, 650);
}

// ── الضغط: تصغير خفيف ثم ارتداد ──
const PRESS = '.y-stat-btn.has,.y-ra-paste,.y-ib,.y-pri,.y-sec,.y-out,.y-chip,.y-act,.y-prov,.y-del,.y-tab,.y-lang,.y-swatch,.y-menu>button,.y-ls>button,.y-row[data-y="open"]';
let pressed = null;
const depth = (el) => (el.matches('.y-prov,.y-row,.y-menu>button,.y-ls>button,.y-del') ? 0.975 : 0.92);
function pressDown(e) {
  if (RM || e.button > 0) return; const el = e.target.closest(PRESS); if (!el || el.closest('[disabled]') || e.target.closest('[data-y="grip"],input')) return;
  const inner = e.target.closest('.y-ib,.y-out,.y-sw'); const t = inner && el !== inner && el.contains(inner) ? inner : el;
  pressed = { el: t, s: depth(t), x: e.clientX, y: e.clientY };
  pressed.a = t.animate([{ transform: 'none' }, { transform: `scale(${pressed.s})` }], { duration: 90, easing: EASE, fill: 'forwards' });
}
function pressUp() {
  if (!pressed) return; const { el, s, a } = pressed; pressed = null; a.cancel();
  el.animate([{ transform: `scale(${s})` }, { transform: `scale(${1 + (1 - s) * 0.3})`, offset: 0.55 }, { transform: 'none' }], { duration: M.press, easing: 'ease-out' });
}
function pressMove(e) { if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 10) { pressed.a.cancel(); pressed = null; } }

// Reorder only within one pinned/unpinned group; vertical rail on mobile.
let drag=null,hold=null,suppressClickUntil=0;
const feedback=()=>{try{navigator.vibrate?.(12);}catch{}};
function layoutRect(el){const r=el.getBoundingClientRect(),t=getComputedStyle(el).transform;let x=0,y=0;if(t!=='none'){const m=new DOMMatrixReadOnly(t);x=m.m41;y=m.m42;}return {left:r.left-x,top:r.top-y,right:r.right-x,bottom:r.bottom-y,width:r.width,height:r.height};}
function clearHold(){if(hold){clearTimeout(hold.timer);hold=null;}}
function beginHold(target,x,y,id,kind){if(drag||hold||sheetEl||navBusy)return;const card=target.closest('.y-order-list[data-list="installed"]>[data-id]');if(!card||(!target.closest('.y-grip')&&target.closest('button:not(.y-ext-info),input')))return;const grid=card.parentElement;if(grid.children.length<2)return;hold={card,grid,id,kind,x,y,timer:null};if(grid.dataset.order==='stremio'&&target.closest('.y-grip'))startDrag();else hold.timer=setTimeout(startDrag,320);}
function startDrag(){if(!hold)return;const h=hold;clearHold();const {card,grid}=h;if(!card.isConnected)return;if(pressed){pressed.a.cancel();pressed=null;}for(const el of grid.children)el.getAnimations().forEach(a=>a.cancel());const r=layoutRect(card);drag={...h,order:[...grid.children],offsetY:h.y-r.top,raf:0};card.classList.add('drag');grid.classList.add('is-sorting');feedback();if(h.kind==='mouse')try{grid.setPointerCapture(h.id);}catch{};const loop=()=>{if(!drag)return;const d=drag,top=96,bottom=innerHeight-64;const dy=d.y<top?-Math.min(12,(top-d.y)/7):d.y>bottom?Math.min(12,(d.y-bottom)/7):0;const bounds=d.grid.getBoundingClientRect();if(dy&&((dy<0&&bounds.top<top)||(dy>0&&bounds.bottom>bottom))){scrollBy(0,dy);moveDrag();}d.raf=requestAnimationFrame(loop);};drag.raf=requestAnimationFrame(loop);}
function moveDrag(){const d=drag;if(!d)return;const {card,grid}=d;const bounds=grid.getBoundingClientRect(),r=layoutRect(card);const clamp=(v,min,max)=>Math.min(Math.max(v,min),Math.max(min,max));const rawTop=d.y-d.offsetY,top=clamp(rawTop,bounds.top,bounds.bottom-r.height);const cy=rawTop+r.height/2;const order=[...grid.children],index=order.indexOf(card),others=order.filter(x=>x!==card);let target=null,dist=Infinity;
 for(const el of others){const b=layoutRect(el);const delta=cy-(b.top+b.height/2),before=order.indexOf(el)<index;if((before&&delta<=-3)||(!before&&delta>=3)){const score=Math.abs(delta);if(score<dist){target=el;dist=score;}}}
 if(target){const before=order.indexOf(target)<index;const old=new Map(others.map(x=>[x,x.getBoundingClientRect()]));others.forEach(x=>x.getAnimations().forEach(a=>a.cancel()));grid.insertBefore(card,before?target:target.nextSibling);if(!RM)others.forEach(x=>{const a=old.get(x),b=layoutRect(x);if(Math.abs(a.top-b.top)+Math.abs(a.left-b.left)>1)x.animate([{transform:`translateY(${a.top-b.top}px)`},{transform:'none'}],{duration:150,easing:EASE});});}
 const b=layoutRect(card);card.style.transform=`translateY(${top-b.top}px)`;}
function moveHold(x,y,id){if(hold&&hold.id===id&&Math.hypot(x-hold.x,y-hold.y)>9)clearHold();if(drag&&drag.id===id){drag.x=x;drag.y=y;moveDrag();}}
function finishDrag(id,cancel=false){if(hold&&hold.id===id)clearHold();if(!drag||drag.id!==id)return;const d=drag,{card,grid}=d;drag=null;cancelAnimationFrame(d.raf);suppressClickUntil=performance.now()+400;if(d.kind==='mouse'&&grid.hasPointerCapture(id))grid.releasePointerCapture(id);const previous=card.getBoundingClientRect();[...grid.children].forEach(x=>x.getAnimations().forEach(a=>a.cancel()));card.style.transform='';card.classList.remove('drag');grid.classList.remove('is-sorting');if(cancel)d.order.forEach(x=>grid.append(x));else{const p=grid.dataset.order,store=S.items,ids=[...grid.children].map(x=>x.dataset.id),a=store[p],set=new Set(ids),shown=new Map(a.filter(x=>set.has(x.id)).map(x=>[x.id,x]));let i=0;const next=a.map(x=>set.has(x.id)?shown.get(ids[i++]):x);store[p]=pinFirst(next);if(ids.join()!==d.order.map(x=>x.dataset.id).join())feedback();}const r=layoutRect(card);if(!RM)card.animate([{transform:`translateY(${previous.top-r.top}px)`},{transform:'none'}],{duration:160,easing:EASE});if(deferredRender){deferredRender=false;render({flip:false});}}
function onDown(e){if(e.pointerType==='touch'||e.button!==0)return;beginHold(e.target,e.clientX,e.clientY,e.pointerId,'mouse');}
function onMove(e){if(e.pointerType==='touch')return;moveHold(e.clientX,e.clientY,e.pointerId);}
function onUp(e){if(e.pointerType==='touch')return;finishDrag(e.pointerId,e.type!=='pointerup');}
document.addEventListener('touchstart',e=>{if(e.touches.length!==1){clearHold();if(drag)finishDrag(drag.id,true);return;}const t=e.changedTouches[0];beginHold(e.target,t.clientX,t.clientY,t.identifier,'touch');},{passive:true});
document.addEventListener('touchmove',e=>{const t=[...e.changedTouches].find(t=>t.identifier===(drag?.id??hold?.id));if(!t)return;if(drag&&e.cancelable)e.preventDefault();moveHold(t.clientX,t.clientY,t.identifier);},{passive:false});
for(const event of ['touchend','touchcancel'])document.addEventListener(event,e=>{for(const t of e.changedTouches){if(drag?.id===t.identifier&&e.cancelable)e.preventDefault();finishDrag(t.identifier,event==='touchcancel');}},{passive:false});
document.addEventListener('contextmenu',e=>{if(e.target.closest('.y-order-list'))e.preventDefault();});
// ── التركيب داخل القشرة ──
function mount() {
  D = innerWidth >= 1000; const k = D ? 'desk' : 'mob'; const sh = SHELLS[k] || SHELLS.desk;
  const h = document.documentElement; const keep = { oled: h.dataset.yOled, style: h.getAttribute('style') };
  for (const a of [...h.attributes]) if (a.name !== 'style' || !keep.style) h.removeAttribute(a.name);
  for (const [n, v] of Object.entries(sh.html)) if (!(n === 'style' && keep.style)) h.setAttribute(n, v);
  if (keep.oled) h.dataset.yOled = '1';
  for (const [n, v] of Object.entries(sh.body)) document.body.setAttribute(n, v);
  document.body.innerHTML = sh.inner;
  document.getElementById('y-css')?.remove();
  const st = document.createElement('style'); st.id = 'y-css'; st.textContent = css(); document.head.append(st);
  root = document.querySelector('[data-y-root]'); bar = document.querySelector('[data-y-bar]'); titleEl = bar.querySelector('[data-y-title]');
  toolsEl = bar.querySelector('.page-top-left') || bar.appendChild(document.createElement('div'));
  const backBtn=bar.querySelector('[data-act="goBack"]');if(backBtn){backBtn.classList.add('y-back-fixed');backBtn.setAttribute('aria-label','رجوع');}toolsEl.classList.add('y-bar-tools'); bar.classList.add('y-bar'); bar.style.display = 'flex'; bar.style.alignItems = 'center';
  // الأوراق والتنبيهات داخل أعلى حاوية تعرّف رموز الألوان (لا تُعرَّف على :root)
  host = document.body; for (let e = root; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).getPropertyValue('--text-1').trim()) host = e;
  applyTheme();
  renderedView='';root.replaceChildren(content = Object.assign(document.createElement('div'), { className: 'y' }));
  render({ flip: false });
}
let mk = innerWidth >= 1000;
addEventListener('resize', () => { const n = innerWidth >= 1000; if (n!==mk){if(drag)finishDrag(drag.id,true);clearHold();mk=n;closeSheet(true);mount();} else { placeInd(); } });
document.addEventListener('click', onClick, true);
document.addEventListener('input', onInput);
document.addEventListener('change',e=>{if(e.target.matches('[data-y="repoFile"]'))choosePhoto(e.target);if(e.target.matches('[data-y="raFile"]'))raPhoto(e.target);});
document.addEventListener('submit', onSubmit, true);
document.addEventListener('pointerdown', onDown);
document.addEventListener('pointerdown', pressDown, true);
document.addEventListener('pointerup', pressUp, true); document.addEventListener('pointercancel', pressUp, true);
document.addEventListener('pointermove', pressMove, { passive: true });
document.addEventListener('pointermove', onMove);
document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onUp);document.addEventListener('lostpointercapture',onUp);
document.addEventListener('error',e=>{if(e.target.matches?.('.y-repo-logo img')){const src=e.target.getAttribute('src');for(const list of Object.values(S.repos))for(const r of list)if(repoImage(r.image)===src)r.imageFailed=true;e.target.remove();}},true);
document.addEventListener('keydown', (e) => { if(e.key==='Enter'&&e.target.dataset?.y==='raUrl'){e.preventDefault();const b=sheetEl?.querySelector('[data-y="raAdd"]');if(b&&!b.disabled)b.click();else if(sheetEl)raCheck(sheetEl);return;} if(e.key==='Tab'&&sheetEl){const els=[...sheetEl.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(x=>!x.hidden&&x.getClientRects().length);if(els.length){const i=els.indexOf(document.activeElement);if(i<0||(e.shiftKey&&i===0)||(!e.shiftKey&&i===els.length-1)){e.preventDefault();els[e.shiftKey?els.length-1:0].focus();return;}}}if(e.key==='Enter'&&e.target.matches('#y-repo-name,#y-repo-url')){e.preventDefault();if(e.target.id==='y-repo-name')sheetEl?.querySelector('#y-repo-url')?.focus();else sheetEl?.querySelector('[data-y="repoAdd"]')?.click();return;} if (e.key === 'Escape') { e.preventDefault(); uiBack(); } else if (['Enter',' '].includes(e.key) && e.target.matches('.y-row[data-y="open"]')) { e.preventDefault(); A.open(e.target.dataset.id); } });
try { history.replaceState(stateNow(), ''); } catch { HIST = false; }
mount();
window.__y = { S, A, render };
})();
