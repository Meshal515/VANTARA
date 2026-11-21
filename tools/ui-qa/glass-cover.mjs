// تغطية Glass (الخطة 13): كل زر واجهة ظاهر في صفحات التطبيق، هل عليه زجاج انكسار أم ضباب فقط أم لا شيء.
// node tools/ui-qa/glass-cover.mjs [phone|w1366]
// تغطية Glass: كل زر «واجهة» ظاهر (داخل عنصر ثابت/لاصق أو ترويسة أو شريط) هل عليه أو على حاويته القريبة زجاج؟ وهل هو انكسار (url) أم ضباب فقط؟
import { launch, sleep } from './rig.mjs';
const size = process.argv[2] || 'phone';
const VIEW = { phone: [390, 844], w1366: [1366, 768] }[size];
const probe = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  const chrome = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; if (n.matches?.('header, .header, [role=tablist], .segmented, .cn-kinds, .page-top')) return true; } return false; };
  const glassOf = (el) => { const box = el.closest('.social-tabs,.library-tabs,.cn-kinds,.mw-tabs,.uv-tabs,.sx-tabs,.ins-tabs,.us-seg,.ul-shelves,.mw-ranges,.drawer-sections'); if (box) { const s = box.querySelector(':scope > .g-seg'); if (s && !('off' in s.dataset)) return /url\(/.test(getComputedStyle(s).backdropFilter) ? 'refract' : 'blur'; } for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { for (const pe of [null, '::before']) { const bf = getComputedStyle(n, pe).backdropFilter; if (bf && bf !== 'none' && !/blur\(0px\)/.test(bf)) return /url\(/.test(bf) ? 'refract' : 'blur'; } } const lens = el.closest('.dock') ? 'dock' : null; return lens || 'none'; };
  const cls = (n) => (typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : n.tagName.toLowerCase());
  const host = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(n).position) || n.matches('header,.header,[role=tablist],.segmented,.cn-kinds')) return cls(n); return '?'; };
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab]')) {
    if (!vis(el) || el.closest('[inert],[aria-hidden=true],.sheet-backdrop:not(.show),.drawer-backdrop:not(.open)') || !chrome(el)) continue;
    out.push({ host: host(el), btn: cls(el), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 14), g: glassOf(el) });
  }
  return out;
};
const rows = [];
const run = async (section, setup, tag) => {
  const h = await launch({ section, viewport: { width: VIEW[0], height: VIEW[1] }, mobile: size === 'phone', net: 'fixture', appearance: { material: 'glass' } });
  try { await sleep(1700); if (setup) await setup(h.page); await sleep(900); for (const y of [0, 600]) { await h.page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await sleep(450); for (const r of await h.page.evaluate(probe)) rows.push({ page: tag, ...r }); } } finally { await h.close(); }
};
for (const s of ['manga', 'anime', 'cinema']) await run(s, null, `home-${s}`);
for (const k of ['manga', 'anime', 'series']) await run(k === 'series' ? 'cinema' : k, (p) => p.evaluate((k) => window.__open(k), k), `work-${k}`);
for (const pg of ['discover', 'library', 'majlis', 'settings', 'notifications', 'profile', 'downloads', 'search']) await run('anime', (p) => p.evaluate((pg) => window.__shell.showPage(pg), pg), pg);
const key = (r) => `${r.page} | ${r.host} > ${r.btn}`;
const groups = new Map();
for (const r of rows) { const k = key(r); const g = groups.get(k) ?? { n: 0, g: new Set(), labels: new Set() }; g.n++; g.g.add(r.g); g.labels.add(r.label); groups.set(k, g); }
const tot = { refract: 0, blur: 0, dock: 0, none: 0 };
for (const r of rows) tot[r.g]++;
console.log(size, 'TOTAL chrome buttons:', rows.length, JSON.stringify(tot));
for (const [k, g] of [...groups].sort()) if (g.g.has('none') || g.g.has('blur')) console.log(([...g.g].join('/')).padEnd(14), k.slice(0, 60).padEnd(60), [...g.labels].slice(0, 4).join('، '));
