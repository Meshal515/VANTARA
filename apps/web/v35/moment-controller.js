import { openMomentViewer } from './moment-viewer.js';
import { acquireMomentSources, clearMomentSources, momentOf } from './moment-media.js';
import { createMomentSourceResolver } from '../lib/moment-sources.js';
import { exportBrowserMoment } from '../lib/moment-export.js';

/** One shared receiving flow; all source credentials and temporary files stay on this device. */
export function createMomentController({ engine, desktop = globalThis.VantaraDesktop, mediaUrl, friends = () => [],
  onEpisode, onWork, toast = () => {}, native = () => Boolean(globalThis.Capacitor?.isNativePlatform?.()), viewer = openMomentViewer }) {
  const resolveSources = createMomentSourceResolver({ engine, desktop });
  let active = null, currentScope = null;
  const check = (scope) => { if (scope.closed || scope.abort.signal.aborted) throw new DOMException('Moment closed', 'AbortError'); };
  function dispose(scope) {
    if (!scope || scope.closed) return;
    scope.closed = true; scope.abort.abort();
    for (const url of scope.urls) URL.revokeObjectURL(url); scope.urls.clear();
    clearMomentSources(resolveSources);
    if (currentScope === scope) { currentScope = null; active = null; }
  }
  function destroy() { const scope = currentScope, handle = active; active = null; handle?.destroy(); dispose(scope); }
  async function withLocalSource(scope, row, source, run) {
    check(scope); let lease = null;
    try {
      if (!source?.session || !source?.candidate) {
        lease = await acquireMomentSources(row, resolveSources, { signal: scope.abort.signal });
        check(scope); source = lease.sources.find(s => s.session && s.candidate);
        if (!source) throw new Error('no_local_source');
      }
      if (desktop?.exportMoment && !source.exportHandle && source.prepare) {
        source = { ...source, ...await source.prepare(), prepare: undefined }; check(scope);
      }
      return await run(source);
    } finally { lease?.release(); }
  }
  async function saveVideo(scope, { row, source, startMs, endMs, filename }) {
    check(scope);
    if (desktop?.exportMoment) return withLocalSource(scope, row, source, async (local) => {
      const args = { session: local.session, ...(local.exportHandle ? { exportHandle: local.exportHandle } : {}) };
      const saved = await desktop.exportMoment({ ...args, startMs, endMs, filename, action: 'save' }); check(scope);
      if (!saved?.saved) throw new Error('export_failed');
      if (desktop.readMoment) {
        const file = await desktop.readMoment(args); check(scope);
        const binary = atob(file.base64 ?? '');
        if (!binary.length || binary.length > 16 * 1024 * 1024) throw new Error('invalid_export');
        const blob = new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], {type:'video/mp4'});
        const url = URL.createObjectURL(blob); scope.urls.add(url);
        return {url,clipped:true};
      }
      return saved;
    });
    if (native()) return withLocalSource(scope, row, source, async (local) => {
      const result = await engine.exportMoment({session:local.session,candidate:local.candidate,startMs,endMs,filename,action:'save'}); check(scope);
      if (!result?.saved) throw new Error('export_failed'); return result;
    });
    const result = await exportBrowserMoment({source,startMs,endMs,filename,signal:scope.abort.signal});
    if (scope.closed) { if (result?.url) URL.revokeObjectURL(result.url); check(scope); }
    scope.urls.add(result.url); return result;
  }
  async function playNative(scope, {row,source}) {
    check(scope);
    if (!native() || !source?.session || !source.candidate) return false;
    const moment = momentOf(row); if(!moment)return false;
    const ref=String(row.series_ref),cinema=ref.startsWith('cinema:');
    const result = await engine.open({session:source.session,candidate:source.candidate,title:row.series_title || 'لقطة',
      animeId:ref.slice(cinema?7:6),section:cinema?'cinema':'anime',episode:moment.episode??row.chapter_number??1,
      position:moment.startMs,clipStart:moment.startMs,clipEnd:moment.endMs,momentMini:true,
      poster:row.cover_url??null,friends:friends(),total:1});
    check(scope); return result;
  }
  return {
    resolveSources,
    open(row) {
      destroy(); const scope = { abort: new AbortController(), closed: false, urls: new Set() }; currentScope = scope;
      const handle = viewer({row,mediaUrl,resolveSources,playNative:args=>playNative(scope,args),saveVideo:args=>saveVideo(scope,args),onEpisode,onWork,toast,onClose:()=>dispose(scope)});
      if (!scope.closed) active = handle; return handle;
    },
    handleBack() { const handled = active?.handleBack?.() ?? false; if (handled) dispose(currentScope); return handled; },
    destroy,
  };
}
