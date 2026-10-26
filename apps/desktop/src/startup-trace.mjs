const numeric = new Set(['fileIdx','fileBytes','knownPeers','connectedPeers','speedBytes','checkedBytes','checkedPieces','requestedPiece','rangeStart','rangeEnd','cursor','bytes','waitMs','position','cacheBytesRead','requestId']);
const modes = new Set(['cold','replay-descriptor','cache','torrent','network','decoded','render-unmeasured','verified-head','engine-required']);
/** Device-local engineering events. Never accept URLs, titles, headers, paths,
 * account IDs or arbitrary strings, even when an upstream error includes them. */
export function createStartupTrace(publish, clock = () => performance.now()) {
  const started = clock(), events = [], once = new Set();
  let stopped = false;
  function record(stage, fields = {}, unique = false) {
    if (stopped || !/^[a-z][a-z0-9-]{0,63}$/.test(stage) || unique && once.has(stage)) return;
    once.add(stage);
    const event = { type:'playback/diagnostic',stage,elapsedMs:Math.max(0,Math.round((clock()-started)*1000)/1000) };
    for (const [key,value] of Object.entries(fields)) {
      if (numeric.has(key) && Number.isFinite(value) && value >= 0) event[key] = value;
      if (key === 'mode' && modes.has(value)) event.mode = value;
    }
    events.push(event); if(events.length>256)events.shift();
    publish(event);
  }
  return { record, once:(stage,fields)=>record(stage,fields,true), snapshot:()=>events.map(e=>({...e})), stop:()=>{stopped=true;} };
}
