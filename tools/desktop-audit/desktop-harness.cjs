// تطبيق VANTARA لويندوز داخل Playwright كما يقلعه Electron: index.html بمدخل /desktop/full-boot.js (main.cjs)،
// وجسر VantaraDesktop بنفس أسماء preload.cjs. requestResource يجلب من الشبكة الحقيقية خارج المتصفح (بلا CORS)
// كما تفعل العملية الرئيسية، فتعمل مصادر المانجا المدمجة والإضافات ببيانات حقيقية. التشغيل (mpv) خارج هذا.
const { chromium } = require('playwright');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD']);
const { fitZoom } = require('../../apps/desktop/window-zoom.cjs');
/** شاشة فعلية → ما يراه Electron بعد window-zoom.cjs: عرض CSS أصغر بمعامل التكبير، وكثافة بكسل بالمعامل نفسه. */
function screenView(width, height) { const f = fitZoom(width); return { viewport: { width: Math.round(width / f), height: Math.round(height / f) }, deviceScaleFactor: f }; }
async function openDesktop({ browser, viewport = { width: 1366, height: 768 }, storage = {}, port = 8765, mobile = false, screen = null }) {
  let dsf = 1;
  if (screen && !mobile) ({ viewport, deviceScaleFactor: dsf } = screenView(screen.width, screen.height));
  // serviceWorkers: block — وإلا تعيد القشرة التحميل من كاش PWA بمدخل app.js فيضيع مدخل ويندوز
  const ctx = await browser.newContext({ serviceWorkers: 'block', ...(mobile ? { viewport, isMobile: true, hasTouch: true } : { viewport, deviceScaleFactor: dsf }) });
  const page = await ctx.newPage();
  const api = ctx.request;
  await page.exposeFunction('__vantaraRequest', async (args) => {
    const { url, method = 'GET', headers = {}, body = null, binary = false, follow = true, timeout = 15000 } = args ?? {};
    if (!/^https:\/\//i.test(url) || !ALLOWED_METHODS.has(method)) throw new Error('طلب غير مسموح');
    const res = await api.fetch(url, { method, headers: { 'user-agent': 'Mozilla/5.0 VANTARA/Windows', ...headers }, data: body ?? undefined, maxRedirects: follow ? 6 : 0, timeout, failOnStatusCode: false });
    const h = res.headers();
    const out = { status: res.status(), url: res.url(), headers: Object.fromEntries(['content-type', 'location'].filter(k => h[k]).map(k => [k, h[k]])), location: h.location ?? null };
    if (binary) return { ...out, base64: (await res.body()).toString('base64'), contentType: String(h['content-type'] ?? '').split(';')[0] };
    return { ...out, text: await res.text() };
  });
  await page.addInitScript(([storage]) => {
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    const noop = async () => true;
    const listeners = new Set();
    window.VantaraDesktop = Object.freeze({
      platform: 'windows', version: '0.4.0', channel: 'debug', build: null, sourceSha: null, builtAt: null,
      requestResource: (args) => window.__vantaraRequest(args),
      requestFirstParty: async () => ({ status: 200, text: '{}', headers: { 'content-type': 'application/json' } }),
      showApp: noop, showPlayer: noop, playerViewport: noop, playerFullscreen: noop, playerOverlay: async () => false,
      prewarmTorrent: noop, startPlayback: noop, stopPlayback: noop, playbackCommand: noop, openExternal: noop,
      openUpdatePage: noop, downloadUpdate: async () => ({ ready: false, manual: true }), applyUpdate: noop,
      onOverlayCommand: () => () => {}, onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    });
  }, [storage]);
  await page.route((u) => u.origin === `http://127.0.0.1:${port}` && (u.pathname === '/' || u.pathname === '/index.html'), async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace('<script type="module" src="/app.js"></script>', '<script type="module" src="/desktop/full-boot.js"></script>');
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  return { ctx, page };
}
module.exports = { openDesktop, chromium, screenView };
