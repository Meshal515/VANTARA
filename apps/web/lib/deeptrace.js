/**
 * DeepTrace «تقرير الذهب»: يحوّل أحداث الجلسة إلى مسار حرج من الضغط، ثم ينزل في أطول مرحلة إلى سببها بالأرقام،
 * ويقول أين اتُّخذ القرار في الكود، وبأي ثقة، وما الدليل الناقص إن لم يُحسم. لا تخمين: ما لا دليل عليه «غير معروف».
 *
 * المدخل (ويندوز اليوم، والمنصات الأخرى بالشكل نفسه): { tapMs, trace: [{ stage, ms, mode, waitMs, detail }], app }
 *  - tapMs: من الضغط حتى فتح الجلسة (ساعة الواجهة)، وtrace بساعة الخدمات منسوبة إلى source-selected.
 * المخرج: { phases, bottleneck, secondary, integrity, verdict } و goldReport() نصًا.
 */

/** مراحل المسار الحرج بالترتيب، وحدث نهاية كل منها (أول ما يوجد من البدائل). */
export const PHASES = [
  { id: 'metadata', ar: 'Metadata التورنت', end: ['magnet-metadata-complete', 'engine-metadata'] },
  { id: 'first-byte', ar: 'أول بايت', end: ['range-first-byte', 'http-first-byte'] },
  { id: 'container', ar: 'قراءة الحاوية', end: ['container-metadata-ready'] },
  { id: 'decoded', ar: 'حتى أول إطار مفكوك', end: ['decoder-output'] },
  { id: 'advancing', ar: 'حتى تقدّم التشغيل', end: ['playback-advancing'] },
];

/** سبب الانتظار في المحرك: رمزه، ومعناه، وأين يُتخذ القرار (ملف ودالة حقيقيان؛ لا أرقام أسطر لا تُقاس هنا). */
export const CAUSES = {
  notRequestedMs: { code: 'WAIT_BLOCK_REQUEST', ar: 'الكتلة المطلوبة لم تُطلب من أي مشارك (الجدولة)', where: 'tools/torrent-host/vantara-torrent.cpp: Engine::reposition (الأولويات والمواعيد) ← libtorrent src/torrent.cpp: request_time_critical_pieces' },
  chokedMs: { code: 'WAIT_UNCHOKE', ar: 'كل المشاركين المتصلين يخنقوننا', where: 'libtorrent src/peer_connection.cpp (الخنق من المشارك)' },
  requestedMs: { code: 'WAIT_BLOCK_RESPONSE', ar: 'طُلبت الكتلة ولم يرسلها المشارك بعد (الشبكة أو مشارك بطيء)', where: 'libtorrent src/peer_connection.cpp: incoming_piece (وصول الكتلة)' },
  diskWriteMs: { code: 'WAIT_DISK_WRITE', ar: 'الكتلة وصلت وتُكتب على القرص', where: 'libtorrent disk I/O (mmap_disk_io)' },
  verifyMs: { code: 'WAIT_PIECE_VERIFICATION', ar: 'القطعة كاملة وتنتظر التحقق', where: 'libtorrent: hash_piece ← vantara-torrent.cpp: Engine::waitPiece' },
  pieceReadMs: { code: 'WAIT_CACHE', ar: 'القطعة متحققة وتُقرأ من القرص', where: 'tools/torrent-host/vantara-torrent.cpp: Engine::waitPiece (read_piece)' },
  earlyGapMs: { code: 'WAIT_CONTIGUOUS_BLOCK', ar: 'الكتلة عند الموضع لم تُكتب بعد وما بعدها مكتوب (فجوة)', where: 'tools/torrent-host/vantara-torrent.cpp: Engine::waitEarly' },
  noPeerKnownMs: { code: 'WAIT_PEER_DISCOVERY', ar: 'لا مشارك معروف (المتتبعات وDHT لم تعطِ أحدًا)', where: 'libtorrent: tracker/DHT announce' },
  noPeerConnectedMs: { code: 'WAIT_PEER_HANDSHAKE', ar: 'مشاركون معروفون ولا اتصال قائم', where: 'libtorrent: connect_peer ← vantara-torrent.cpp: Engine::add' },
  unsampledMs: { code: 'UNKNOWN', ar: 'انتظار قصير قبل أول عيّنة (لم يُقس سببه)', where: null },
  unknownMs: { code: 'UNKNOWN', ar: 'تعذّر سؤال المحرك عن الحالة', where: null },
};

const META_SEGMENTS = [
  { code: 'WAIT_PEER_DISCOVERY', ar: 'اكتشاف أول مشارك (متتبعات وDHT)', from: null, to: 'peerKnownMs', where: 'libtorrent: tracker/DHT announce ← vantara-torrent.cpp: Engine::add (المتتبعات العامة)' },
  { code: 'WAIT_PEER_HANDSHAKE', ar: 'الاتصال بأول مشارك', from: 'peerKnownMs', to: 'peerConnectedMs', where: 'libtorrent: connect_peer (peer_connect_timeout)' },
  { code: 'WAIT_METADATA', ar: 'تبادل Metadata مع المشاركين المتصلين', from: 'peerConnectedMs', to: 'metadataMs', where: 'libtorrent: ut_metadata ← vantara-torrent.cpp: Engine::waitMetadata' },
];

export const CONFIDENCE_AR = { CONFIRMED: 'مؤكد', STRONGLY_SUPPORTED: 'مدعوم بقوة', POSSIBLE: 'محتمل', UNKNOWN: 'غير معروف' };

function confidence(coverage, share) {
  if (coverage >= 0.7 && share >= 0.7) return 'CONFIRMED';
  if (coverage >= 0.5 && share >= 0.5) return 'STRONGLY_SUPPORTED';
  return coverage > 0 ? 'POSSIBLE' : 'UNKNOWN';
}

const at = (trace, names, after) => trace.find((e) => names.includes(e.stage) && e.ms >= after);

/** أين في الملف قرأ الطلب: الرأس، الذيل (فهرس الحاوية)، أو موضع التشغيل. */
function placeOf(cursor, fileBytes) {
  if (!Number.isFinite(cursor)) return null;
  if (cursor <= 2 * 1024 * 1024) return 'رأس الملف';
  if (Number.isFinite(fileBytes) && fileBytes > 0 && cursor >= fileBytes * 0.98) return 'ذيل الملف (الفهرس)';
  return 'موضع التشغيل';
}

/** المسار الحرج والاختناق والحكم. */
export function analyze({ tapMs = null, trace = [] } = {}) {
  const anchor = trace.find((e) => e.stage === 'source-selected');
  const integrity = [];
  if (!anchor) return { phases: [], bottleneck: null, secondary: [], integrity: ['لا حدث «اختيار المصدر»: لا مسار يُبنى'], verdict: 'UNKNOWN' };
  const base = anchor.ms;
  const tap = Number.isFinite(tapMs) ? tapMs : 0;
  if (!Number.isFinite(tapMs)) integrity.push('زمن الضغط غير معروف: المدد من فتح الجلسة لا من الضغط');
  const fileBytes = trace.find((e) => e.stage === 'file-selected')?.detail?.fileBytes;
  const waits = new Map(trace.filter((e) => e.stage === 'range-wait').map((e) => [e.detail?.requestId, e.detail]));
  const firstBytes = trace.filter((e) => e.stage === 'range-first-byte');
  const cacheWaits = trace.filter((e) => e.stage === 'player-cache-wait-end');

  const phases = [{ id: 'source', ar: 'تجهيز المصدر (من الضغط)', start: -tap, end: 0, ms: tap, evidence: [] }];
  let prev = 0;
  for (const p of PHASES) {
    const e = at(trace, p.end, -Infinity);
    if (!e) { if (p.id !== 'metadata') integrity.push(`لا حدث نهاية لمرحلة «${p.ar}» (${p.end.join(' أو ')})`); continue; }
    const end = Math.max(prev, e.ms - base);
    phases.push({ id: p.id, ar: p.ar, start: prev, end, ms: end - prev, beforeTap: e.ms < base, evidence: [] });
    prev = end;
  }

  // الأدلة لكل مرحلة
  for (const ph of phases) {
    if (ph.id === 'metadata') {
      const m = trace.find((e) => e.stage === 'engine-metadata');
      const d = m?.detail ?? {};
      if (ph.beforeTap) ph.cause = { code: 'PREWARM', ar: 'Metadata كانت جاهزة قبل الضغط (تسخين)', share: 1, coverage: 1, confidence: 'CONFIRMED' };
      else if (m?.mode === 'reused') ph.cause = { code: 'ENGINE_REUSED', ar: 'التورنت كان في المحرك (تسخين أو دفء): Metadata من قبل', share: 1, coverage: 1, confidence: 'CONFIRMED' };
      else if (Number.isFinite(d.metadataMs)) {
        const segs = META_SEGMENTS.map((s) => ({ ...s, ms: Math.max(0, (d[s.to] ?? d.metadataMs) - (s.from ? d[s.from] ?? 0 : 0)) }))
          .filter((s) => Number.isFinite(s.ms));
        const total = segs.reduce((a, s) => a + s.ms, 0) || 1;
        segs.sort((a, b) => b.ms - a.ms);
        const top = segs[0];
        // المقاطع مقاسة مباشرة، لكن «أيها الاختناق» يُحكم بالقاعدة نفسها: مقطعان متقاربان لا يجعلان أحدهما «مؤكدًا»
        const coverage = Math.min(1, d.metadataMs / Math.max(1, ph.ms));
        ph.cause = { code: top.code, ar: top.ar, where: top.where, share: top.ms / total, coverage, confidence: confidence(coverage, top.ms / total) };
        ph.evidence = segs.map((s) => `${s.ar} ${Math.round(s.ms)}ms`);
        ph.evidence.push(`متتبعات: ${d.trackerReplies ?? 0} رد بـ${d.trackerPeers ?? 0} مشارك، ${d.trackerErrors ?? 0} خطأ · DHT: ${d.dhtReplies ?? 0} رد بـ${d.dhtPeers ?? 0} مشارك`);
        if (!Number.isFinite(d.peerKnownMs)) ph.evidence.push('أول مشارك معروف: لم يُسجَّل');
      } else if (ph.ms > 0) ph.cause = { code: 'UNKNOWN', ar: 'لا خط زمني من المحرك', share: 0, coverage: 0, confidence: 'UNKNOWN', needs: 'خط Metadata الزمني (vantara-torrent بهذا البناء أو أحدث؛ rqbit لا يعطيه)' };
      continue;
    }
    if (!['first-byte', 'container', 'decoded', 'advancing'].includes(ph.id)) continue;
    // طلبات وصل أول بايت لها داخل المرحلة: انتظارها كان فيها
    const reqs = firstBytes.filter((e) => e.ms - base > ph.start && e.ms - base <= ph.end + 1);
    const sum = {};
    let covered = 0;
    for (const r of reqs) {
      const w = waits.get(r.detail?.requestId);
      const where = placeOf(r.detail?.cursor, fileBytes);
      if (!w) {
        if (Number.isFinite(r.waitMs) && r.waitMs >= 50 && r.mode === 'torrent') integrity.push(`تفصيل انتظار الطلب ${r.detail?.requestId} ناقص (${Math.round(r.waitMs)}ms)`);
        continue;
      }
      covered += Math.min(w.totalMs ?? 0, ph.ms);
      for (const k of Object.keys(CAUSES)) if (w[k] > 0) sum[k] = (sum[k] ?? 0) + w[k];
      ph.evidence.push(`طلب ${w.requestId} (${where ?? '؟'}، القطعة ${w.piece}): ${Math.round(w.totalMs)}ms = ${Object.keys(CAUSES).filter((k) => w[k] > 0).sort((a, b) => w[b] - w[a]).map((k) => `${CAUSES[k].ar.split(' (')[0]} ${Math.round(w[k])}ms`).join(' + ')}`);
    }
    const cw = cacheWaits.filter((e) => e.ms - base > ph.start && e.ms - base <= ph.end + 1).reduce((a, e) => a + (e.waitMs ?? 0), 0);
    if (cw > 0) ph.evidence.push(`mpv متوقف ينتظر بيانات (paused-for-cache): ${Math.round(cw)}ms`);
    const keys = Object.keys(sum).sort((a, b) => sum[b] - sum[a]);
    const total = keys.reduce((a, k) => a + sum[k], 0);
    if (keys.length) {
      const top = CAUSES[keys[0]];
      const coverage = Math.min(1, covered / Math.max(1, ph.ms));
      ph.cause = { code: top.code, ar: top.ar, where: top.where, share: sum[keys[0]] / total, coverage, confidence: top.code === 'UNKNOWN' ? 'UNKNOWN' : confidence(coverage, sum[keys[0]] / total) };
      if (coverage < 0.7) ph.cause.needs = `${Math.round((1 - coverage) * 100)}% من المرحلة بلا انتظار محرك مقاس: ${cw > 0 ? 'mpv كان ينتظر بيانات لطلب لم يُفصَّل' : 'المشغّل (demuxer/decoder) لا يعطي سببه بعد'}`;
    } else if (ph.ms > 0) {
      ph.cause = cw > ph.ms * 0.5
        ? { code: 'WAIT_DEMUXER', ar: 'mpv متوقف ينتظر بيانات ولا انتظار محرك مسجل لها', share: 1, coverage: Math.min(1, cw / ph.ms), confidence: 'POSSIBLE', needs: 'تفصيل الطلب الذي كان mpv ينتظره' }
        : { code: 'UNKNOWN', ar: ph.id === 'decoded' ? 'لا انتظار بيانات مسجل: الفك أو تهيئة المشغّل' : 'لا دليل', share: 0, coverage: 0, confidence: 'UNKNOWN', needs: ph.id === 'decoded' ? 'حالة demuxer وdecoder في mpv (لم تُسجَّل بعد)' : 'أحداث هذه المرحلة' };
    }
  }

  const ranked = phases.filter((p) => p.ms > 0 && p.cause).sort((a, b) => b.ms - a.ms);
  const bottleneck = ranked[0] ?? null;
  integrity.push('أول صورة معروضة على الشاشة: غير مقاسة (mpv لا يعطيها عبر IPC هنا)');
  if (trace.length >= 256) integrity.push('سجل الجلسة امتلأ (256 حدثًا): سقطت أحداث قديمة');
  return { phases, bottleneck, secondary: ranked.slice(1, 3), integrity, verdict: bottleneck?.cause?.confidence ?? 'UNKNOWN', total: prev + tap };
}

const s = (ms) => `${(ms / 1000).toFixed(2)} ث`;
const pct = (x) => `${Math.round(x * 100)}%`;

/** «تقرير الذهب» نصًا: يُنسخ كما هو. */
export function goldReport(input) {
  const a = analyze(input);
  const app = input.app ?? {};
  const lines = ['VANTARA DEEPTRACE · تقرير الذهب v1', `البناء: ${app.version ?? '—'} · ${app.channel ?? '—'} · ${app.build ?? '—'} · ${app.sourceSha ? app.sourceSha.slice(0, 12) : '—'}`];
  if (!a.phases.length) return [...lines, ...a.integrity].join('\n');
  lines.push('', '[المسار الحرج من الضغط]');
  for (const p of a.phases) lines.push(`  ${p.ar}: ${s(p.ms)}${a.total > 0 ? ` (${pct(p.ms / a.total)})` : ''}${p.beforeTap ? ' · قبل الضغط' : ''}`);
  lines.push(`  المجموع (${a.phases.at(-1).ar}): ${s(a.total)}`);
  const b = a.bottleneck;
  lines.push('', '[الاختناق الرئيسي]');
  if (!b) lines.push('  لا مرحلة طويلة بدليل');
  else {
    lines.push(`  ${b.ar}: ${s(b.ms)}`, `  السبب: ${b.cause.ar} (${b.cause.code})`);
    if (b.cause.where) lines.push(`  أين يُتخذ القرار: ${b.cause.where}`);
    lines.push(`  الثقة: ${CONFIDENCE_AR[b.cause.confidence]} · تغطية الأدلة ${pct(b.cause.coverage)} · حصة السبب ${pct(b.cause.share)}`);
    for (const e of b.evidence) lines.push(`  دليل: ${e}`);
    if (b.cause.needs) lines.push(`  الدليل الناقص: ${b.cause.needs}`);
  }
  if (a.secondary.length) {
    lines.push('', '[اختناقات ثانوية]');
    for (const p of a.secondary) {
      lines.push(`  ${p.ar}: ${s(p.ms)} · ${p.cause.ar} (${CONFIDENCE_AR[p.cause.confidence]})`);
      for (const e of p.evidence.slice(0, 3)) lines.push(`    دليل: ${e}`);
    }
  }
  lines.push('', '[سلامة الأدلة]', ...a.integrity.map((x) => `  ${x}`));
  lines.push('', `[الحكم] ${b ? `${CONFIDENCE_AR[a.verdict]}: ${b.ar} بسبب ${b.cause.ar}` : 'غير معروف'}`);
  return lines.join('\n');
}
