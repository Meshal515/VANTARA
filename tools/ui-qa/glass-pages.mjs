// تغطية Glass لصفحات حددها المالك (الخطة 13): الرئيسية واكتشف والبحث ونتائجه والفلترة والمكتبة والملف في الأقسام الثلاثة،
// والأصدقاء والإشعارات والتوصيات، وغرفة المجلس (الشات) بألسنتها. تحفظ لقطة لكل صفحة.
// node tools/ui-qa/glass-pages.mjs [phone|w1366] <مجلد اللقطات>   (ONLY=social للاجتماع وحده)
// تغطية Glass: كل زر «واجهة» ظاهر (داخل عنصر ثابت/لاصق أو ترويسة أو شريط) هل عليه أو على حاويته القريبة زجاج؟ وهل هو انكسار (url) أم ضباب فقط؟
import { launch, sleep } from './rig.mjs';
const size = process.argv[2] || 'phone';
const VIEW = { phone: [390, 844], w1366: [1366, 768] }[size];
const probe = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  const chrome = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; if (n.matches?.('header, .header, [role=tablist], .segmented, .cn-kinds, .page-top')) return true; } return false; };
  const glassOf = (el) => { const box = el.closest('.social-tabs,.library-tabs,.mj-filters,.cn-kinds,.mw-tabs,.uv-tabs,.sx-tabs,.ins-tabs,.us-seg,.ul-shelves,.mw-ranges,.drawer-sections'); if (box) { const s = box.querySelector(':scope > .g-seg'); if (s && !('off' in s.dataset)) return /url\(/.test(getComputedStyle(s).backdropFilter) ? 'refract' : 'blur'; } for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { for (const pe of [null, '::before']) { const bf = getComputedStyle(n, pe).backdropFilter; if (bf && bf !== 'none' && !/blur\(0px\)/.test(bf)) return /url\(/.test(bf) ? 'refract' : 'blur'; } } const lens = el.closest('.dock') ? 'dock' : null; return lens || 'none'; };
  const cls = (n) => (typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : n.tagName.toLowerCase());
  const host = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(n).position) || n.matches('header,.header,[role=tablist],.segmented,.cn-kinds')) return cls(n); return '?'; };
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab]')) {
    if (!vis(el) || el.closest('.mc-list,.mc-mlist') || el.closest('[inert],[aria-hidden=true],.sheet-backdrop:not(.show),.drawer-backdrop:not(.open)') || !chrome(el)) continue;
    out.push({ host: host(el), btn: cls(el), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 14), g: glassOf(el) });
  }
  return out;
};

const rows = []; const OUT = process.argv[3];
const run = async (opts, setup, tag) => {
  const h = await launch({ viewport: { width: VIEW[0], height: VIEW[1] }, mobile: size === 'phone', net: 'fixture', ...opts, appearance: { material: 'glass', accent: { manga: 'manga', anime: 'cinema', cinema: 'rust' }, ...(opts.appearance ?? {}) } });
  try { await sleep(1700); if (setup) await setup(h.page); await sleep(1100);
    await h.page.screenshot({ path: `${OUT}/${size}-${tag}.png` });
    for (const y of [0, 600]) { if (y) { await h.page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await sleep(450); } for (const r of await h.page.evaluate(probe)) rows.push({ page: tag, ...r }); }
    if (h.log.errors.length) console.log('ERR', tag, h.log.errors.slice(0, 1));
  } catch (e) { console.log('SKIP', tag, String(e).slice(0, 120)); } finally { await h.close(); }
};
const sp = (p, pg) => p.evaluate((pg) => window.__shell.showPage(pg), pg);
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const typeSearch = async (p) => { await sp(p, 'search'); await w(700); await p.evaluate(() => { const i = document.querySelector('#search input, input[type=search]'); if (i) { i.focus(); i.value = 'Fixture'; i.dispatchEvent(new Event('input', { bubbles: true })); } }); await w(900); };
const clickFilter = async (p) => { await w(500); const ok = await p.evaluate(() => { const b = [...document.querySelectorAll('.an-filter-btn, .cn-filter-btn, [aria-label="الفلاتر"], [aria-label="تصفية متقدمة"]')].find((b) => b.getClientRects().length); b?.click(); return !!b; }); if (!ok) console.log('no filter button'); await w(900); };
if (process.env.ONLY !== 'social') {
for (const section of ['manga', 'anime', 'cinema']) {
  await run({ section }, null, `${section}-home`);
  await run({ section }, (p) => sp(p, 'discover'), `${section}-discover`);
  await run({ section }, async (p) => { await sp(p, 'discover'); await clickFilter(p); }, `${section}-discover-filter`);
  await run({ section }, (p) => sp(p, 'search'), `${section}-search`);
  await run({ section }, typeSearch, `${section}-search-results`);
  await run({ section }, async (p) => { await typeSearch(p); await clickFilter(p); }, `${section}-search-filter`);
  await run({ section }, (p) => sp(p, 'library'), `${section}-library`);
  await run({ section }, (p) => sp(p, 'profile'), `${section}-profile`);
}
}
for (const tab of ['friends', 'notifications', 'recs']) await run({ section: 'anime' }, (p) => p.evaluate((t) => { window.__shell.showPage('majlis'); document.querySelectorAll('.social-tab')[['friends', 'notifications', 'recs'].indexOf(t)]?.click(); }, tab), `social-${tab}`);
await run({ section: 'anime' }, async (p) => { await sp(p, 'majlis'); await w(600); await p.evaluate(() => window.__shell.openMajlis()); }, 'majlis-room');
for (const i of [1, 2, 3]) await run({ section: 'anime' }, async (p) => { await sp(p, 'majlis'); await w(600); await p.evaluate(() => window.__shell.openMajlis()); await w(900); await p.evaluate((i) => document.querySelectorAll('.sx-tabs .sx-tab')[i]?.click(), i); }, `majlis-room-tab${i}`);
const groups = new Map(); const tot = { refract: 0, blur: 0, dock: 0, none: 0 };
for (const r of rows) { tot[r.g]++; const k = `${r.page} | ${r.host} > ${r.btn}`; const g = groups.get(k) ?? { g: new Set(), labels: new Set() }; g.g.add(r.g); g.labels.add(r.label); groups.set(k, g); }
const pages = {}; for (const r of rows) { pages[r.page] ??= { all: 0, glass: 0 }; pages[r.page].all++; if (r.g !== 'none') pages[r.page].glass++; }
console.log(size, 'TOTAL', rows.length, JSON.stringify(tot));
for (const [p, v] of Object.entries(pages)) console.log('PAGE', p.padEnd(28), `${v.glass}/${v.all}`);
for (const [k, g] of [...groups].sort()) if (g.g.has('none') || g.g.has('blur')) console.log(([...g.g].join('/')).padEnd(14), k.slice(0, 70).padEnd(70), [...g.labels].slice(0, 4).join('، '));
