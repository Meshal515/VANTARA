import './boot.js';
import { getRuntime } from './runtime.js';
import { createCinema } from '../v35/cinema.js';
import { createAnime } from '../v35/anime.js';
import { renderAddons } from '../v35/addons-view.js';
import { renderSourceMode } from '../v35/source-mode.js';
import { sourceWorkModel, restoreSourceWork } from '../addons/work-view.js';
import { GENRES_AR } from '../lib/cinema-meta.js';

export async function createDesktopApp({ root = document.getElementById('root'), runtime = getRuntime() } = {}) {
  root.className = 'v35 desktop-shell'; root.dataset.section = 'cinema';
  root.innerHTML = `<header class="desktop-header"><a class="desktop-brand" href="/desktop/index.html"><img src="/icons/icon-512.png" alt="" width="36" height="36">VANTARA <small>ويندوز</small></a><nav aria-label="الأقسام"><button type="button" data-desktop-section="cinema">السينما</button><button type="button" data-desktop-section="anime">الأنمي</button><button type="button" data-desktop-addons>الإضافات</button><a data-desktop-accounts href="/index.html">حسابي</a></nav></header>
  <nav class="desktop-pages" aria-label="تصفح القسم"><button type="button" data-desktop-page="home">الرئيسية</button><button type="button" data-desktop-page="discover">اكتشف</button><button type="button" data-desktop-page="library">آخر المشاهدات</button><button type="button" data-desktop-back>رجوع</button></nav>
  <main class="app"><section id="home" class="page"><div id="cinemaHome" class="home-view cinema-home"></div><div id="animeHome" class="home-view anime-home" hidden></div></section><section id="discover" class="page"><div id="cinemaDiscover"></div><div id="animeDiscover" hidden></div></section><section id="library" class="page"><div id="cinemaLibrary"></div><div id="animeLibrary" hidden></div></section><section id="cinema" class="page"></section><section id="anime" class="page"></section><section id="utility" class="page"><h1 id="utilityTitle">الإضافات</h1><div id="utilityBody"></div></section></main>
  <div id="sheet" class="sheet-backdrop"><div id="sheetBody" class="sheet"></div></div><div id="desktopToast" class="desktop-toast" role="status" aria-live="polite" hidden></div>`;
  const q = id => root.querySelector(`#${id}`);
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  let page = 'utility', section = 'cinema', sheetClose = null, view = null, sourceSnapshot = null, toastTimer, generation = 0;
  const toast = text => { const host = q('desktopToast'); host.textContent = text; host.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.hidden = true; }, 6000); };
  function closeSheet() { q('sheet').classList.remove('show'); const close = sheetClose; sheetClose = null; close?.(); }
  function openSheet(build, { tone = section, full = false } = {}) {
    closeSheet(); const body = q('sheetBody'); body.replaceChildren(); body.className = 'sheet';
    q('sheet').dataset.tone = tone; q('sheet').classList.toggle('sheet-backdrop--full', full);
    sheetClose = build(body) ?? null; q('sheet').classList.add('show');
  }
  function closeSource() { view?.close?.(); view = null; sourceSnapshot?.release(); sourceSnapshot = null; }
  function showPage(id) {
    if (page === 'utility' && id !== 'utility') { generation++; closeSource(); }
    if (page === 'anime' && id !== 'anime') anime.leaveDetail();
    page = id;
    root.querySelectorAll('.page').forEach(node => node.classList.toggle('active', node.id === id));
    for (const suffix of ['Home', 'Discover', 'Library']) {
      q(`cinema${suffix}`).hidden = section !== 'cinema'; q(`anime${suffix}`).hidden = section !== 'anime';
    }
    root.querySelectorAll('[data-desktop-page]').forEach(node => { node.setAttribute('aria-current', node.dataset.desktopPage === id ? 'page' : 'false'); });
  }
  const deps = { root, q, el, toast, closeSheet, openSheet, showPage, goBack: () => navigate('home'), currentPage: () => page, genreAr: genre => GENRES_AR[genre] ?? genre,
    readKv: key => runtime.store.get('meta', key), writeKv: (key,value) => runtime.store.set('meta', key, value),
    restoreSourceWork: (ref, work) => restoreSourceWork(ref, { addons: runtime.addons, title: work?.title, cover: work?.poster }),
  };
  // لا sync بديل ولا مستخدم ضيف ينتحل الحساب. صفحة /index.html تملك الدخول الحقيقي.
  const cinema = createCinema(deps), anime = createAnime(deps);
  function navigate(id) {
    showPage(id); const current = section === 'cinema' ? cinema : anime;
    if (id === 'home') current.show();
    else if (id === 'discover') current.showDiscover();
    else if (id === 'library') current.renderLibrary();
  }
  async function openAddons() {
    const run = ++generation; closeSource(); showPage('utility'); q('utilityTitle').textContent = 'الإضافات';
    q('utilityBody').replaceChildren(el('p', 'work-meta', 'جارٍ قراءة الإضافات…'));
    await runtime.addons.ready;
    if (run !== generation) return;
    view = renderAddons({ registry: runtime.addons.registry, filter: 'all', pulse: runtime.addons.pulse, onOpenSource: openSource, onProbe: runtime.addons.diagnose ? (addon,options) => runtime.addons.diagnose(addon.key, options) : null, onCheck: runtime.addons.diagnose ? (addon,options) => runtime.addons.diagnose(addon.key,options) : undefined });
    q('utilityBody').replaceChildren(view);
  }
  async function openSource(addon, state = {}) {
    const run = ++generation; closeSource(); showPage('utility'); q('utilityTitle').textContent = addon.name;
    sourceSnapshot = runtime.addons.registry.snapshot();
    view = renderSourceMode({ addon, adapter: runtime.addons.adapter(addon.key), pulse: runtime.addons.pulse, state, onBack: () => void openAddons(), onOpenWork: async item => {
      try {
        const source = runtime.addons.sources.source(addon.sourceId ?? `addon|${addon.key}`);
        if (!source || item.type === 'manga') throw new Error('هذا النوع غير مدعوم في نسخة ويندوز الحالية');
        const copy = { ...item, url: item.url ?? item.id, type: item.type };
        const episodes = await source.episodes(copy);
        if (run !== generation) return;
        const work = sourceWorkModel(item, { addon, episodes });
        section = addon.contentTypes.includes('anime') ? 'anime' : 'cinema'; root.dataset.section = section;
        if (section === 'anime') await anime.openAnime(work); else await cinema.openWork(work);
      } catch (error) { toast(error.message); }
    } });
    q('utilityBody').replaceChildren(view);
  }
  root.querySelectorAll('[data-desktop-section]').forEach(button => { button.onclick = () => { section = button.dataset.desktopSection; root.dataset.section = section; navigate('home'); }; });
  root.querySelectorAll('[data-desktop-page]').forEach(button => { button.onclick = () => navigate(button.dataset.desktopPage); });
  root.querySelector('[data-desktop-addons]').onclick = () => void openAddons().catch(error => toast(error.message));
  root.querySelector('[data-desktop-back]').onclick = () => navigate('home');
  q('sheet').onclick = event => { if (event.target === q('sheet')) closeSheet(); };
  const escape = event => { if (event.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', escape);
  // إعداد الخدمات يفتح في نافذة معزولة تلتقط رابط stremio المعدّ.
  const external = event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || !/^https:\/\//i.test(anchor.getAttribute('href') ?? '') || !globalThis.VantaraDesktop?.openExternal) return;
    event.preventDefault(); void globalThis.VantaraDesktop.openExternal({ url: anchor.href }).catch(error => toast(error.message));
  };
  root.addEventListener('click', external);
  await openAddons();
  return { openAddons, navigate, close() { generation++; clearTimeout(toastTimer); closeSheet(); closeSource(); document.removeEventListener('keydown', escape); root.removeEventListener('click', external); } };
}

if (globalThis.document?.querySelector('[data-desktop-entry]')) {
  void createDesktopApp().catch(error => { document.getElementById('root').textContent = `تعذر إقلاع الواجهة: ${error.message}`; });
}
