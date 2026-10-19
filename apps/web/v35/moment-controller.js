import { openMomentViewer } from './moment-viewer.js';
import { momentOf } from './moment-media.js';
import { createMomentSourceResolver } from '../lib/moment-sources.js';
import { exportBrowserMoment } from '../lib/moment-export.js';

/** One shared receiving flow; all source credentials and temporary files stay on this device. */
export function createMomentController({ engine, desktop = globalThis.VantaraDesktop, mediaUrl, friends = () => [],
  onEpisode, onWork, toast = () => {}, native = () => Boolean(globalThis.Capacitor?.isNativePlatform?.()), viewer = openMomentViewer }) {
  const resolveSources = createMomentSourceResolver({ engine, desktop });
  let active = null;
  const localUrls = new Set();
  function destroy() { active?.destroy(); active = null; for (const url of localUrls) URL.revokeObjectURL(url); localUrls.clear(); }
  async function localSource(row, source) {
    if (source?.session && source?.candidate) return source;
    const sources = await resolveSources(row);
    const own = sources.find(s => s.session && s.candidate);
    if (!own) throw new Error('no_local_source');
    return own.prepare ? { ...own, ...await own.prepare() } : own;
  }
  async function saveVideo({ row, source, startMs, endMs, filename }) {
    if (desktop?.exportMoment) {
      source = await localSource(row, source);
      if (!source.exportHandle && source.prepare) source = { ...source, ...await source.prepare() };
      const args = { session: source.session, ...(source.exportHandle ? { exportHandle: source.exportHandle } : {}) };
      const saved = await desktop.exportMoment({ ...args, startMs, endMs, filename, action: 'save' });
      if (!saved?.saved) throw new Error('export_failed');
      if (desktop.readMoment) {
        const file = await desktop.readMoment(args);
        const binary = atob(file.base64 ?? '');
        if (!binary.length || binary.length > 16 * 1024 * 1024) throw new Error('invalid_export');
        const blob = new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], {type:'video/mp4'});
        const url = URL.createObjectURL(blob); localUrls.add(url);
        return {url,clipped:true};
      }
      return saved;
    }
    if (native()) {
      source = await localSource(row, source);
      const result = await engine.exportMoment({session:source.session,candidate:source.candidate,startMs,endMs,filename,action:'save'});
      if (!result?.saved) throw new Error('export_failed');
      return result;
    }
    const result = await exportBrowserMoment({source,startMs,endMs,filename});
    localUrls.add(result.url);
    return result;
  }
  async function playNative({row,source}) {
    if (!native() || !source?.session || !source.candidate) return false;
    const moment = momentOf(row); if(!moment)return false;
    const ref=String(row.series_ref),cinema=ref.startsWith('cinema:');
    return engine.open({session:source.session,candidate:source.candidate,title:row.series_title || 'لقطة',
      animeId:ref.slice(cinema?7:6),section:cinema?'cinema':'anime',episode:moment.episode??row.chapter_number??1,
      position:moment.startMs,clipStart:moment.startMs,clipEnd:moment.endMs,momentMini:true,
      poster:row.cover_url??null,friends:friends(),total:1});
  }
  return {
    resolveSources,
    open(row) { destroy(); active = viewer({row,mediaUrl,resolveSources,playNative,saveVideo,onEpisode,onWork,toast}); return active; },
    handleBack() { return active?.handleBack?.() ?? false; },
    destroy,
  };
}
