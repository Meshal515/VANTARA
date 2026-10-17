// فحص حقيقي على ويندوز: نفس services.mjs التي يشغّلها التطبيق، مع rqbit وmpv من الإصدار المنشور.
// 1) الشبكة: المصادر والإضافات عبر requestResource (DoH أولًا) ومقارنتها بـDNS النظام.
// 2) تورنت من أسراب عامة حقيقية: كل مرحلة بتوقيتها حتى أول إطار، ثم قفز للمنتصف.
// 3) تبديل السيرفر أثناء التشغيل (نفس الجلسة) كما يفعل switchSource في التطبيق.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../apps/desktop/src/services.mjs';

const [native, reportPath] = process.argv.slice(2);
const t0 = Date.now(), at = () => Date.now() - t0;
const report = { started: new Date().toISOString(), network: [], torrents: [], switch: null };
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2));
const binaries = { rqbit: join(native, 'rqbit.exe'), mpv: join(native, 'mpv.exe') };
const listeners = new Set();
const make = async dnsOverHttps => createDesktopServices({ userData: await mkdtemp(join(tmpdir(), 'vantara-probe-')), binaries, dnsOverHttps, onEvent: e => { for (const fn of listeners) fn(e); }, firstFrameRecoveryMs: 60000, firstFrameFailureMs: 90000 });

// ---------- 1) الشبكة ----------
const sources = JSON.parse(await readFile(new URL('../apps/web/anime/sources.json', import.meta.url), 'utf8')).sources.filter(s => s.enabled !== false);
const targets = [
  ['Torrentio manifest', 'https://torrentio.strem.fun/manifest.json'],
  ['Torrentio فيلم', 'https://torrentio.strem.fun/stream/movie/tt0111161.json'],
  ['Torrentio مسلسل', 'https://torrentio.strem.fun/stream/series/tt0903747:1:1.json'],
  ['Torrentio أنمي', 'https://torrentio.strem.fun/stream/series/kitsu:11469:1.json'],
  ['Cinemeta', 'https://v3-cinemeta.strem.io/meta/movie/tt0111161.json'],
  ['OpenSubtitles', 'https://opensubtitles-v3.strem.io/manifest.json'],
  ...sources.map(s => [`مصدر ${s.id}`, s.domains.current.replace(/\/?$/, '/')]),
];
const doh = await make(true), plain = await make(false);
for (const [name, url] of targets) {
  const row = { name, url };
  for (const [key, svc] of [['doh', doh], ['system', plain]]) {
    const start = Date.now();
    try { const r = await svc.requestResource({ url, timeout: 20000, limit: 4 * 1024 * 1024 }); row[key] = { status: r.status, bytes: r.text?.length ?? 0, ms: Date.now() - start, cf: /just a moment|cf-chl|attention required/i.test(r.text ?? '') }; }
    catch (e) { row[key] = { error: e.message, ms: Date.now() - start }; }
  }
  report.network.push(row); console.log('NET', JSON.stringify(row)); await save();
}
await plain.close();

// ---------- 2) مرشحات التورنت ----------
const trackers = ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce', 'udp://tracker.torrent.eu.org:451/announce', 'udp://exodus.desync.com:6969/announce'].map(t => `tracker:${t}`);
const candidates = [];
for (const label of ['Torrentio فيلم', 'Torrentio مسلسل', 'Torrentio أنمي']) {
  const row = report.network.find(r => r.name === label);
  try {
    const text = (await doh.requestResource({ url: row.url, timeout: 20000 })).text;
    const streams = JSON.parse(text).streams ?? [];
    const seeded = streams.map(s => ({ s, seeds: Number(/👤\s*(\d+)/.exec(s.title ?? '')?.[1] ?? 0) })).sort((a, b) => b.seeds - a.seeds);
    for (const { s, seeds } of seeded.slice(0, 2)) candidates.push({ name: `${label} · ${seeds} زارع · ${(s.title ?? '').split('\n')[0].slice(0, 60)}`, candidate: { infoHash: s.infoHash, fileIdx: s.fileIdx, sources: (s.sources ?? []).filter(x => /^(tracker:|dht:)/.test(x)).slice(0, 40) } });
  } catch (e) { report.torrents.push({ name: label, skipped: `تعذر جلب قائمة Torrentio: ${e.message}` }); }
}
for (const [name, infoHash] of [['Sintel (Blender)', '08ada5a7a6183aae1e09d831df6748d566095a10'], ['Big Buck Bunny (Blender)', 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'], ['Tears of Steel (Blender)', '209c8226b299b308beaf2b9cd3fb49212dbd13ec']])
  candidates.push({ name, candidate: { infoHash, sources: trackers } });

async function play(svc, session, entry, { budgetMs = 240000, seek = true } = {}) {
  const r = { name: entry.name, infoHash: entry.candidate.infoHash, stages: [], samples: [] };
  const started = at();
  let ready, failed;
  const done = new Promise(resolve => {
    const fn = e => {
      if (e.session !== session) return;
      if (e.type === 'playback/stage' || e.type === 'playback/retrying') r.stages.push({ t: at() - started, stage: e.stage ?? 'retrying', ...(e.fileIdx != null ? { fileIdx: e.fileIdx } : {}), ...(e.bytes ? { mb: Math.round(e.bytes / 1048576) } : {}) });
      if (e.type === 'playback/progress' && (e.peers != null || e.downloadSpeed != null) && r.samples.length < 400) r.samples.push({ t: at() - started, peers: e.peers, kbps: e.downloadSpeed != null ? Math.round(e.downloadSpeed / 1024) : null });
      if (e.type === 'playback/ready') { ready = at() - started; resolve(); }
      if (e.type === 'playback/error') { failed = e.message; resolve(); }
      if (e.type === 'playback/progress' && e.position != null) r.lastPosition = e.position, r.duration = e.duration;
    };
    listeners.add(fn); r.off = () => listeners.delete(fn);
  });
  const timer = new Promise(resolve => setTimeout(resolve, budgetMs));
  const start = svc.startPlayback({ session, candidate: entry.candidate, title: entry.name, position: 0 }).catch(e => { failed ??= e.message; });
  await Promise.race([Promise.all([start, done]), timer]);
  r.firstFrameMs = ready ?? null; r.failure = failed ?? (ready == null ? `لا إطار خلال ${budgetMs / 1000} ث` : null);
  if (ready != null && seek) {
    await new Promise(res => setTimeout(res, 4000));
    const target = Math.round((r.duration ?? 600000) / 2), s0 = at();
    try {
      await svc.playbackCommand({ session, command: 'seek', value: target });
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline && !(r.lastPosition > target + 1500)) await new Promise(res => setTimeout(res, 250));
      r.seekMs = r.lastPosition > target + 1500 ? at() - s0 : null; if (r.seekMs == null) r.seekFailure = 'لم يتقدم التشغيل بعد القفز خلال 90 ث';
    } catch (e) { r.seekFailure = e.message; }
  }
  r.off(); delete r.off; r.passed = ready != null && (!seek || r.seekMs != null);
  return r;
}

for (const [i, entry] of candidates.entries()) {
  console.log('TORRENT start', entry.name);
  const r = await play(doh, `probe-${i}`, entry);
  await doh.stopPlayback({ session: `probe-${i}` }).catch(() => {});
  report.torrents.push(r); console.log('TORRENT', JSON.stringify({ ...r, samples: r.samples.filter((_, k) => k % 10 === 0) })); await save();
}

// ---------- 3) تبديل السيرفر أثناء التشغيل ----------
const good = report.torrents.filter(r => r.passed).map(r => candidates.find(c => c.candidate.infoHash === r.infoHash)).filter(Boolean);
if (good.length >= 2) {
  const a = await play(doh, 'switch', good[0], { seek: false });
  const b = a.firstFrameMs != null ? await play(doh, 'switch', good[1], { seek: false }) : null;
  report.switch = { from: a.name, fromFrameMs: a.firstFrameMs, to: b?.name ?? null, toFrameMs: b?.firstFrameMs ?? null, failure: b?.failure ?? a.failure, stages: b?.stages };
  await doh.stopPlayback({ session: 'switch' }).catch(() => {});
} else report.switch = { skipped: 'أقل من مرشحين ناجحين' };
console.log('SWITCH', JSON.stringify(report.switch));
report.finished = new Date().toISOString(); await save();
await doh.close();
process.exit(0);
