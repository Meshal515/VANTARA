// محاذاة Glass (الخطة 13): كل كبسولة أو عدسة فيها نص، هل النص بعيد عن حافتها؟ وهل هي داخلة في نص بجانبها في المكان نفسه؟
// وهل عدسة الألسنة في وسط كلمتها أفقيًا وعموديًا؟ الأنماط الخمسة عشر والموحد والصفحات الرئيسية. صفر مشاكل = سليم.
// node tools/ui-qa/glass-align.mjs [phone|w1366]
import { launch, sleep } from './rig.mjs';
const { MANGA_WORK_STYLES, WORK_STYLES, CINEMA_WORK_STYLES } = await import('../../apps/web/v35/appearance.js');
const size = process.argv[2] || 'phone'; const VIEW = { phone: [390, 844], w1366: [1366, 768] }[size];
const probe = () => {
  const out = []; const R = (r) => [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)).join(',');
  const textRects = (root) => { const rs = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) { if (!n.textContent.trim()) continue; const p = n.parentElement; if (!p || !p.getClientRects().length || getComputedStyle(p).visibility === 'hidden' || +getComputedStyle(p).opacity < 0.05) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width > 1) rs.push({ r, el: p }); } return rs; };
  const floating = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n; } return null; };
  const faded = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (+c.opacity < 0.05 || c.visibility === 'hidden') return true; } return false; };
  const inView = (r) => r.width > 6 && r.height > 6 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const label = (el) => (typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName) + ' «' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16) + '»';
  const glassy = [...document.querySelectorAll('body *')].filter((el) => { if (el.closest('[inert],[aria-hidden=true],.dock,.g-glyphs')) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; const bf = cs.backdropFilter; return bf && bf !== 'none' && /url\(/.test(bf) && !el.matches('.g-seg'); });
  const all = textRects(document.body);
  for (const el of glassy) {
    const b = el.getBoundingClientRect(); if (!inView(b) || b.height > 90) continue;
    const inner = textRects(el); const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    for (const { r } of inner) { const l = r.left - b.left, rt = b.right - r.right; const minPad = radius >= b.height / 2 - 1 ? 8 : 4; if (Math.min(l, rt) < minPad) out.push(`EDGE ${label(el)} pad=${Math.round(Math.min(l, rt))} box=${R(b)}`); }
    for (const { r, el: t } of all) { if (el.contains(t) || t.contains(el) || faded(t) || floating(el) !== floating(t)) continue; const ix = Math.min(b.right, r.right) - Math.max(b.left, r.left), iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top); if (ix > 1 && iy > 2) { out.push(`OVERLAP ${label(el)} × ${label(t)} box=${R(b)} text=${R(r)}`); break; } }
  }
  for (const s of document.querySelectorAll('.g-seg')) {
    if ('off' in s.dataset) continue; const b = s.getBoundingClientRect(); if (!inView(b)) continue;
    const box = s.parentElement; const act = [...box.children].find((c) => c !== s && c.matches('.active, .on, .is-on, [aria-selected="true"], [aria-checked="true"], [aria-pressed="true"]')); if (!act) continue;
    const tr = textRects(act).filter((x) => !faded(x.el)).map((x) => x.r); if (!tr.length) continue;
    const l = Math.min(...tr.map((r) => r.left)), rr = Math.max(...tr.map((r) => r.right)), t = Math.min(...tr.map((r) => r.top)), bt = Math.max(...tr.map((r) => r.bottom));
    const padL = l - b.left, padR = b.right - rr, dy = ((t + bt) / 2) - ((b.top + b.bottom) / 2);
    const fill = box.matches('.social-tabs,.mw-ranges,.drawer-sections'); const scrolls = getComputedStyle(box).overflowX !== 'visible'; const edge = Math.min(b.left, innerWidth - b.right);
    if (!fill && edge < 10 && !(scrolls && (b.left < 0 || b.right > innerWidth))) out.push(`SCREEN ${label(box)} on «${act.textContent.trim().slice(0, 12)}» edge=${edge.toFixed(1)}`);
    if ((!fill && Math.min(padL, padR) < 6) || Math.abs(padL - padR) > 4 || Math.abs(dy) > 2.5) out.push(`LENS ${label(box)} on «${act.textContent.trim().slice(0, 12)}» padL=${padL.toFixed(1)} padR=${padR.toFixed(1)} dy=${dy.toFixed(1)}`);
  }
  return out;
};
const res = new Map();
const run = async (opts, setup, tag) => {
  const h = await launch({ viewport: { width: VIEW[0], height: VIEW[1] }, mobile: size === 'phone', net: 'fixture', ...opts, appearance: { material: 'glass', ...(opts.appearance ?? {}) } });
  try { await sleep(1600); if (setup) await setup(h.page); await sleep(1300); for (const y of [0, 520, 1200]) { await h.page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await sleep(500); for (const line of await h.page.evaluate(probe)) { const k = `${tag} | ${line.replace(/box=.*|text=.*/, '')}`; if (!res.has(k)) res.set(k, line); } } } catch (e) { console.log('SKIP', tag, String(e).slice(0, 90)); } finally { await h.close(); }
};
const sp = (pg) => (p) => p.evaluate((pg) => window.__shell.showPage(pg), pg);
const LOOKS = { manga: MANGA_WORK_STYLES, anime: WORK_STYLES, series: CINEMA_WORK_STYLES, movie: CINEMA_WORK_STYLES };
const SEC = { manga: 'manga', anime: 'anime', series: 'cinema', movie: 'cinema' };
for (const kind of ['manga', 'anime', 'series', 'movie']) for (const s of LOOKS[kind]) await run({ section: SEC[kind], appearance: { style: { [SEC[kind]]: s.id } } }, (p) => p.evaluate((k) => window.__open(k), kind), `work-${kind}-${s.id}`);
for (const kind of ['manga', 'anime', 'series']) await run({ section: SEC[kind], appearance: { unifiedLook: true } }, (p) => p.evaluate((k) => window.__open(k), kind), `work-${kind}-unified`);
for (const section of ['manga', 'anime', 'cinema']) for (const pg of ['home', 'discover', 'search', 'library', 'profile', 'majlis', 'insights']) await run({ section }, pg === 'home' ? null : sp(pg), `${section}-${pg}`);
for (const pg of ['home', 'library', 'discover', 'search']) await run({ section: 'anime', unified: true }, pg === 'home' ? null : sp(pg), `unified-${pg}`);
await run({ section: 'anime' }, async (p) => { await p.evaluate(() => window.__shell.showPage('majlis')); await new Promise((r) => setTimeout(r, 600)); await p.evaluate(() => document.querySelectorAll('.social-tab')[2]?.click()); }, 'social-recs');
await run({ section: 'anime' }, async (p) => { await p.evaluate(() => window.__shell.showPage('majlis')); await new Promise((r) => setTimeout(r, 600)); await p.evaluate(() => window.__shell.openMajlis()); }, 'majlis-room');
console.log(size, 'issues', res.size);
for (const v of [...res.keys()].sort()) console.log(res.get(v).startsWith('LENS') || res.get(v).startsWith('EDGE') || res.get(v).startsWith('OVERLAP') ? v.split(' | ')[0].padEnd(26) + ' ' + res.get(v) : v);
