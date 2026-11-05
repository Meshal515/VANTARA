import {parseHTML} from 'linkedom';
import {afterEach,expect,it,vi} from 'vitest';
import {patchWorkDom} from './work-dom.js';
afterEach(()=>vi.unstubAllGlobals());
const fixture=()=>{const{document}=parseHTML('<html><body><div id="old"></div></body></html>');return {document,old:document.getElementById('old'),fresh:document.createElement('div')}};
it('keeps unchanged image, current controls and logo nodes during episode progress updates',()=>{const{old,fresh}=fixture();old.innerHTML='<div data-slot="episode-controls"><input value="draft"></div><div class="wl-logo-layer" data-logo-src="logo.png"><i></i></div><button class="sp" data-ep="10"><img src="a.jpg"><b>old</b></button>';fresh.innerHTML='<div data-slot="episode-controls"></div><div class="wl-logo-layer" data-logo-src="logo.png"><i></i></div><button class="sp cur" data-ep="10"><img src="a.jpg"><b>new</b></button>';const input=old.querySelector('input'),img=old.querySelector('img'),logo=old.querySelector('.wl-logo-layer');patchWorkDom(old,fresh);expect(old.querySelector('input')).toBe(input);expect(old.querySelector('img')).toBe(img);expect(old.querySelector('.wl-logo-layer')).toBe(logo);expect(old.querySelector('b').textContent).toBe('new');});
it('reorders keyed episode rows without replacing their images',()=>{const{old,fresh}=fixture();old.innerHTML='<button data-ep="1"><img src="1.jpg"></button><button data-ep="2"><img src="2.jpg"></button>';fresh.innerHTML='<button data-ep="2"><img src="2.jpg"></button><button data-ep="1"><img src="1.jpg"></button>';const im=old.lastElementChild.firstChild;patchWorkDom(old,fresh);expect(old.firstElementChild.firstChild).toBe(im)});
it('keeps old artwork until a replacement is decoded and rejects stale completion',async()=>{const{document,old,fresh}=fixture();const made=[];vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});old.innerHTML='<img src="old.jpg">';fresh.innerHTML='<img src="new.jpg">';patchWorkDom(old,fresh);const im=old.firstChild;expect(im.getAttribute('src')).toBe('old.jpg');fresh.innerHTML='<img src="best.jpg">';patchWorkDom(old,fresh);made[0].onload();expect(im.getAttribute('src')).toBe('old.jpg');made[1].onload();expect(im.getAttribute('src')).toBe('best.jpg')});

it('invalidates a pending replacement when the latest metadata returns to the displayed source',()=>{
 const{document,old,fresh}=fixture(),made=[];
 vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});
 old.innerHTML='<img src="old.jpg">';fresh.innerHTML='<img src="new.jpg">';patchWorkDom(old,fresh);
 fresh.innerHTML='<img src="old.jpg">';patchWorkDom(old,fresh);made[0].onload();
 expect(old.firstChild.getAttribute('src')).toBe('old.jpg');expect(old.firstChild.dataset.pendingArt).toBeUndefined();
});

it('releases a failed decode so a later repaint can retry without replacing the visible image',async()=>{
 const{document,old,fresh}=fixture(),made=[];
 vi.stubGlobal('Image',function(){const im=document.createElement('img');im.decode=()=>Promise.reject(new Error('decode failed'));made.push(im);return im});
 old.innerHTML='<img src="old.jpg">';fresh.innerHTML='<img src="new.jpg">';patchWorkDom(old,fresh);
 made[0].onload();await vi.waitFor(()=>expect(old.firstChild.dataset.pendingArt).toBeUndefined());
 expect(old.firstChild.getAttribute('src')).toBe('old.jpg');patchWorkDom(old,fresh);expect(made).toHaveLength(2);
});

it('decodes a real fallback before changing visible artwork and ignores an older request failure',async()=>{
 const{document,old,fresh}=fixture(),made=[];
 vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});
 old.innerHTML='<img src="old.jpg">';fresh.innerHTML='<img src="stale.jpg">';patchWorkDom(old,fresh);
 fresh.innerHTML='<img src="hd.jpg" data-art-fallbacks=\'["low.jpg","poster.jpg"]\'>';patchWorkDom(old,fresh);
 made[0].onerror();expect(old.firstChild.dataset.pendingArt).toBe('hd.jpg');
 made[1].onerror();expect(made[2].getAttribute('src')).toBe('low.jpg');
 let decoded;made[2].decode=()=>new Promise(resolve=>{decoded=resolve});made[2].onload();await Promise.resolve();
 expect(old.firstChild.getAttribute('src')).toBe('old.jpg');decoded();
 await vi.waitFor(()=>expect(old.firstChild.getAttribute('src')).toBe('low.jpg'));
 expect(JSON.parse(old.firstChild.dataset.artFallbacks)).toEqual(['poster.jpg']);
 expect(old.firstChild.dataset.pendingArt).toBeUndefined();
});

it('preserves runtime depth and opacity through metadata updates while accepting explicitly authored styles',()=>{
 const{old,fresh}=fixture();old.innerHTML='<div class="wl-card" style="transform:translate3d(0px,-12px,15px);opacity:.65;will-change:transform"></div>';
 fresh.innerHTML='<div class="wl-card"></div>';const card=old.firstChild;patchWorkDom(old,fresh);
 expect(card.style.transform).toBe('translate3d(0px,-12px,15px)');expect(Number(card.style.opacity)).toBe(.65);expect(card.style.willChange).toBe('transform');
 fresh.innerHTML='<div class="wl-card" style="opacity:.8"></div>';patchWorkDom(old,fresh);
 expect(Number(card.style.opacity)).toBe(.8);expect(card.style.transform).toBe('translate3d(0px,-12px,15px)');
});

it('keeps a failed image hidden until a decoded replacement is ready',()=>{
 const{document,old,fresh}=fixture(),made=[];
 vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});
 old.innerHTML='<img src="failed.jpg" style="visibility:hidden">';fresh.innerHTML='<img src="failed.jpg" alt="updated metadata">';patchWorkDom(old,fresh);
 const im=old.firstChild;expect(im.style.visibility).toBe('hidden');
 fresh.innerHTML='<img src="ready.jpg">';patchWorkDom(old,fresh);expect(im.style.visibility).toBe('hidden');
 made[0].onload();expect(im.getAttribute('src')).toBe('ready.jpg');expect(im.style.visibility).not.toBe('hidden');
});

it('remembers the decoded fallback for a desired primary through repeated progress paints',()=>{
 const{document,old,fresh}=fixture(),made=[];
 vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});
 old.innerHTML='<img src="old.jpg">';fresh.innerHTML='<img src="hd.jpg" data-art-fallbacks=\'["low.jpg","poster.jpg"]\'>';
 patchWorkDom(old,fresh);made[0].onerror();made[1].onload();expect(old.firstChild.getAttribute('src')).toBe('low.jpg');
 const count=made.length;patchWorkDom(old,fresh);patchWorkDom(old,fresh);
 expect(made).toHaveLength(count);expect(old.firstChild.getAttribute('src')).toBe('low.jpg');
 expect(JSON.parse(old.firstChild.dataset.artFallbacks)).toEqual(['poster.jpg']);
});

it('keeps native lazy loading for measured distant artwork without preloading offscreen replacements',()=>{
 const{document,old,fresh}=fixture(),made=[];
 vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});
 vi.stubGlobal('innerHeight',800);vi.stubGlobal('innerWidth',390);
 old.innerHTML='<img loading="lazy" src="old.jpg">';fresh.innerHTML='<img loading="lazy" src="new.jpg" data-art-fallbacks=\'["fallback.jpg"]\'>';
 const im=old.firstChild;im.getBoundingClientRect=()=>({top:3000,bottom:3100,left:0,right:100,width:100,height:100});
 patchWorkDom(old,fresh);expect(made).toHaveLength(0);expect(old.firstChild).toBe(im);
 expect(im.getAttribute('src')).toBe('new.jpg');expect(im.getAttribute('loading')).toBe('lazy');expect(JSON.parse(im.getAttribute('data-art-fallbacks'))).toEqual(['fallback.jpg']);
});

it('preloads visible, nearby, or unmeasured lazy artwork instead of treating zero-size boxes as offscreen',()=>{
 for(const top of [200,1000,null]){
  const{document,old,fresh}=fixture(),made=[];
  vi.stubGlobal('Image',function(){const im=document.createElement('img');made.push(im);return im});
  vi.stubGlobal('innerHeight',800);vi.stubGlobal('innerWidth',390);
  old.innerHTML='<img loading="lazy" src="old.jpg">';fresh.innerHTML='<img loading="lazy" src="new.jpg">';
  old.firstChild.getBoundingClientRect=()=>top==null?{top:0,bottom:0,left:0,right:0,width:0,height:0}:{top,bottom:top+100,left:0,right:100,width:100,height:100};
  patchWorkDom(old,fresh);expect(made,`top=${top}`).toHaveLength(1);expect(old.firstChild.getAttribute('src')).toBe('old.jpg');
 }
});

it('preserves only mini-player visibility and expanded-description runtime classes, while updating selected episode state',()=>{
 const{old,fresh}=fixture();
 old.innerHTML='<div class="wl-mini on"></div><p class="wl-desc open">old description</p><button class="cur on" data-ep="1">old</button>';
 fresh.innerHTML='<div class="wl-mini"></div><p class="wl-desc">new description</p><button class="seen" data-ep="1">new</button>';
 patchWorkDom(old,fresh);
 expect(old.querySelector('.wl-mini').classList.contains('on')).toBe(true);
 expect(old.querySelector('.wl-desc').classList.contains('open')).toBe(true);
 expect(old.querySelector('.wl-desc').textContent).toBe('new description');
 expect(old.querySelector('button').className).toBe('seen');
});
