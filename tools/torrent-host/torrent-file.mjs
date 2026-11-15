// ملف .torrent: البصمة (infohash = SHA-1 لبايتات قاموس info الأصلية) والاسم والمتتبّعات، بلا مكتبات.
import { createHash } from 'node:crypto';

/** bencode: يعيد [القيمة، نهاية الموضع]؛ للقاموس info نحتفظ بحدوده لحساب البصمة على بايتاته الأصلية. */
function bdecode(buf, i = 0, spans = {}, depth = 0) {
  // صارم: ملف تالف يرمي خطأً واضحًا بدل حلقة لا تنتهي أو تكدّس
  if (depth > 64) throw new Error('bencode: nesting too deep');
  if (i >= buf.length) throw new Error('bencode: unexpected end');
  const c = buf[i];
  const until = (from, byte) => { const at = buf.indexOf(byte, from); if (at < 0) throw new Error('bencode: unterminated'); return at; };
  if (c === 0x69) { const e = until(i, 0x65); return [Number(buf.toString('latin1', i + 1, e)), e + 1]; }
  if (c === 0x6c) { const out = []; i++; while (buf[i] !== 0x65) { if (i >= buf.length) throw new Error('bencode: unexpected end'); const [v, n] = bdecode(buf, i, spans, depth + 1); out.push(v); i = n; } return [out, i + 1]; }
  if (c === 0x64) {
    const out = {}; i++;
    while (buf[i] !== 0x65) {
      if (i >= buf.length) throw new Error('bencode: unexpected end');
      const [k, n] = bdecode(buf, i, spans, depth + 1);
      if (!Buffer.isBuffer(k)) throw new Error('bencode: dictionary key is not a string');
      const key = k.toString('latin1'), start = n;
      const [v, m] = bdecode(buf, n, spans, depth + 1);
      if (key === 'info' && !spans.info) spans.info = [start, m];
      out[key] = v; i = m;
    }
    return [out, i + 1];
  }
  if (c < 0x30 || c > 0x39) throw new Error(`bencode: unexpected byte ${c} at ${i}`);
  const colon = until(i, 0x3a), len = Number(buf.toString('latin1', i, colon));
  if (!Number.isSafeInteger(len) || colon + 1 + len > buf.length) throw new Error('bencode: bad string length');
  return [buf.subarray(colon + 1, colon + 1 + len), colon + 1 + len];
}
export function torrentFacts(buf) {
  const spans = {}; const [root] = bdecode(buf, 0, spans);
  if (!spans.info) throw new Error('no info dictionary');
  const infoHash = createHash('sha1').update(buf.subarray(spans.info[0], spans.info[1])).digest('hex');
  const trackers = [...new Set([root.announce, ...(root['announce-list'] ?? []).flat()].filter(Boolean).map((x) => x.toString('utf8')))];
  return { infoHash, name: root.info.name.toString('utf8'), trackers };
}
