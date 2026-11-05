/** Shared episode actions; each layout retains its own cards, typography and spacing. */
export function createEpisodeControls({document,el,glyph,onQuery,onPage,onTools,look='core'}) {
 const root=el('div','aw-episode-controls');
 const head=el('div',look==='core'?'aw-eps-head':'wl-eps-head'),titles=el('div','aw-eps-titles'),subtitle=el('span','aw-eps-sub');
 titles.append(el('h2',null,'الحلقات'),subtitle);head.append(titles);
 const tools=el('div','aw-eps-tools');
 const button=(name,label,run)=>{const b=el('button','icon-btn');b.type='button';b.innerHTML=glyph(name,{size:20});b.setAttribute('aria-label',label);b.onclick=run;return b};
 const form=el('form','aw-find');form.hidden=true;
 form.innerHTML=`${glyph('search',{size:18})}<input type="search" enterkeyhint="search" autocomplete="off" placeholder="رقم الحلقة أو اسمها" aria-label="ابحث في الحلقات">`;
 const input=form.querySelector('input');
 let timer=null,disposed=false,composing=false,rangeKey='',seasonKey='',activeKey='';
 const commit=()=>{clearTimeout(timer);if(!disposed&&!composing)onQuery(input.value.trim())};
 input.oninput=()=>{clearTimeout(timer);if(!composing)timer=setTimeout(commit,220)};
 input.addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer)});
 input.addEventListener('compositionend',()=>{composing=false;commit()});
 form.onsubmit=e=>{e.preventDefault();commit()};
 const search=button('search','ابحث في الحلقات',()=>{form.hidden=!form.hidden;search.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)input.focus?.()});
 search.setAttribute('aria-expanded','false');
 const close=button('close','أغلق البحث',()=>{clearTimeout(timer);input.value='';form.hidden=true;search.setAttribute('aria-expanded','false');onQuery('')});
 close.classList.add('aw-find-close');form.append(close);
 tools.append(search,button('sliders','الترتيب والتصفية',onTools));head.append(tools);
 const seasons=el('div','aw-episode-seasons'),ranges=el('div','aw-ranges');
 ranges.setAttribute('aria-label','مجموعات الحلقات');
 ranges.onclick=e=>{const b=e.target.closest('[data-episode-page]');if(b)onPage(Number(b.dataset.episodePage))};
 root.append(head,form,seasons,ranges);
 return {root,subtitle,input,
  update({page,query='',seasonNode=null}) {
   if(disposed)return;
   if(input.value!==query && document.activeElement!==input)input.value=query;
   if(query){form.hidden=false;search.setAttribute('aria-expanded','true')}
   const nextKey=page.groups.map(g=>g.label).join('|');
   if(nextKey!==rangeKey){const offset=ranges.scrollLeft;ranges.replaceChildren(...page.groups.map(g=>{const b=el('button','aw-range',g.label);b.type='button';b.dir='ltr';b.dataset.episodePage=String(g.index);b.setAttribute('aria-label',`الحلقات ${g.label}`);return b}));ranges.scrollLeft=offset;rangeKey=nextKey}
   ranges.hidden=page.groups.length<2;
   for(const b of ranges.children){const active=Number(b.dataset.episodePage)===page.pageIndex;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
   const nextActive=nextKey+':'+page.pageIndex;
   if(nextActive!==activeKey){activeKey=nextActive;globalThis.requestAnimationFrame?.(()=>{
    if(disposed||!root.isConnected||activeKey!==nextActive)return;
    const selected=ranges.querySelector('[aria-current="page"]');
    if(!selected)return;
    const r=ranges.getBoundingClientRect(),b=selected.getBoundingClientRect();
    if(b.left<r.left||b.right>r.right)ranges.scrollBy?.({left:b.left+b.width/2-r.left-r.width/2,behavior:'instant'});
   })}
   const nextSeason=seasonNode?.innerHTML??'';
   if(nextSeason!==seasonKey){const offset=seasons.firstElementChild?.scrollLeft??0;seasons.replaceChildren(...(seasonNode?[seasonNode]:[]));if(seasons.firstElementChild)seasons.firstElementChild.scrollLeft=offset;seasonKey=nextSeason}
   seasons.hidden=!seasonNode;
  },
  suspend(){clearTimeout(timer);composing=false},
  destroy(){disposed=true;clearTimeout(timer)}
 };
}
