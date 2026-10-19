import { momentRange } from './anime-engine.js';

const parse = text => { try { return JSON.parse(text ?? '{}') ?? {}; } catch { return {}; } };
function publicUrl(value) {
  try {
    const u = new URL(value); const h=u.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || h==='localhost' || !h.includes('.') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(':')) return null;
    return u.href;
  } catch { return null; }
}
/** Resolve on the RECEIVING device; shared records never contain local proxy URLs or headers. */
export function createMomentSourceResolver({ engine, desktop = globalThis.VantaraDesktop }) {
  return async function resolve(row) {
    const moment=parse(row.moment_json); const ref=String(row.series_ref ?? '');
    const range=momentRange(row.chapter_label) ?? (Number.isFinite(moment.startMs) && moment.endMs>moment.startMs ? moment : null);
    if (!range) return [];
    const hints=Array.isArray(moment.sources) ? moment.sources : [];
    const attached=hints.flatMap(h=>publicUrl(h.url) ? [{url:publicUrl(h.url),type:h.mimeType,title:h.title,sourceId:h.sourceId,server:h.server}] : []);
    const anime=ref.startsWith('anime:'); const parts=ref.split(':'); const id=parts[1];
    if (!id || (!anime && parts[0]!=='cinema')) return attached;
    const episode=Number(moment.episode ?? row.chapter_number) || 1;
    const identity={canonicalId:ref,kind:anime?'anime':parts[2]?'series':'movie',externalIds:anime?{anilist:Number(id)}:{imdb:id},episode,...(!anime?{season:Number(parts[2])||null}:{})};
    let session;
    try {
      const work=await engine.findWork([row.series_title]).catch(()=>null);
      const copies=work?.copies ?? [];
      const out=await engine.prepare({copies,identity,episode:!anime&&!parts[2]?-1:episode,quality:1080,preferredSourceId:hints[0]?.sourceId,preferredServer:hints[0]?.server});
      session=out?.session;
      if (!session) return attached;
      const best=await engine.best(session,null,30000);
      const list=await engine.momentCandidates(session) ?? [];
      const ranked=[...list].sort((a,b)=>Number(b.id===best?.candidate)-Number(a.id===best?.candidate));
      const own=[];const handles=[];let released=false;
      const release=async()=>{if(released)return;released=true;for(const handle of handles)await Promise.resolve(desktop?.releaseMoment?.({session,exportHandle:handle})).catch(()=>{});await engine.closeSession(session);};
      for(const c of ranked.slice(0,12)) {
        let url=c.url,exportHandle;
        if(desktop?.prepareMoment) {
          try { const ready=await desktop.prepareMoment({session,candidate:c});url=ready.url;exportHandle=ready.exportHandle;if(exportHandle)handles.push(exportHandle); } catch { continue; }
        }
        if(!url || (!desktop && !publicUrl(url))) continue;
        own.push({...c,url,session,candidate:c.id,exportHandle,nativeCandidate:true,release,type:c.type??c.mimeType??(c.container==='HLS'?'application/vnd.apple.mpegurl':c.container==='DASH'?'application/dash+xml':undefined)});
      }
      if(!own.length)await release();
      return [...attached,...own];
    } catch {
      if(session)await engine.closeSession(session).catch(()=>{});
      return attached;
    }
  };
}
