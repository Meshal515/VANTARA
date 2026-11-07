/** Runs against the real mounted shell in Chromium or the installed APK's CDP.
 * Local anonymous data only; no login, provider or playback claim.
 */
export async function sectionMotionProof(evaluate, capture = async () => {}) {
  const proof = { cases: [], passed: false };
  // The animated cases need animations on. With the system «reduce motion» setting (an emulator started with
  // animations disabled reports it to WebView) VANTARA correctly switches instantly, and the measurements below
  // would read that as a scroll jump. Say so instead of misreporting; the instant path is proven at the end.
  if (await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) {
    throw new Error('System reduced motion is on: enable animations before measuring animated section transitions');
  }
  const order = ['manga', 'anime', 'cinema'];
  const wait = async () => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(`!document.querySelector('.section-page-layer,.layering')`)) return;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('Section transition did not settle');
  };
  const pick = id => evaluate(`document.querySelector('#secOpt-${id}').click()`);
  for (const from of order) for (const to of order.filter(id => id !== from)) {
    for (const page of ['home', 'discover', 'library', 'majlis']) {
      await evaluate(`document.querySelector('[data-act="navTo"][data-arg="home"]').click()`);
      await pick(from); await wait();
      if (page !== 'home') await evaluate(`document.querySelector('[data-act="navTo"][data-arg="${page}"]').click()`);
      // Click, pause and every measurement happen in ONE JavaScript task: dock.js finishes a transition with a safety
      // timer (duration + 150 ms) that pausing the animations does not stop. Reading frames over separate CDP calls let
      // a slow emulator WebView finish the switch first, so the device measured settled layers, not the motion.
      const measured = await evaluate(`(() => {
        const old = document.querySelector('#${page}');
        // A tall local sentinel makes preservation of the reading position measurable.
        const sentinel = document.createElement('div'); sentinel.dataset.motionSentinel = 'true';
        sentinel.style.cssText = 'height:1600px;padding-top:180px';
        sentinel.innerHTML = '<div class=search-head><h2>موضع القارئ</h2></div><button class=search-genre>تصنيف</button>'; old.append(sentinel);
        const styles = () => [sentinel.querySelector('h2'),sentinel.querySelector('button')].map(n=>{const c=getComputedStyle(n);return [c.fontSize,c.fontWeight,c.padding,c.borderRadius,c.color]});
        window.__sectionProofStyles = styles();
        window.scrollTo({top:'${page}'==='home'?0:120,behavior:'instant'});
        const before = {y:sentinel.getBoundingClientRect().y,text:old.textContent};
        const oldChildren = [...old.children];
        const t0 = performance.now();
        document.querySelector('#secOpt-${to}').click();
        const animations = document.getAnimations().filter(a => a.effect?.getTiming().duration === 430);
        for (const a of animations) {a.pause();a.currentTime=0;}
        window.__sectionProofAnimations = animations;
        window.__sectionProofOld = old; window.__sectionProofSentinel = sentinel;
        const after = {y:sentinel.getBoundingClientRect().y,text:old.textContent};
        const home = document.querySelector('#home');
        const current = '${page}'==='home'?document.querySelector('#${from}Home'):old;
        const target = '${page}'==='home'?document.querySelector('#${to}Home'):home;
        const x = n => new DOMMatrixReadOnly(getComputedStyle(n).transform).m41;
        const frames = [0, 160, 420].map(time => {
          for (const a of animations) a.currentTime = time;
          return {time,oldX:x(current),newX:x(target),oldZ:+getComputedStyle(current).zIndex||0,newZ:+getComputedStyle(target).zIndex||0,width:home.getBoundingClientRect().width};
        });
        for (const a of animations) a.currentTime = 0;
        const syncMs = performance.now() - t0;
        return {record:{beforeY:before.y,afterY:after.y,sameText:before.text===after.text,
          sameNodes:oldChildren.every(n=>n.parentNode===old), animations:animations.length,
          from:'${from}',to:'${to}',page:'${page}'},frames,syncMs};
      })()`);
      const {record, frames} = measured;
      if (!record.animations) throw new Error('No section transition was measured: '+JSON.stringify(record));
      if (page !== 'home' && (!record.sameNodes || !record.sameText)) throw new Error('Outgoing page was rebuilt: '+JSON.stringify(record));
      if (page !== 'home' && Math.abs(record.beforeY-record.afterY)>1) throw new Error('First frame scroll jump: '+JSON.stringify(record));
      // Identity freeze, measured as before in its own call: waiting for frames inside the measuring task hung the
      // device WebView (CDP timeout), while this separate two-frame check is the one that already ran there.
      if (page !== 'home') {
        const frozen = await evaluate(`(async()=>{
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const actual=[window.__sectionProofSentinel.querySelector('h2'),window.__sectionProofSentinel.querySelector('button')].map(n=>{const c=getComputedStyle(n);return [c.fontSize,c.fontWeight,c.padding,c.borderRadius,c.color]});
          return JSON.stringify(actual)===JSON.stringify(window.__sectionProofStyles);
        })()`);
        if(!frozen)throw new Error('Outgoing section styles changed after identity update: '+JSON.stringify(record));
      }
      if (from === 'manga' && to === 'cinema' && page === 'discover') for (const time of [0, 160, 420]) {
        // Evidence only (screenshots need their own calls); the verdict above used the in-task measurements.
        await evaluate(`(() => {for(const a of window.__sectionProofAnimations) a.currentTime=${time};})()`);
        await capture(`section-${page}-${from}-${to}-${time}`);
      }
      // Compare each subpage against Home, using actual compositor matrices at identical times.
      if (page === 'home') proof.reference = frames;
      else for (let i=0;i<frames.length;i++) {
        for (const key of ['oldX','newX']) if (Math.abs(frames[i][key]-proof.reference[i][key])>1) {
          throw new Error('Subpage differs from Home '+key+': '+JSON.stringify({record,frames,reference:proof.reference}));
        }
        if ((frames[i].newZ>frames[i].oldZ)!==(order.indexOf(to)>order.indexOf(from))) {
          // Same condition; the failure now names its case and the measured layers so a device-only failure is diagnosable.
          const layers = await evaluate(`(() => {const z=n=>n&&{z:getComputedStyle(n).zIndex,inline:n.style.zIndex,position:getComputedStyle(n).position,cls:n.className};
            return {old:z(window.__sectionProofOld),home:z(document.querySelector('#home')),animations:(window.__sectionProofAnimations||[]).length,ua:navigator.userAgent.match(/Chrome\\/[0-9.]+/)?.[0]};})()`);
          throw new Error('Wrong section stacking order: '+JSON.stringify({record,frame:i,frames,layers}));
        }
      }
      await evaluate(`(() => {for(const a of window.__sectionProofAnimations)a.finish();window.__sectionProofSentinel.remove();})()`);
      await wait();
      const end=await evaluate(`({section:document.querySelector('.v35').dataset.section,home:!!document.querySelector('#home.active'),leftovers:document.querySelectorAll('.page-leaving,.section-page-layer,.layering').length})`);
      if(end.section!==to || !end.home || end.leftovers) throw new Error('Wrong destination '+JSON.stringify(end));
      proof.cases.push({...record,frames});
    }
  }
  delete proof.reference;
  // Latest rapid choice wins; switching away and back always lands on Home.
  await evaluate(`(() => {document.querySelector('[data-act="navTo"][data-arg="discover"]').click();for(const id of ['cinema','anime','manga'])document.querySelector('#secOpt-'+id).click();})()`);
  await wait();
  const rapid=await evaluate(`({section:document.querySelector('.v35').dataset.section,home:!!document.querySelector('#home.active')})`);
  if(rapid.section!=='manga'||!rapid.home)throw new Error('Rapid section selection failed');
  proof.rapid=rapid;
  await evaluate(`(() => {document.querySelector('[data-act="navTo"][data-arg="discover"]').click();document.querySelector('#secOpt-cinema').click();document.querySelector('[data-act="navTo"][data-arg="library"]').click();})()`);
  proof.interrupted=await evaluate(`!!document.querySelector('#library.active')&&!document.querySelector('.page-leaving,.section-page-layer,.layering')`);
  if(!proof.interrupted)throw new Error('Leaving during transition stranded a layer');

  await evaluate(`document.documentElement.dataset.motion='off'`);
  try {
    await evaluate(`(() => {document.querySelector('[data-act="navTo"][data-arg="library"]').click();document.querySelector('#secOpt-anime').click();})()`);
    proof.reduced=await evaluate(`!!document.querySelector('#home.active')&&!document.querySelector('.page-leaving,.section-page-layer,.layering')&&document.querySelector('.v35').dataset.section==='anime'`);
    if(!proof.reduced)throw new Error('Reduced motion did not settle synchronously');
  } finally {await evaluate(`delete document.documentElement.dataset.motion`);}
  proof.passed = true;
  return proof;
}
