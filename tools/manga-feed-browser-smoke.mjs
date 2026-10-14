/** Real Chromium/layout evidence for the shared feed; transport is an owned fixture, not a live-source coverage claim. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(process.env.BROWSER_MODULE_ROOT ? `${process.env.BROWSER_MODULE_ROOT}/package.json` : import.meta.url);
const { chromium } = require('playwright');
const output = resolve(process.env.TEST_OUTPUT ?? '/tmp/vantara-feed-browser');
await mkdir(output, { recursive: true });
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/v35/core.css"><style>
body{margin:0;background:#09080d;color:#eee;font-family:Arial,sans-serif}.v35{--text:#eee;--text-3:#aaa;--surface-2:#201c2c;--accent-text:#b79bea;padding:12px}.feed-scroll{height:620px;max-height:75vh;overflow-y:auto;overflow-anchor:none;padding:10px;border:1px solid #383044}.up-art img{width:100%;height:100%;object-fit:cover}.link{background:none;border:0;color:#b79bea;padding:12px;font:inherit}[hidden]{display:none!important}
</style></head><body><main class="v35"><h2>آخر التحديثات — اختبار التمرير</h2><section class="feed-scroll"><div id="feed"></div></section></main><script type="module">
import {connectUpdates} from '/lib/update-engine.js';
import {mountTimeline} from '/v35/updates-view.js';
const now=Date.now(), cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#4e376d"/><text x="20" y="160" font-size="24" fill="white">VANTARA</text></svg>');
const make=(id,work,at)=>({id:String(id),section:'manga',work,title:work,kind:'chapter',number:Number(id),at,publishedAt:at,firstSeenAt:now,cover,sources:[{s:'fixture',u:'/work/'+work}]});
const original=Array.from({length:160},(_,i)=>make(160-i,i<40?'ext:one':'ext:work '+i,now-i*1000));
window.calls=[]; window.head=original; window.failOlder=false;
connectUpdates(async path=>{
 const url=new URL(path,location.origin),before=url.searchParams.get('before'),limit=Number(url.searchParams.get('limit'));
 calls.push({before,limit});
 await new Promise(r=>setTimeout(r,20));
 if(before&&window.failOlder){window.failOlder=false;return {status:503};}
 const rows=before?original.slice(Number(before)):window.head;
 const events=rows.slice(0,limit),offset=before?Number(before):0;
 return {status:200,body:{events,next:rows.length>limit?String(offset+limit):null,snapshotAt:Date.now()}};
});
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
window.coverMounts=0;window.opened=null;
window.api=mountTimeline(document.querySelector('#feed'),{section:'manga',el,open:g=>window.opened=g,empty:()=>el('p','','لا تحديثات'),mountCover:(art,g)=>{window.coverMounts++;const img=new Image();img.src=g.cover;img.alt='';art.append(img);}});
window.original=original;window.make=make;window.ready=true;
</script></body></html>`;
const web = resolve('apps/web');
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://local').pathname;
    if (path === '/harness') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html); return; }
    const file = resolve(web, `.${path}`);
    if (!file.startsWith(`${web}/`)) throw new Error('path');
    response.setHeader('content-type', { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' }[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BINARY ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const evidence = [];
try {
  for (const viewport of [{ width:390,height:844 },{ width:820,height:1100 },{ width:1440,height:900 }]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
    await page.waitForFunction(() => window.ready && calls.length >= 2 && !document.querySelector('.up-load-more').disabled);
    const counts = await page.evaluate(() => ({ calls:calls.length,cards:document.querySelectorAll('.up-card').length }));
    assert.ok(counts.cards > 1 && counts.calls >= 2, 'still-visible sentinel must fetch the next grouped page');
    const anchored = await page.evaluate(async () => {
      const scroll = document.querySelector('.feed-scroll'), list = document.querySelector('.up-list');
      scroll.scrollTop = Math.min(450,scroll.scrollHeight-scroll.clientHeight);
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const rect = scroll.getBoundingClientRect();
      const anchor = [...list.children].find(n=>n.getBoundingClientRect().top >= rect.top+1 && n.getBoundingClientRect().bottom > rect.top+1);
      const id=anchor.dataset.workKey,before=anchor.getBoundingClientRect().top,windowY=scrollY,coverCount=coverMounts;
      window.savedOne=list.querySelector('[data-work-key="manga|ext:one"]');window.savedImage=savedOne.querySelector('img');
      window.head=[...Array.from({length:24},(_,i)=>make(200+i,'ext:new '+i,Date.now()+i)),make(199,'ext:one',Date.now()),...original];
      await api.refresh();
      const kept=[...list.children].find(n=>n.dataset.workKey===id);
      return {delta:kept.getBoundingClientRect().top-before,windowDelta:scrollY-windowY,coverIncrease:coverMounts-coverCount,sameCard:list.querySelector('[data-work-key="manga|ext:one"]')===savedOne,sameCover:savedOne.querySelector('img')===savedImage,retained:!!list.querySelector('[data-work-key="'+id+'"]')};
    });
    assert.ok(Math.abs(anchored.delta)<1,'nested scroll must retain visible card geometry');
    assert.equal(anchored.windowDelta,0); assert.equal(anchored.sameCard,true); assert.equal(anchored.sameCover,true); assert.equal(anchored.retained,true);
    const retry = await page.evaluate(async()=>{window.failOlder=true;const before=calls.length;await api.loadMore();const cursor=calls.at(-1).before;await api.loadMore();return {cursor,retried:calls.at(-1).before,calls:calls.length-before};});
    assert.equal(retry.cursor,retry.retried,'older page retry preserves its cursor');
    assert.equal(retry.calls,2);
    assert.deepEqual(errors,[]);
    await page.screenshot({ path:resolve(output,`feed-${viewport.width}.png`),fullPage:true });
    evidence.push({viewport,initial:counts,anchored,retry,errors});
    await page.evaluate(()=>api.dispose()); await page.close();
  }
  await writeFile(resolve(output,'results.json'),JSON.stringify({browser:'real Chromium',transport:'owned fixture',evidence},null,2));
  console.log(JSON.stringify({output,evidence}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
