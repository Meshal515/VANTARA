import { expect, it } from 'vitest';
import { analyze, goldReport } from './deeptrace.js';

// أشكال عينات المالك (ويندوز 0.4.90) بأحداث الجلسة كما تصل اللوحة: ms بساعة الخدمات، والمسار من source-selected
const ev = (stage, ms, extra = {}) => ({ stage, ms, ...extra });

it('العينة 2: Metadata 28.5 ث، والاتصال بأول مشارك أخذ معظمها: مؤكد، بمكان القرار', () => {
  const trace = [
    ev('source-selected', 100, { mode: 'cold' }),
    ev('file-selected', 200, { detail: { fileBytes: 300e6 } }),
    ev('engine-metadata', 28600, { mode: 'cold', detail: { peerKnownMs: 400, peerConnectedMs: 27000, metadataMs: 28400, trackerReplies: 2, trackerPeers: 30, trackerErrors: 3, dhtReplies: 0, dhtPeers: 0 } }),
    ev('magnet-metadata-complete', 28600),
    ev('range-first-byte', 29300, { mode: 'torrent', waitMs: 600, detail: { requestId: 1, cursor: 0 } }),
    ev('range-wait', 29400, { detail: { requestId: 1, piece: 0, totalMs: 600, requestedMs: 600 } }),
    ev('container-metadata-ready', 30200), ev('decoder-output', 33400), ev('playback-advancing', 33600),
  ];
  const a = analyze({ tapMs: 40, trace });
  expect(a.bottleneck.id).toBe('metadata');
  expect(a.bottleneck.cause.code).toBe('WAIT_PEER_HANDSHAKE');
  expect(a.bottleneck.cause.confidence).toBe('CONFIRMED');
  expect(a.bottleneck.cause.where).toContain('connect_peer');
  const text = goldReport({ tapMs: 40, trace, app: { version: '0.4.91', channel: 'debug', build: 91, sourceSha: 'abcdef1234567890' } });
  expect(text).toContain('[الاختناق الرئيسي]');
  expect(text).toContain('Metadata التورنت: 28.50 ث');
  expect(text).toContain('السبب: الاتصال بأول مشارك (WAIT_PEER_HANDSHAKE)');
  expect(text).toContain('دليل: الاتصال بأول مشارك 26600ms');
  expect(text).toContain('متتبعات: 2 رد بـ30 مشارك، 3 خطأ');
  expect(text).toContain('[الحكم] مؤكد: Metadata التورنت بسبب الاتصال بأول مشارك');
});

it('العينة 3: انتظار أول بايت 12.2 ث مقسوم بالمحرك: «طُلبت ولم تصل» يغلب فالشبكة، مؤكد، والطلب ومكانه في الملف', () => {
  const trace = [
    ev('source-selected', 0, { mode: 'prewarmed' }),
    ev('file-selected', 10, { detail: { fileBytes: 1e9 } }),
    ev('engine-metadata', 3220, { mode: 'cold', detail: { peerKnownMs: 200, peerConnectedMs: 900, metadataMs: 3200 } }),
    ev('magnet-metadata-complete', 3220),
    ev('range-first-byte', 15780, { mode: 'torrent', waitMs: 12222, detail: { requestId: 1, cursor: 0 } }),
    ev('range-wait', 15800, { detail: { requestId: 1, piece: 0, totalMs: 12222, notRequestedMs: 509, requestedMs: 11000, diskWriteMs: 713 } }),
    ev('container-metadata-ready', 18130), ev('decoder-output', 22970), ev('playback-advancing', 23100),
  ];
  const a = analyze({ tapMs: 0, trace });
  expect(a.bottleneck.id).toBe('first-byte');
  expect(a.bottleneck.cause.code).toBe('WAIT_BLOCK_RESPONSE');
  expect(a.bottleneck.cause.confidence).toBe('CONFIRMED');
  expect(a.bottleneck.evidence[0]).toBe('طلب 1 (رأس الملف، القطعة 0): 12222ms = طُلبت الكتلة ولم يرسلها المشارك بعد 11000ms + الكتلة وصلت وتُكتب على القرص 713ms + الكتلة المطلوبة لم تُطلب من أي مشارك 509ms');
  // الثانوي: من الحاوية حتى الإطار (4.8 ث) بلا دليل ⇒ غير معروف بالدليل الناقص، لا تخمين
  const decoded = a.phases.find((p) => p.id === 'decoded');
  expect(decoded.cause.confidence).toBe('UNKNOWN');
  expect(decoded.cause.needs).toContain('demuxer');
});

it('العينة 1: 7.78 ث بين الحاوية وأول إطار: بلا انتظار مسجل «غير معروف» ويُسمّى الدليل الناقص؛ مع توقف mpv للبيانات «محتمل»', () => {
  const base = [
    ev('source-selected', 0, { mode: 'cold' }),
    ev('engine-metadata', 50, { mode: 'cold', detail: { peerKnownMs: 10, peerConnectedMs: 20, metadataMs: 50 } }),
    ev('magnet-metadata-complete', 50),
    ev('range-first-byte', 370, { mode: 'torrent', waitMs: 20, detail: { requestId: 1, cursor: 0 } }),
    ev('container-metadata-ready', 2520), ev('decoder-output', 10300), ev('playback-advancing', 10400),
  ];
  const a = analyze({ tapMs: 0, trace: base });
  expect(a.bottleneck.id).toBe('decoded');
  expect(a.bottleneck.cause.confidence).toBe('UNKNOWN');
  expect(goldReport({ tapMs: 0, trace: base })).toContain('الدليل الناقص: حالة demuxer وdecoder في mpv');
  const cached = analyze({ tapMs: 0, trace: [...base, ev('player-cache-wait-end', 9800, { waitMs: 6900 })] });
  expect(cached.bottleneck.cause.code).toBe('WAIT_DEMUXER');
  expect(cached.bottleneck.cause.confidence).toBe('POSSIBLE');
});

it('مسخّن قبل الضغط: Metadata قبل اختيار المصدر تُعلن «قبل الضغط» ولا تُحسب اختناقًا', () => {
  const a = analyze({ tapMs: 30, trace: [
    ev('engine-metadata', -2000, { mode: 'cold', detail: { peerKnownMs: 100, peerConnectedMs: 300, metadataMs: 2000 } }),
    ev('magnet-metadata-complete', -2000),
    ev('source-selected', 0, { mode: 'prewarmed' }),
    ev('range-first-byte', 400, { mode: 'torrent', waitMs: 300, detail: { requestId: 1, cursor: 0 } }),
    ev('range-wait', 420, { detail: { requestId: 1, piece: 0, totalMs: 300, requestedMs: 290 } }),
    ev('container-metadata-ready', 800), ev('decoder-output', 1200), ev('playback-advancing', 1300),
  ] });
  const meta = a.phases.find((p) => p.id === 'metadata');
  expect(meta.ms).toBe(0);
  expect(meta.beforeTap).toBe(true);
  expect(meta.cause.code).toBe('PREWARM');
  expect(a.bottleneck.id).not.toBe('metadata');
});

it('سلامة الأدلة: انتظار طويل بلا تفصيل، ومرحلة بلا حدث نهاية، وأول صورة معروضة غير مقاسة، تُعلن صراحة', () => {
  const a = analyze({ trace: [
    ev('source-selected', 0, { mode: 'cold' }),
    ev('magnet-metadata-complete', 100),
    ev('range-first-byte', 900, { mode: 'torrent', waitMs: 800, detail: { requestId: 4, cursor: 0 } }),
  ] });
  expect(a.integrity).toContain('تفصيل انتظار الطلب 4 ناقص (800ms)');
  expect(a.integrity.some((x) => x.includes('قراءة الحاوية'))).toBe(true);
  expect(a.integrity).toContain('زمن الضغط غير معروف: المدد من فتح الجلسة لا من الضغط');
  expect(a.integrity.some((x) => x.includes('أول صورة معروضة على الشاشة: غير مقاسة'))).toBe(true);
  expect(analyze({ trace: [] }).verdict).toBe('UNKNOWN');
});
