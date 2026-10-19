// Real layout/canvas/download regression: node tools/pwa/reader-viewport.cjs
// Override PLAYWRIGHT_MODULE and CHROMIUM_PATH when needed.
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = join(__dirname, '../../apps/web');
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/v35/core.css"><link rel="stylesheet" href="/v35.css"><link rel="stylesheet" href="/v35/reader.css">
<body><script type="module">
import {openSmartReader} from '/v35/reader.js';
window.saved=[];
window.Capacitor={Plugins:{MediaLibrary:{saveImage:async payload=>window.saved.push(payload)}}};
const colors=['#ff0000','#0000ff','#00ff00'];
const images=colors.map((color,index)=>{const c=document.createElement('canvas');c.width=1000;c.height=index===2?6000:1000;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,c.width,c.height);return c.toDataURL()});
const row={number:1,sourceId:'fixture',chapter:{url:'chapter1',name:'Chapter 1'}};
window.reader=openSmartReader({sync:{user:{userId:'fixture'},rows:()=>[],enqueue(){}},engine:{pages:async()=>images.map((src,index)=>({src,index})),pageImage:async(_,p)=>({src:p.src})},mount:n=>document.body.append(n),exit(){},sendFrame:()=>{}},{title:'Viewport fixture',seriesRef:'fixture',rows:[row],row,sourceLocked:true});
window.inspectSaved=async function(){const payload=window.saved.at(-1);const img=new Image();img.src='data:'+payload.mimeType+';base64,'+payload.base64;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {width:c.width,height:c.height,pixels:[0,100,300,c.height-1].map(y=>[...x.getImageData(Math.floor(c.width/2),Math.min(y,c.height-1),1,1).data])}};
</script>`;
const server = createServer((req,res)=>{
  if (req.url === '/') {res.setHeader('content-type','text/html');return res.end(html);}
  try {res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'application/octet-stream');res.end(readFileSync(join(web,req.url.split('?')[0])));}
  catch {res.statusCode=404;res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:400,height:800},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>document.querySelectorAll('.rd-page > img').length===3);
    await page.evaluate(()=>document.querySelector('[data-act="frame"]').click());
    // Deselect every page: saving the viewport must remain available.
    await page.locator('.rd-thumb').click();
    assert.equal(await page.locator('#rdFrameNext').isDisabled(),true);
    assert.equal(await page.locator('[data-act="frameSave"]').isDisabled(),false);
    await page.evaluate(()=>document.querySelector('#rdScroll').scrollTop=200);
    await page.waitForTimeout(350); // Wait for the existing toolbar transition to finish.
    const bounds = await page.evaluate(()=>({top:document.querySelector('#rdFrameTop').getBoundingClientRect().bottom,bottom:document.querySelector('#rdTray').getBoundingClientRect().top}));
    await page.locator('[data-act="frameSave"]').click();
    await page.waitForFunction(()=>window.saved.length===1);
    const saved=await page.evaluate(()=>window.inspectSaved());
    assert.equal(saved.width,400);
    assert.equal(saved.height,Math.floor(bounds.bottom-bounds.top));
    assert.deepEqual(saved.pixels[0],[255,0,0,255]);
    assert.deepEqual(saved.pixels[2],[0,0,255,255]);
    assert.deepEqual(saved.pixels.at(-1),[0,255,0,255]);
    console.log('PASS actual multi-page image intersections; no selection; toolbar/tray excluded',saved);
    // Save a small visible section of the 2400px manhwa page.
    await page.evaluate(()=>document.querySelector('#rdScroll').scrollTop=1300);
    await page.locator('[data-act="frameSave"]').click();
    await page.waitForFunction(()=>window.saved.length===2);
    const tall=await page.evaluate(()=>window.inspectSaved());
    assert.equal(tall.height,saved.height);
    assert.deepEqual(tall.pixels,Array.from({length:4},()=>[0,255,0,255]));
    console.log('PASS tall manhwa output is viewport-sized',tall.width,tall.height);
    // Windows/browser uses a real PNG download when the native gallery plugin is absent.
    await page.evaluate(()=>delete window.Capacitor.Plugins.MediaLibrary);
    const downloaded=page.waitForEvent('download');
    await page.locator('[data-act="frameSave"]').click();
    const download=await downloaded;
    assert.match(download.suggestedFilename(),/^VANTARA-.*\.png$/);
    assert.equal(await download.failure(),null);
    console.log('PASS browser PNG download',download.suggestedFilename());
    // Paged fit-height contains a square image in a full-height frame; preserve its true placement.
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('.rd-page > img').length===3);
    await page.evaluate(()=>{const r=document.querySelector('.rd');r.dataset.mode='paged';r.dataset.fit='height';document.querySelector('[data-act="frame"]').click()});
    await page.waitForTimeout(350);
    await page.locator('[data-act="frameSave"]').click();
    await page.waitForFunction(()=>window.saved.length===1);
    const contained=await page.evaluate(()=>window.inspectSaved());
    assert.deepEqual(contained.pixels[0],[0,0,0,255]);
    assert.deepEqual(contained.pixels.at(-1),[0,0,0,255]);
    console.log('PASS paged contain letterboxing');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
