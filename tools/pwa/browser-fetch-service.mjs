/** Optional private WitAnime browser backend. Never started or deployed by the app. */
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';

const allowed = raw => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && u.hostname === 'witanime.site';
  } catch { return false; }
};
const digest = s => createHash('sha256').update(s).digest();

export async function createBrowserBackend({ browser, secret, maxSessions = 8, idleMs = 300000 }) {
  if (!secret || secret.length < 32) throw new Error('A private backend secret of at least 32 characters is required');
  const sessions = new Map();
  const opening = new Map();
  async function session(id) {
    let s = sessions.get(id);
    if (s) return s;
    if (opening.has(id)) return opening.get(id);
    if (sessions.size + opening.size >= maxSessions) throw new Error('browser_capacity');
    const pending = (async () => {
    const context = await browser.newContext({userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',viewport:{width:412,height:915}});
    // No arbitrary site, ad, iframe, localhost or media request can leave this backend.
    await context.route('**/*', route => allowed(route.request().url()) ? route.continue() : route.abort());
    s = { context, at: Date.now(), queue: Promise.resolve(), queued: 0 }; sessions.set(id, s); return s;
    })();
    opening.set(id, pending);
    try { return await pending; } finally { opening.delete(id); }
  }
  const expiry = setInterval(() => {
    for (const [id, s] of sessions) if (!s.busy && Date.now() - s.at > idleMs) {
      sessions.delete(id); void s.context.close();
    }
  }, 30000).unref();
  async function fetchPage(input) {
    if (!allowed(input.url) || !/^[a-f0-9]{64}$/.test(input.session ?? '')) throw new Error('host_not_allowed');
    if (String(input.body ?? '').length > 65536) throw new Error('body_too_large');
    const s = await session(input.session);
    if (s.queued >= 8) throw new Error('browser_capacity');
    s.queued++;
    const run = async () => {
      s.busy = true; s.at = Date.now();
      const page = await s.context.newPage();
      try {
        if (input.method === 'POST' || input.follow === false) {
          // AJAX uses the same browser cookie jar; do not follow an unchecked redirect.
          const headers = {};
          for (const name of ['accept','content-type','referer','origin','x-requested-with','x-csrf-token']) {
            const value = input.headers?.[name];
            if (typeof value === 'string' && value.length < 2048) headers[name] = value;
          }
          if (input.method === 'POST') {
            // Use the browser network stack, as AJAX on the source's own page does.
            // APIRequestContext has a different TLS/request fingerprint from Chromium.
            await page.goto(allowed(headers.referer) ? headers.referer : 'https://witanime.site/', {waitUntil:'domcontentloaded',timeout:30000});
            delete headers.origin; delete headers.referer;
            return await page.evaluate(async ({url,headers,body}) => {
              const r = await fetch(url,{method:'POST',headers,body:body??'',redirect:'manual'});
              return {status:r.status,url:r.url,text:await r.text(),type:r.headers.get('content-type')};
            }, {url:input.url,headers,body:input.body});
          }
          const r = await s.context.request.fetch(input.url, {method:input.method === 'POST' ? 'POST' : 'GET', data:input.body, headers, maxRedirects:0, timeout:30000});
          return {status:r.status(), url:r.url(), text:await r.text(), type:r.headers()['content-type'], location:r.headers().location};
        }
        const r = await page.goto(input.url, {waitUntil:'domcontentloaded',timeout:30000});
        if (!allowed(page.url())) throw new Error('foreign_redirect');
        // Wait briefly for an automatic JS challenge; interactive challenges remain explicit errors.
        await page.waitForFunction(() => !/just a moment|attention required/i.test(document.title), {timeout:8000}).catch(() => {});
        return {status:r?.status() ?? 502, url:page.url(), text:await page.content(), type:'text/html; charset=utf-8'};
      } finally { await page.close(); s.busy = false; s.at = Date.now(); }
    };
    const task = s.queue.then(run).finally(() => { s.queued--; }); s.queue = task.catch(() => {}); return task;
  }
  const server = createServer(async (req,res) => {
    res.setHeader('content-type','application/json'); res.setHeader('cache-control','no-store');
    if (req.method !== 'POST' || req.url !== '/fetch' || !timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${secret}`))) {
      res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
    }
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 75000) throw new Error('body_too_large'); }
      res.end(JSON.stringify(await fetchPage(JSON.parse(body))));
    } catch (e) { res.writeHead(502); res.end(JSON.stringify({error:e.message === 'browser_capacity' ? e.message : 'browser_fetch_failed'})); }
  });
  return { server, fetchPage, async close() { clearInterval(expiry); await Promise.allSettled([...opening.values()]); await Promise.all([...sessions.values()].map(s=>s.context.close())); if (server.listening) await new Promise(r=>server.close(r)); } };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).href) {
  const require = createRequire(process.env.BROWSER_MODULE_ROOT ? `${process.env.BROWSER_MODULE_ROOT}/package.json` : import.meta.url);
  const {chromium} = require('playwright');
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  const backend = await createBrowserBackend({browser,secret:process.env.BROWSER_FETCH_SECRET});
  backend.server.listen(Number(process.env.PORT ?? 8789), '127.0.0.1');
  for (const sig of ['SIGINT','SIGTERM']) process.on(sig,async()=>{await backend.close();await browser.close();process.exit(0);});
}
