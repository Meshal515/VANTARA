/** APK PlaybackBudgets parity. Starts before engine/metadata; progress cannot renew startup. */
export function createPlaybackBudget({torrent=false,onTimeout}) {
  let decoded=false,disposed=false,paused=false,position,stalled,seekTarget=null;
  const startup=setTimeout(()=>expire('startup'),torrent?90000:15000);
  function expire(reason){if(disposed)return;dispose();onTimeout(reason);}
  function arm(){clearTimeout(stalled);if(decoded&&!paused&&!disposed)stalled=setTimeout(()=>expire('stalled'),torrent?35000:20000);}
  function update(value={}) {
    const moved=Number.isFinite(value.position)&&value.position!==position;
    const pauseChanged=typeof value.paused==='boolean'&&value.paused!==paused;
    if(Number.isFinite(value.position))position=value.position;
    if(typeof value.paused==='boolean')paused=value.paused;
    if(seekTarget!=null)return;
    if(moved||pauseChanged)arm();
  }
  function ready(value){if(decoded||disposed)return;decoded=true;clearTimeout(startup);update(value);arm();}
  function seek(target){if(!decoded||disposed||!Number.isFinite(target))return;seekTarget=target;clearTimeout(stalled);stalled=setTimeout(()=>expire('seek'),torrent?120000:30000);}
  function seekReady(value){if(seekTarget==null||disposed)return;seekTarget=null;update(value);arm();}
  function dispose(){disposed=true;clearTimeout(startup);clearTimeout(stalled);}
  return {ready,update,seek,seekReady,dispose};
}
