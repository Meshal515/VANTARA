// جولة لقطات كاملة لتطبيق ويندوز (desktop-harness: مدخل full-boot.js وبيانات حقيقية):
// كل رئيسية (مانجا/أنمي/سينما، و«المحتوى الموحد»)، كل بند في الشريط الجانبي، تبويبات كل صفحة،
// صفحات الإعدادات الفرعية، والملف الشخصي — الصفحة كاملة من أعلى لأسفل (الأوراق تُخاط من لقطات تمريرها).
// لكل لقطة قياس: لف أفقي، فيض أفقي، صور مقصوصة، أكبر فراغ عمودي، عرض المحتوى.
// الاستعمال: node tour.cjs pc1366|pc1366-rail|pc1920|pc1920-rail [independent|content|all]
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const VIEWS = {
  pc1366: { screen: { width: 1366, height: 768 }, rail: false }, 'pc1366-rail': { screen: { width: 1366, height: 768 }, rail: true },
  pc1920: { screen: { width: 1920, height: 1080 }, rail: false }, 'pc1920-rail': { screen: { width: 1920, height: 1080 }, rail: true },
  pc2560: { screen: { width: 2560, height: 1440 }, rail: false }, 'pc2560-rail': { screen: { width: 2560, height: 1440 }, rail: true },
};
const [viewId, modeArg = 'all'] = process.argv.slice(2);
const view = VIEWS[viewId]; if (!view) throw new Error('مقاس غير معروف');
const out = path.resolve(`shots/tour/${viewId}`); fs.mkdirSync(out, { recursive: true });
const SHARED = /الأصدقاء|المجلس|الإشعارات|الإضافات|الإعدادات/;
const SKIP = /تبديل الحساب|^الرئيسية$/;
const report = { view: viewId, pages: [] };
const errors = [];

const measure = () => {
  const vis = (e) => e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true });
  const overlay = [...document.querySelectorAll('.sheet, .modal, [role=dialog], .uv-page')].filter(vis).at(-1);
  const root = overlay ?? document.querySelector('.page.active') ?? document.querySelector('#root .v35');
  const rr = root.getBoundingClientRect();
  const rows = [], crops = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150)
      rows.push(`${(el.closest('section')?.querySelector('h2,h3')?.textContent ?? String(el.className)).trim().slice(0, 28)} (${el.children.length}: ${el.clientWidth}→${el.scrollWidth})`);
    if (el.tagName === 'IMG' && el.naturalWidth && r.width > 110 && r.height > 80 && cs.objectFit === 'cover') {
      const ir = el.naturalWidth / el.naturalHeight, fr = r.width / r.height, k = Math.min(fr / ir, ir / fr);
      if (k < 0.8) crops.push(`${String(el.className || el.parentElement.className).slice(0, 26)} ${Math.round(r.width)}x${Math.round(r.height)} ${Math.round(k * 100)}%`);
    }
  }
  const marks = [...root.querySelectorAll('img, h1, h2, h3, p, button, li, a, input, label')].filter(vis).map((e) => e.getBoundingClientRect()).filter((r) => r.height > 6 && r.width > 6).map((r) => [r.top + scrollY, r.bottom + scrollY, r.left, r.right]).sort((a, b) => a[0] - b[0]);
  let gap = 0, bottom = marks[0]?.[1] ?? 0;
  for (const m of marks) { if (m[0] - bottom > gap) gap = m[0] - bottom; bottom = Math.max(bottom, m[1]); }
  const left = Math.min(...marks.map((m) => m[2])), right = Math.max(...marks.map((m) => m[3]));
  return {
    overlay: overlay ? String(overlay.className).split(' ')[0] : null,
    heading: (root.querySelector('h1, h2')?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
    rows, crops: crops.slice(0, 6), maxGap: Math.round(gap), contentPct: isFinite(left) ? Math.round((right - left) / rr.width * 100) : null,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1, empty: marks.length < 3,
  };
};

(async () => {
  const browser = await chromium.launch();
  const modes = modeArg === 'all' ? ['independent', 'content'] : [modeArg];
  for (const mode of modes) {
    const { ctx, page } = await openDesktop({ browser, screen: view.screen, storage: {
      'vantara.session.v1': { token: 'fixture-token', user: { userId: 'fixture-user', name: 'تجربة' }, savedAt: Date.now() },
      'vantara.experience.v1': { unifyContent: mode === 'content' },
      ...(view.rail ? { 'vantara.rail.collapsed': '1' } : {}),
    } });
    page.on('pageerror', (e) => errors.push(`${mode}: ${e.message.slice(0, 160)}`));
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    const settle = async (ms = 2500) => {
      await page.waitForTimeout(ms);
      // تمرير الصفحة كاملة كي تُحمّل الصور الكسولة ثم الرجوع للأعلى
      await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < Math.min(s.scrollHeight, 14000); y += 600) { s.scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)); } s.scrollTo(0, 0); });
      await page.waitForTimeout(900);
    };
    const shot = async (name) => {
      const file = path.join(out, `${name.replace(/[\\/:*?"<>| ]+/g, '_')}.png`);
      // ورقة لها تمرير داخلي: نخيط لقطات تمريرها؛ وإلا الصفحة كاملة
      const box = await page.evaluate(() => {
        const vis = (e) => e.checkVisibility?.();
        const overlay = [...document.querySelectorAll('.sheet, .modal, [role=dialog], .uv-page')].filter(vis).at(-1);
        if (!overlay) return null;
        const sc = [overlay, ...overlay.querySelectorAll('*')].filter((e) => vis(e) && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 20).sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (!sc) return { none: true };
        sc.setAttribute('data-tour-scroller', ''); sc.scrollTop = 0;
        const r = sc.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, total: sc.scrollHeight };
      });
      if (!box || box.none) {
        // الشريط الجانبي ممدود بطول الصفحة في لقطة الصفحة الكاملة (وإلا يبقى بارتفاع أول شاشة)
        if (!box) await page.evaluate(() => { const H = document.documentElement.scrollHeight; for (const el of document.querySelectorAll('.drawer-backdrop, .drawer')) if (el.getBoundingClientRect().height >= innerHeight - 2) { el.style.setProperty('height', `${H}px`, 'important'); el.style.setProperty('max-height', 'none', 'important'); } });
        await page.screenshot({ path: file, fullPage: !box });
        await page.evaluate(() => { for (const el of document.querySelectorAll('.drawer-backdrop, .drawer')) { el.style.removeProperty('height'); el.style.removeProperty('max-height'); } });
        return file;
      }
      const frames = [], deltas = []; let prev = 0;
      const first = `${file}.f0.png`; await page.screenshot({ path: first }); frames.push(first);
      for (let i = 1; i < 30; i++) {
        const now = await page.evaluate((h) => { const s = document.querySelector('[data-tour-scroller]'); s.scrollTop += Math.floor(h * 0.9); return s.scrollTop; }, box.h);
        if (now <= prev) break;
        await page.waitForTimeout(350);
        const f = `${file}.f${i}.png`;
        await page.screenshot({ path: f, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
        frames.push(f); deltas.push(now - prev); prev = now;
      }
      await page.evaluate(() => { const s = document.querySelector('[data-tour-scroller]'); if (s) { s.scrollTop = 0; s.removeAttribute('data-tour-scroller'); } });
      const dpr = await page.evaluate(() => devicePixelRatio);
      execFileSync('python3', ['-I', path.join(__dirname, 'stitch.py'), file, JSON.stringify({ box, deltas, dpr }), ...frames]);
      for (const f of frames) fs.unlinkSync(f);
      return file;
    };
    const record = async (name, extra = {}) => {
      const m = await page.evaluate(measure);
      await shot(name);
      report.pages.push({ name, mode, ...extra, ...m });
      const bad = [m.rows.length && `لف ${m.rows.join('،')}`, m.crops.length && `قص ${m.crops.join('،')}`, m.overflowX && 'فيض أفقي', m.maxGap > 280 && `فراغ ${m.maxGap}`, m.empty && 'فارغة'].filter(Boolean);
      console.log(`${bad.length ? 'تنبيه' : 'سليم '} ${name}${m.overlay ? ` [${m.overlay}]` : ''} | محتوى ${m.contentPct}%${bad.length ? ' | ' + bad.join(' | ') : ''}`);
    };
    const clickDrawer = (re) => page.evaluate((src) => { const b = [...document.querySelectorAll('.drawer .drawer-item, .drawer .drawer-section, .drawer .drawer-me')].find((x) => x.checkVisibility() && new RegExp(src).test(x.textContent.trim().replace(/\s+/g, ' '))); b?.click(); return !!b; }, re.source ?? re);
    const close = async () => { for (let i = 0; i < 3; i++) { const open = await page.evaluate(() => [...document.querySelectorAll('.sheet, .modal, [role=dialog], .uv-page')].some((e) => e.checkVisibility())); if (!open) break; await page.keyboard.press('Escape'); await page.waitForTimeout(450); } };
    const tabsOf = () => page.evaluate(() => [...document.querySelectorAll('.page.active [role=tab], .page.active [class*=tabs] > button, .page.active [class*=seg] > button, .sheet [role=tab]')].filter((b) => b.checkVisibility() && b.getAttribute('aria-selected') !== 'true' && !b.classList.contains('on') && !b.classList.contains('active')).map((b) => b.textContent.trim().replace(/\s+/g, ' ')).filter((t) => t && t.length < 24).slice(0, 8));
    const clickTab = (t) => page.evaluate((t) => [...document.querySelectorAll('.page.active [role=tab], .page.active [class*=tabs] > button, .page.active [class*=seg] > button, .sheet [role=tab]')].find((b) => b.checkVisibility() && b.textContent.trim().replace(/\s+/g, ' ') === t)?.click(), t);
    const items = () => page.evaluate((skip) => [...document.querySelectorAll('.drawer .drawer-item')].filter((b) => b.checkVisibility()).map((b) => b.textContent.trim().replace(/\s+/g, ' ')).filter((t) => t && !new RegExp(skip).test(t)), SKIP.source);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const visit = async (label, item) => {
      await close();
      await clickDrawer(`^${esc(item)}$`); await settle();
      await record(`${label}-${item}`);
      for (const tab of await tabsOf()) { await clickTab(tab); await settle(1600); await record(`${label}-${item}-${tab}`); }
    };

    const sections = mode === 'content' ? ['content'] : ['manga', 'anime', 'cinema'];
    let sharedDone = false;
    for (const sec of sections) {
      await close();
      if (sec !== 'content') await clickDrawer(`^${sec.toUpperCase()}`);
      await clickDrawer('^الرئيسية$');
      await settle(sec === 'manga' ? 9000 : 5000);
      const label = mode === 'content' ? 'content' : sec;
      await record(`${label}-home`);
      // من الرئيسية: «عرض الكل» لأول صف، وأول بلاطة تصنيف، ثم البحث
      for (const [kind, sel, re] of [['see-all', '.page.active button, .page.active a', /^(عرض الكل|الكل|المزيد)/], ['genre', '.page.active [class*=genre] button, .page.active button[class*=genre], .page.active [class*=tile]', /./]]) {
        const ok = await page.evaluate(([sel, src]) => { const b = [...document.querySelectorAll(sel)].find((x) => x.checkVisibility() && new RegExp(src).test(x.textContent.trim())); b?.click(); return b ? b.textContent.trim().slice(0, 20) : null; }, [sel, re.source]);
        if (ok) { await settle(); await record(`${label}-home-${kind}`, { from: ok }); }
        await close(); await clickDrawer('^الرئيسية$'); await page.waitForTimeout(1500);
      }
      if (await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find((x) => x.checkVisibility() && /بحث/.test(x.getAttribute('aria-label') ?? x.title ?? '')); b?.click(); return !!b; })) {
        await page.keyboard.type(sec === 'anime' ? 'frieren' : sec === 'cinema' ? 'dune' : 'solo', { delay: 30 }); await settle(4000); await record(`${label}-search`);
        await close(); await clickDrawer('^الرئيسية$'); await page.waitForTimeout(1500);
      }
      for (const item of await items()) {
        if (SHARED.test(item) && (sharedDone || mode === 'content')) continue;
        await visit(mode === 'content' ? 'content' : sec, item);
      }
      if (mode !== 'content') sharedDone = true;
    }
    if (mode === 'independent') {
      // الملف الشخصي وصفحات الإعدادات الفرعية (مستوى واحد) وتبويباتها
      await close(); await clickDrawer('حسابي'); await settle(); await record('profile');
      await close(); await clickDrawer('^الإعدادات$'); await settle(1500);
      const rows = await page.evaluate(() => [...document.querySelectorAll('.page.active .setting, .page.active .settings-feature, .page.active .settings-me')].filter((b) => b.checkVisibility()).map((b) => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 18)));
      for (const row of rows) {
        await close(); await clickDrawer('^الإعدادات$'); await page.waitForTimeout(1200);
        await page.evaluate((t) => [...document.querySelectorAll('.page.active .setting, .page.active .settings-feature, .page.active .settings-me')].find((b) => b.checkVisibility() && b.textContent.trim().replace(/\s+/g, ' ').startsWith(t))?.click(), row);
        await settle(1800);
        await record(`settings-${row.replace(/\s+/g, '_')}`);
        for (const tab of await tabsOf()) { await clickTab(tab); await settle(1400); await record(`settings-${row.replace(/\s+/g, '_')}-${tab}`); }
      }
    }
    await ctx.close();
  }
  report.errors = errors;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`أخطاء الصفحة: ${errors.length}`); for (const e of errors.slice(0, 10)) console.log('  ', e);
  await browser.close();
})();
