/** Keyed updates retain image elements, focused controls and compositor animation nodes. */
const key = node => {
 if(node.nodeType!==1)return null;
 if(node.matches('.wl-logo-layer'))return `logo:${node.dataset.logoSrc}`;
 if(node.dataset.slot)return `slot:${node.dataset.slot}`;
 if(node.dataset.ep!=null)return `${node.tagName}:${node.classList.contains('sp')?'sp':node.classList.contains('er')?'er':'ep'}:${node.dataset.ep}`;
 return node.id?`id:${node.id}`:null;
};
const compatible=(a,b)=>a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName);
function attributes(old,fresh,{skipSrc=false}={}){
 const preserved=['in','loaded','dragging'].filter(c=>old.classList.contains(c));
 for(const [selector,state]of [['.wl-mini','on'],['.wl-desc','open']])if(old.matches(selector)&&fresh.matches(selector)&&old.classList.contains(state))preserved.push(state);
 // Collapse/depth motion owns these inline properties between paints. Metadata
 // templates do not author them, so replacing the style attribute must retain them.
 const motion=['transform','opacity','will-change'].map(name=>[name,old.style.getPropertyValue(name),typeof old.style.getPropertyPriority==='function'?old.style.getPropertyPriority(name):'']);
 for(const a of [...old.attributes])if(!fresh.hasAttribute(a.name)&&!a.name.startsWith('data-pending')&&!(skipSrc&&a.name==='src'))old.removeAttribute(a.name);
 for(const a of [...fresh.attributes])if(!(skipSrc&&a.name==='src')&&old.getAttribute(a.name)!==a.value)old.setAttribute(a.name,a.value);
 for(const [name,value,priority]of motion)if(value&&!fresh.style.getPropertyValue(name))old.style.setProperty(name,value,priority??'');
 for(const c of preserved)old.classList.add(c);
}
const artworkRequests=new WeakMap();
function distantLazyImage(image){
 if(image.getAttribute('loading')!=='lazy'||typeof image.getBoundingClientRect!=='function')return false;
 const height=globalThis.innerHeight,width=globalThis.innerWidth;
 if(!(height>0&&width>0))return false;
 const box=image.getBoundingClientRect();
 // Empty/test/unlaid-out rectangles say nothing about viewport visibility.
 if(!(box.width>0&&box.height>0))return false;
 const margin=Math.min(600,height/2);
 return box.top>height+margin||box.bottom < -margin||box.left>width+margin||box.right < -margin;
}
function image(old,fresh){
 const source=fresh.getAttribute('src');
 const hidden=old.style.visibility==='hidden'&&!fresh.style.getPropertyValue('visibility');
 attributes(old,fresh,{skipSrc:true});
 if(hidden)old.style.visibility='hidden';
 const displayed=old.getAttribute('src');
 if(!source||source===displayed){
  // Returning to the current decoded source cancels any older preload/decode.
  artworkRequests.delete(old);delete old.dataset.pendingArt;
  if(!source)old.removeAttribute('src');
  return;
 }
 const previous=artworkRequests.get(old);
 if(previous?.source===source&&(previous.status==='pending'||previous.status==='ready'&&previous.visibleSource===displayed)){
  if(previous.status==='ready'&&previous.remaining)old.dataset.artFallbacks=JSON.stringify(previous.remaining);
  return;
 }
 if(distantLazyImage(old)){
  // Keep the browser's native lazy policy for distant tiles. There is no visible
  // decoded frame to protect here, and a separate preloader would fetch eagerly.
  artworkRequests.delete(old);delete old.dataset.pendingArt;old.setAttribute('src',source);
  if(hidden)old.style.removeProperty('visibility');
  return;
 }
 let fallbacks=[];try{const value=JSON.parse(fresh.dataset.artFallbacks??'[]');if(Array.isArray(value))fallbacks=value.filter(x=>typeof x==='string'&&x).slice(0,16)}catch{}
 const chain=[...new Set([source,...fallbacks])];
 const request={source,status:'pending',attempt:0};artworkRequests.set(old,request);old.dataset.pendingArt=source;
 const current=()=>artworkRequests.get(old)===request;
 const attempt=index=>{
  if(!current())return;
  if(index>=chain.length){artworkRequests.delete(old);delete old.dataset.pendingArt;return}
  const candidate=chain[index],ticket=++request.attempt;
  const active=()=>current()&&request.attempt===ticket;
  const ready=()=>{
   if(!active())return;
   old.setAttribute('src',candidate);delete old.dataset.pendingArt;
   if(hidden)old.style.removeProperty('visibility');
   request.status='ready';request.visibleSource=candidate;request.remaining=chain.slice(index+1);
   if(fresh.hasAttribute('data-art-fallbacks'))old.dataset.artFallbacks=JSON.stringify(request.remaining);
  };
  const next=()=>{if(active())attempt(index+1)};
  // A currently displayed fallback already has a decoded frame. Remember the
  // primary→fallback decision so progress updates do not fetch a known bad primary.
  if(candidate===displayed&&!hidden){ready();return}
  const preload=typeof Image==='function'?new Image():old.ownerDocument.createElement('img');
  preload.decoding='async';
  const cors=fresh.getAttribute('crossorigin');if(cors!=null)preload.setAttribute('crossorigin',cors);
  preload.onload=()=>{
   if(!active())return;
   if(typeof preload.decode==='function')Promise.resolve().then(()=>preload.decode()).then(ready,next);
   else ready();
  };
  preload.onerror=next;preload.src=candidate;
 };
 attempt(0);
}
export function patchWorkDom(old,fresh){
 if(old.nodeType===3){if(old.data!==fresh.data)old.data=fresh.data;return old}
 if(old.nodeType!==1)return old;
 if(old.matches('.wl-logo-layer')&&old.dataset.logoSrc===fresh.dataset.logoSrc)return old;
 if(old.dataset.slot==='episode-controls')return old;
 if(old.tagName==='IMG'){image(old,fresh);return old}
 attributes(old,fresh);
 const candidates=[...old.childNodes],used=new Set();
 let cursor=old.firstChild;
 for(const next of [...fresh.childNodes]){
  const id=key(next);
  let current=id?candidates.find(n=>!used.has(n)&&key(n)===id):null;
  if(!current&&!id)current=candidates.find(n=>!used.has(n)&&!key(n)&&compatible(n,next));
  if(current){used.add(current);patchWorkDom(current,next)}else current=next;
  if(current!==cursor)old.insertBefore(current,cursor);
  cursor=current.nextSibling;
 }
 for(const node of candidates)if(!used.has(node)&&node.parentNode===old)node.remove();
 return old;
}
