import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { renderAddonsHub, nativePackage, cloudstreamContent, remoteType, langName, P } from './addons-hub.js';

afterEach(() => { vi.unstubAllGlobals(); });
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
function setup() {
  const { document, window } = parseHTML('<html><head></head><body><div class="v35"><section class="page" id="utility"><div class="page-top"><div class="page-top-right"><button data-act="goBack"></button></div><h1 id="utilityTitle">VANTARA</h1><div class="page-top-left"></div></div><div class="page-body" id="utilityBody"></div></section></div></body></html>');
  vi.stubGlobal('document', document); vi.stubGlobal('window', window);
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) });
  window.innerWidth = 412;
  return { document, window, store };
}
const REPO = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
function manga({ installed = [{ pkg: 'eu.ext.ar.teamx', name: 'Tachiyomi: Team X', version: '1.4.10', repo: REPO }] } = {}) {
  let inst = [...installed];
  const api = {
    list: vi.fn(async () => ({ repos: [{ url: REPO, name: 'keiyoushi' }], installed: inst })),
    add: vi.fn(async (url) => ({ repo: { url } })), remove: vi.fn(async () => ({})),
    extensions: vi.fn(async () => [
      { pkg: 'eu.ext.ar.teamx', name: 'Tachiyomi: Team X', version: '1.4.11', lang: 'ar', installed: '1.4.10', update: true },
      { pkg: 'eu.ext.ar.onma', name: 'Tachiyomi: Onma', version: '1.4.7', lang: 'ar', installed: null, update: false },
      { pkg: 'eu.ext.all.nsfwthing', name: 'Hentai Place', version: '1', lang: 'all', nsfw: true, installed: null },
    ]),
    install: vi.fn(async (repo, pkg) => { inst = [...inst, { pkg, name: 'Onma', version: '1.4.7', repo }]; }),
    uninstall: vi.fn(async (pkg) => { inst = inst.filter((x) => x.pkg !== pkg); }),
  };
  return api;
}
const mount = (opts) => { const root = renderAddonsHub({ profile: 't', ...opts }); document.getElementById('utilityBody').replaceChildren(root); return root; };
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

it('يعرض المزوّدين الذين لهم محرك على هذا الجهاز فقط', async () => {
  setup();
  const root = mount({ registry: { list: () => [] }, repositories: manga() });
  await tick();
  const provs = [...root.querySelectorAll('.y-prov[data-y="prov"]')].map((x) => x.dataset.id);
  expect(provs).toEqual(['stremio', 'mihon']);
  expect(root.textContent).not.toContain('CloudStream');
  root.close();
});

it('بلا أي محرك (نسخة المتصفح للتتبع) يقول ذلك صراحة', async () => {
  setup();
  const root = mount({});
  await tick();
  expect(root.textContent).toContain('نسخة المتصفح للتتبع فقط');
  root.close();
});

it('Mihon: لا مفتاح تفعيل لأن المحرك لا يدعمه، والمتاحة تخفي محتوى الكبار', async () => {
  setup();
  const api = manga();
  const root = mount({ repositories: api, initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }] } });
  await tick();
  expect(root.querySelector('[data-y="toggle"]')).toBeNull();
  expect(root.textContent).toContain('Team X');
  expect(root.textContent).not.toContain('Tachiyomi:');
  root.hub.A.tab('mihon|avail');
  expect(root.textContent).toContain('Onma');
  expect(root.textContent).not.toContain('Hentai');
  root.close();
});

it('التثبيت يمر على المحرك ويتأكد من حفظه قبل إعلان النجاح', async () => {
  setup();
  const api = manga();
  const changed = vi.fn();
  const root = mount({ repositories: api, onSourcesChanged: changed, initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }], tab: { mihon: 'avail' } } });
  await tick();
  const btn = root.querySelector('[data-y="install"][data-id="mihon|eu.ext.ar.onma"]');
  expect(btn).toBeTruthy();
  expect(btn.innerHTML).toContain('M12 3.9v9.5M7.75 9.4 12 13.65l4.25-4.25M5.5 17.9h13');
  click(btn);
  await tick(30);
  expect(api.install).toHaveBeenCalledWith(REPO, 'eu.ext.ar.onma');
  expect(root.hub.S.items.mihon.map((x) => x.id)).toContain('eu.ext.ar.onma');
  expect(root.hub.S.avail.mihon.map((x) => x.id)).not.toContain('eu.ext.ar.onma');
  root.close();
});

it('تثبيت لم يحفظه المحرك لا يُعلن ناجحًا', async () => {
  setup();
  const api = manga(); api.install = vi.fn(async () => {});
  const root = mount({ repositories: api, initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }], tab: { mihon: 'avail' } } });
  await tick();
  click(root.querySelector('[data-y="install"]'));
  await tick(30);
  expect(root.hub.S.items.mihon.map((x) => x.id)).not.toContain('eu.ext.ar.onma');
  expect(document.querySelector('.y-toast').textContent).toContain('لم يؤكد المحرك');
  root.close();
});

it('CloudStream: المفتاح يستدعي enable، والفشل يعيده كما كان', async () => {
  setup();
  const cs = {
    list: async () => ({ repos: [], installed: [{ pkg: 'Akwam', name: 'Akwam', version: '3', enabled: true }] }),
    add: async () => ({}), remove: async () => ({}), extensions: async () => [], install: async () => {}, uninstall: async () => {},
    enable: vi.fn(async () => { throw new Error('رفض المحرك'); }),
  };
  const root = mount({ cloudstreamRepositories: cs, initialState: { stack: [{ v: 'hub' }, { v: 'cloudstream' }, { v: 'details', p: 'cloudstream', id: 'Akwam' }] } });
  await tick();
  const sw = root.querySelector('[data-y="toggle"]');
  expect(sw.getAttribute('aria-checked')).toBe('true');
  click(sw);
  await tick();
  expect(cs.enable).toHaveBeenCalledWith('Akwam', false);
  expect(root.hub.S.items.cloudstream[0].on).toBe(true);
  expect(root.querySelector('[data-y="toggle"]').getAttribute('aria-checked')).toBe('true');
  root.close();
});

it('Stremio: المفضّلة والتفعيل والحذف عبر السجل نفسه', async () => {
  setup();
  const rows = [{ key: 'tio', name: 'Torrentio', version: '1', capabilities: ['streams'], contentTypes: ['movie'], enabled: true, pinned: false }];
  const registry = {
    list: () => rows.map((r) => ({ ...r })), pin: vi.fn(async (k, v) => { rows[0].pinned = v; }), enable: vi.fn(async (k, v) => { rows[0].enabled = v; }),
    remove: vi.fn(async () => { rows.length = 0; }), connection: () => ({ manifestUrl: 'https://tio.example/manifest.json' }),
  };
  const root = mount({ registry, initialState: { stack: [{ v: 'hub' }, { v: 'stremio' }] } });
  await tick();
  await root.hub.A.pin('stremio|tio');
  expect(registry.pin).toHaveBeenCalledWith('tio', true);
  await root.hub.A.toggle('stremio|tio');
  expect(registry.enable).toHaveBeenCalledWith('tio', false);
  await root.hub.A.del('stremio|tio');
  expect(registry.remove).toHaveBeenCalledWith('tio');
  root.close();
});

it('تحديات الحماية: مربع في المزوّدين، والتحقق بضغطة المستخدم فقط', async () => {
  setup();
  let subscriber = null;
  const verification = { list: () => [{ host: 'Witanime.cyou', sourceName: 'Witanime', state: 'required' }], subscribe: (f) => { subscriber = f; return () => {}; }, begin: vi.fn(async () => ({ ok: true })) };
  const root = mount({ repositories: manga(), verification });
  await tick();
  expect(root.querySelector('[data-y="guard"]')).toBeTruthy();
  expect(verification.begin).not.toHaveBeenCalled();
  root.hub.A.guard();
  const verify = document.querySelector('.y-sheet [data-y="verify"]');
  expect(verify.dataset.id).toBe('witanime.cyou');
  click(verify);
  await tick();
  expect(verification.begin).toHaveBeenCalledWith('witanime.cyou');
  subscriber([]);
  await tick();
  expect(root.querySelector('[data-y="guard"]')).toBeNull();
  root.close();
});

it('الرجوع داخل المدير أولًا، والإغلاق يعيد شريط القشرة كما كان', async () => {
  setup();
  const bar = document.querySelector('.page-top');
  const root = mount({ repositories: manga(), initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }] } });
  await tick();
  expect(bar.classList.contains('y-bar')).toBe(true);
  expect(document.getElementById('utilityTitle').textContent).toBe('الإضافات');
  expect(root.back()).toBe(true);
  expect(root.hub.S.stack.length).toBe(1);
  expect(root.back()).toBe(false);
  expect(root.snapshot().stack).toEqual([{ v: 'hub' }]);
  root.close();
  expect(bar.classList.contains('y-bar')).toBe(false);
  expect(bar.getAttribute('style')).toBeNull();
  expect(document.querySelector('.page-top-left').innerHTML).toBe('');
});

it('لا أزرار بلا محرك: لا لون ثيم ولا إلغاء ولا نسب تقدّم مزيفة', async () => {
  setup();
  const api = manga();
  let release; api.install = vi.fn(() => new Promise((r) => { release = r; }));
  const root = mount({ repositories: api, initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }], tab: { mihon: 'avail' } } });
  await tick();
  click(root.querySelector('[data-y="install"]'));
  await tick();
  const html = root.innerHTML + document.querySelector('.page-top').innerHTML;
  for (const fake of ['data-y="theme"', 'data-y="cancel"']) expect(html).not.toContain(fake);
  expect(root.textContent).not.toMatch(/\d+%/);
  expect(root.querySelector('.y-prog.ind')).toBeTruthy();
  release(); root.close();
});

it('المساعدات: هوية الحزمة، ونوع CloudStream بالأغلبية، ونوع إضافة الويب، واللغة', () => {
  expect(nativePackage({ sourceId: 'addon|cs3|Akwam' })).toBe('Akwam');
  expect(nativePackage({ internalName: 'Anime4up' })).toBe('Anime4up');
  expect(cloudstreamContent({ tvTypes: ['Movie', 'TvSeries', 'Anime'] })).toBe('cinema');
  expect(cloudstreamContent({ tvTypes: ['Anime', 'Movie'] })).toBe('anime');
  expect(remoteType({ capabilities: ['subtitles'] })).toBe('subs');
  expect(langName('pt-BR')).toBe('البرتغالية');
});

it('زر التثبيت متمركز بصريًا: مركز الحبر بين مركز الصندوق ومركز الثقل عند منتصف الشبكة', () => {
  // y للساق 3.9→13.4، والرأس حتى 13.65، والصينية 17.9
  const ys = [...P.install.matchAll(/[ML]?([\d.]+)[ ,]([\d.]+)/g)].map((m) => +m[2]);
  const box = (Math.min(...ys) + Math.max(...ys)) / 2;
  expect(box).toBeLessThan(12);
  expect(box).toBeGreaterThan(10.5);
});

it('فتح الإضافة يمرر للقشرة السجل الذي يحتاجه createNativeCatalog (النوع والمخزن والمحتوى)', async () => {
  setup();
  const opened = vi.fn();
  const cs = {
    family: 'cloudstream',
    list: async () => ({ repos: [{ url: 'https://example.org/repo.json', name: 'r' }], installed: [{ pkg: 'Akwam', name: 'Akwam', version: '3', enabled: true, repo: 'https://example.org/repo.json' }] }),
    add: async () => ({}), remove: async () => ({}), install: async () => {}, uninstall: async () => {}, enable: async () => {},
    extensions: async () => [{ internalName: 'Akwam', name: 'Akwam', version: '3', tvTypes: ['Movie', 'TvSeries'], installed: '3' }],
  };
  const root = mount({ cloudstreamRepositories: cs, onOpenNativeSource: opened, initialState: { stack: [{ v: 'hub' }, { v: 'cloudstream' }] } });
  await tick(20);
  root.hub.A.enterSource('cloudstream|Akwam');
  expect(opened).toHaveBeenCalledTimes(1);
  const record = opened.mock.calls[0][0];
  expect(record).toMatchObject({ pkg: 'Akwam', kind: 'anime', content: 'cinema', _url: 'https://example.org/repo.json' });
  expect(record._store.family).toBe('cloudstream');
  root.close();
});

it('حزمة CloudStream تالفة (unreadable) تظهر بسببها وتُحذف، لا تختفي', async () => {
  setup();
  const cs = {
    list: async () => ({ repos: [], installed: [], unreadable: [{ pkg: 'Broken', error: 'PACKAGE_METADATA_UNREADABLE' }] }),
    add: async () => ({}), remove: async () => ({}), extensions: async () => [], install: async () => {}, enable: async () => {},
    uninstall: vi.fn(async () => ({ ok: true })),
  };
  const root = mount({ cloudstreamRepositories: cs, initialState: { stack: [{ v: 'hub' }, { v: 'cloudstream' }] } });
  await tick(20);
  const it0 = root.hub.S.items.cloudstream.find((x) => x.id === 'Broken');
  expect(it0.bad).toContain('تعذّرت قراءة الحزمة');
  await root.hub.A.del('cloudstream|Broken');
  expect(cs.uninstall).toHaveBeenCalledWith('Broken');
  root.close();
});

it('الترتيب: Stremio يُحفظ في السجل نفسه، والبقية على الجهاز وتعود بعد إعادة الفتح', async () => {
  const { store } = setup();
  const rows = ['a', 'b', 'c'].map((k) => ({ key: k, name: k.toUpperCase(), version: '1', capabilities: ['streams'], contentTypes: ['movie'], enabled: true }));
  const registry = { list: () => rows.map((r) => ({ ...r })), order: vi.fn(async () => {}), pin: async () => {}, enable: async () => {} };
  let root = mount({ registry, initialState: { stack: [{ v: 'hub' }, { v: 'stremio' }] } });
  await tick();
  expect(root.querySelectorAll('[data-y="grip"]').length).toBe(3);
  root.hub.A.moveDown('stremio|a');
  await tick();
  expect(registry.order).toHaveBeenCalledWith(['b', 'a', 'c']);
  root.close();
  // سجل بلا ترتيب (إصدار قديم): لا مقبض ولا أزرار ترتيب وهمية
  root = mount({ registry: { list: registry.list }, initialState: { stack: [{ v: 'hub' }, { v: 'stremio' }] } });
  await tick();
  expect(root.querySelector('[data-y="grip"]')).toBeNull();
  root.close();
  const api = manga({ installed: [{ pkg: 'p1', name: 'One', version: '1', repo: REPO }, { pkg: 'p2', name: 'Two', version: '1', repo: REPO }] });
  root = mount({ repositories: api, initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }] } });
  await tick();
  root.hub.A.toTop('mihon|p2');
  expect(root.hub.S.items.mihon.map((x) => x.id).slice(0, 2)).toEqual(['p2', 'p1']);
  root.close();
  root = mount({ repositories: api, initialState: { stack: [{ v: 'hub' }, { v: 'mihon' }] } });
  await tick();
  expect(root.hub.S.items.mihon.map((x) => x.id).slice(0, 2)).toEqual(['p2', 'p1']);
  expect([...store.keys()].some((k) => k.startsWith('vantara.addons.hub.v1'))).toBe(true);
  root.close();
});

it('المعطّلة بعد الرجوع من التفاصيل: مبلورة ومعها المفتاح من أول إطار (لا إخفاء مؤجل)', async () => {
  setup();
  const cs = { list: async () => ({ repos: [], installed: [{ pkg: 'Akwam', name: 'Akwam', version: '3', enabled: true }] }), add: async () => ({}), remove: async () => ({}), extensions: async () => [], install: async () => {}, uninstall: async () => {}, enable: vi.fn(async () => {}) };
  const root = mount({ cloudstreamRepositories: cs, initialState: { stack: [{ v: 'hub' }, { v: 'cloudstream' }, { v: 'details', p: 'cloudstream', id: 'Akwam' }] } });
  await tick();
  await root.hub.A.toggle('cloudstream|Akwam');
  root.back();
  const row = root.querySelector('[data-k="cloudstream-Akwam"]');
  expect(row.classList.contains('is-off')).toBe(true);
  expect(row.querySelector(':scope>.y-sw')).toBeTruthy();
  root.close();
});
