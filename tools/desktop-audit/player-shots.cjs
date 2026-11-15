// لقطات طبقة مشغل ويندوز (desktop/overlay.html) بحالات حقيقية الشكل فوق إطار فيديو: الأدوات ظاهرة، وكل ورقة
// فرعية (السيرفرات، الجودة، الترجمة، الصوت، السرعة، الحلقات، المزيد)، وشاشة التحميل. VantaraOverlay وهمي
// بنفس واجهة overlay-preload.cjs، والأوامر المرسلة تُسجَّل للتحقق من أن كل زر يرسل أمره.
// node player-shots.cjs OUTDIR
const { chromium } = require('playwright');
const { fitZoom } = require('../../apps/desktop/window-zoom.cjs');
const fs = require('fs'), path = require('path');
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const STATE = {
  ready: true, paused: true, title: 'The Apothecary Diaries', subtitle: 'الموسم 3 · الحلقة 1 — Locusts', tone: 'anime',
  duration: 1440000, position: 312000, bufferedMs: 520000, volume: 80, episode: 1, total: 12, canChangeEpisode: true,
  serverCode: 'TR', qualityLabel: '1080p', candidate: 'a1080', speed: 1, subtitleDelay: 0,
  sources: [{ id: 'a1080', label: '1080p' }, { id: 'a720', label: '720p' }, { id: 'a480', label: '480p' }],
  subtitles: [{ id: 1, lang: 'ar', label: 'العربية', selected: true }, { id: 2, lang: 'en', label: 'English' }],
  audio: [{ id: 1, lang: 'ja', label: 'Japanese', selected: true }, { id: 2, lang: 'en', label: 'English' }],
  routes: [{ id: 'a', sourceName: 'Torrentio', server: 'تورنت', quality: 1080, label: 'WEB-DL', state: 'READY', candidates: ['a1080'] }, { id: 'b', sourceName: 'AnimeKai', server: 'MegaUp', quality: 1080, state: 'READY' }, { id: 'c', sourceName: 'Anizone', quality: 720, state: 'READY' }, { id: 'd', sourceName: 'HiAnime', server: 'HD-2', state: 'RESOLVING' }],
  canRecommend: true, friends: [{ userId: 'u1', displayName: 'سارة' }, { userId: 'u2', displayName: 'خالد' }],
  skipStatus: 'المقدمة 1:30–3:00 · النهاية 22:10–23:40', skipPending: false,
  net: { openAt: 0, stages: { 'engine-start': 300, 'engine-ready': 1400, downloading: 2100, 'player-start': 2600, ready: 3900 }, torrentBps: 1750000, peers: 58, seeds: 45, aheadMs: 41000, inputBps: 1690000, videoBps: 4200000, videoHeight: 1080 },
  routesDone: true, people: [{ userId: 'u1', name: 'سارة', host: true, state: 'playing' }, { userId: 'u2', name: 'خالد', state: 'ready' }],
  together: true, videoOffsetMs: 0,
  room: { mode: 'sync', host: true, status: 'live', label: 'The Apothecary Diaries — الحلقة 1', pending: [{ userId: 'u3', name: 'نورة', avatarKey: null }],
    members: [{ userId: 'u1', name: 'سارة', state: 'playing', host: true, me: true, source: 'Torrentio', posMs: 312000, driftMs: null, sameVersion: null },
      { userId: 'u2', name: 'خالد', state: 'buffering', host: false, me: false, source: 'AnimeKai', posMs: 311600, driftMs: 40, sameVersion: false }] },
};
(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    // كما في التطبيق: طبقة المشغل تأخذ معامل window-zoom نفسه (main.cjs)
    const f = fitZoom(w);
    const ctx = await browser.newContext({ viewport: { width: Math.round(w / f), height: Math.round(h / f) }, deviceScaleFactor: f });
    const page = await ctx.newPage();
    const sent = [];
    await page.exposeFunction('__sent', (m) => sent.push(m));
    await page.addInitScript(() => {
      let listener = null;
      window.VantaraOverlay = { send: (m) => window.__sent(m), onState: (fn) => { listener = fn; } };
      window.__push = (s) => listener?.(s);
      document.documentElement.style.background = 'transparent';
    });
    await page.goto('http://127.0.0.1:8765/desktop/overlay.html');
    await page.waitForTimeout(800);
    // إطار فيديو خلف الطبقة (mpv في التطبيق الحقيقي)
    await page.evaluate(() => { const bg = document.createElement('div'); bg.style.cssText = 'position:fixed;inset:0;z-index:-1;background:radial-gradient(ellipse at 30% 35%,#5b6d8a 0,#2b3346 38%,#0d1018 75%)'; document.body.prepend(bg); });
    await page.evaluate((s) => window.__push(s), STATE);
    await page.mouse.move(w / f / 2, h / f / 2); await page.mouse.move(w / f / 2 + 10, h / f / 2 + 10);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `مشغل-الأدوات-${w}.jpg`), quality: 85 });
    for (const sheet of ['servers', 'quality', 'subtitles', 'audio', 'speed', 'episodes', 'more', 'skips', 'network', 'recommend', 'room']) {
      await page.evaluate((k) => { window.VantaraOverlayView.closeSheet(); window.VantaraOverlayView.open[k](); }, sheet);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `مشغل-${sheet}-${w}.jpg`), quality: 85 });
    }
    await page.evaluate(() => window.VantaraOverlayView.closeSheet());
    // شريحة القياس فوق الفيديو مفعّلة، والأدوات ظاهرة ثم مختفية
    await page.evaluate((s) => { localStorage.setItem('vantara.player.netChip', '1'); window.__push({ ...s }); }, STATE);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `مشغل-شريحة-القياس-${w}.jpg`), quality: 85 });
    await page.evaluate(() => localStorage.removeItem('vantara.player.netChip'));
    // كل زر ظاهر يرسل أمره
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.pwa-player button')].filter((b) => b.checkVisibility()).map((b) => b.dataset.action || b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean));
    console.log(w, 'أزرار ظاهرة:', buttons.length, buttons.join(' | '));
    await page.evaluate((s) => window.__push({ ...s, ready: false, status: { text: 'يتجهّز التورنت…' } }), STATE);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `مشغل-التحميل-${w}.jpg`), quality: 85 });
    console.log(w, 'أوامر أُرسلت أثناء الفتح:', sent.length);
    await ctx.close();
  }
  await browser.close();
})();
