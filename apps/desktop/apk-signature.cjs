'use strict';
// تحقق توقيع APK (مخطط v2 وv3) في ويندوز قبل تسليم الإضافة لمحرك Suwayomi: نفس شرط الـAPK
// (UserExtensions.kt: «توقيع الإضافة لا يطابق مفتاح المستودع؛ لم تُثبَّت»). Suwayomi وحده لا يتحقق من
// التوقيع، فالتحقق هنا كاملًا: ملخص المحتوى (قطع 1MB) + التوقيع بالمفتاح العام + أن المفتاح هو مفتاح الشهادة،
// ثم بصمة SHA-256 للشهادة تُقارن ببصمة المستودع. أي خلل = رفض، لا تخمين.
// المرجع: https://source.android.com/docs/security/features/apksigning/v2 و v3
const crypto = require('node:crypto');

const MAGIC = Buffer.from('APK Sig Block 42', 'latin1');
const V2 = 0x7109871a;
const V3 = 0xf05368c0;
const CHUNK = 1024 * 1024;
// خوارزميات المخطط (بلا verity): الرقم ← [ملخص المحتوى، خوارزمية التوقيع]
const ALGORITHMS = Object.freeze({
  0x0101: { digest: 'sha256', kind: 'rsa-pss', salt: 32 },
  0x0102: { digest: 'sha512', kind: 'rsa-pss', salt: 64 },
  0x0103: { digest: 'sha256', kind: 'rsa' },
  0x0104: { digest: 'sha512', kind: 'rsa' },
  0x0201: { digest: 'sha256', kind: 'ec' },
  0x0202: { digest: 'sha512', kind: 'ec' },
  0x0301: { digest: 'sha256', kind: 'dsa' },
});

const fail = (why) => { throw Object.assign(new Error(`توقيع الإضافة غير صالح: ${why}`), { code: 'APK_SIGNATURE' }); };

/** قارئ بادئات الطول (uint32 LE) داخل كتلة التوقيع، بحدود صارمة. */
class Reader {
  constructor(buf) { this.buf = buf; this.at = 0; }
  get left() { return this.buf.length - this.at; }
  u32() { if (this.left < 4) fail('كتلة مبتورة'); const v = this.buf.readUInt32LE(this.at); this.at += 4; return v; }
  bytes(n) { if (n > this.left) fail('طول خارج الحدود'); const out = this.buf.subarray(this.at, this.at + n); this.at += n; return out; }
  prefixed() { return new Reader(this.bytes(this.u32())); }
  raw() { return this.bytes(this.u32()); }
  *items() { while (this.left > 0) yield this.prefixed(); }
}

/** حدود أقسام الـZIP: كتلة التوقيع والدليل المركزي ونهايته. */
function sections(apk) {
  if (apk.length < 22) fail('الملف ليس ZIP');
  let eocd = -1;
  for (let i = apk.length - 22; i >= Math.max(0, apk.length - 22 - 0xffff); i -= 1) {
    if (apk.readUInt32LE(i) === 0x06054b50 && i + 22 + apk.readUInt16LE(i + 20) === apk.length) { eocd = i; break; }
  }
  if (eocd < 0) fail('نهاية الدليل المركزي غير موجودة');
  const cdSize = apk.readUInt32LE(eocd + 12);
  const cdOffset = apk.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize !== eocd) fail('الدليل المركزي لا يلي كتلة التوقيع');
  if (cdOffset < 32 || !apk.subarray(cdOffset - 16, cdOffset).equals(MAGIC)) fail('لا كتلة توقيع APK (v2/v3)');
  const tail = apk.readBigUInt64LE(cdOffset - 24);
  const blockStart = cdOffset - Number(tail) - 8;
  if (tail > BigInt(cdOffset) || blockStart < 0 || apk.readBigUInt64LE(blockStart) !== tail) fail('حجم كتلة التوقيع لا يتطابق');
  const pairs = new Map();
  let at = blockStart + 8;
  while (at < cdOffset - 24) {
    if (at + 12 > cdOffset - 24) fail('زوج مبتور');
    const len = Number(apk.readBigUInt64LE(at));
    if (len < 4 || at + 8 + len > cdOffset - 24) fail('زوج خارج الحدود');
    pairs.set(apk.readUInt32LE(at + 8), apk.subarray(at + 12, at + 8 + len));
    at += 8 + len;
  }
  return { blockStart, cdOffset, cdSize, eocd, pairs };
}

/** ملخص المحتوى: القطع تُلخَّص كل منها ثم يُلخَّص مجموعها (الأقسام الثلاثة؛ نهاية الدليل بإزاحته قبل الكتلة). */
function contentDigest(apk, { blockStart, cdOffset, eocd }, algorithm) {
  const eocdCopy = Buffer.from(apk.subarray(eocd));
  eocdCopy.writeUInt32LE(blockStart, 16);
  const parts = [apk.subarray(0, blockStart), apk.subarray(cdOffset, eocd), eocdCopy];
  const chunks = [];
  for (const part of parts) {
    for (let at = 0; at < part.length; at += CHUNK) {
      const piece = part.subarray(at, Math.min(part.length, at + CHUNK));
      const head = Buffer.alloc(5); head[0] = 0xa5; head.writeUInt32LE(piece.length, 1);
      chunks.push(crypto.createHash(algorithm).update(head).update(piece).digest());
    }
  }
  const top = Buffer.alloc(5); top[0] = 0x5a; top.writeUInt32LE(chunks.length, 1);
  const hash = crypto.createHash(algorithm).update(top);
  for (const c of chunks) hash.update(c);
  return hash.digest();
}

function verifySignature(spec, publicKey, data, signature) {
  const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  const options = spec.kind === 'rsa-pss' ? { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: spec.salt } : { key };
  return crypto.verify(spec.digest, data, options, signature);
}

/** موقّع واحد من v2 أو v3: يرجع بصمة شهادته بعد التحقق الكامل. */
function signer(reader, scheme, apk, layout) {
  const signedRaw = reader.raw();
  if (scheme === V3) { reader.u32(); reader.u32(); }
  const signatures = [...reader.prefixed().items()].map((s) => ({ id: s.u32(), value: s.raw() }));
  const publicKey = reader.raw();
  const usable = signatures.filter((s) => ALGORITHMS[s.id]);
  if (!usable.length) fail('خوارزمية توقيع غير مدعومة');
  // الأقوى أولًا (sha512 قبل sha256) كما في apksig؛ كل توقيع مدعوم يجب أن يصح
  for (const s of usable) if (!verifySignature(ALGORITHMS[s.id], publicKey, signedRaw, s.value)) fail('التوقيع لا يصح بالمفتاح المعلن');
  const signed = new Reader(signedRaw);
  const digests = new Map([...signed.prefixed().items()].map((d) => [d.u32(), d.raw()]));
  const certificates = [...signed.prefixed().items()].map((c) => Buffer.from(c.buf));
  if (!certificates.length) fail('لا شهادة للموقّع');
  const cert = new crypto.X509Certificate(certificates[0]);
  const certKey = cert.publicKey.export({ type: 'spki', format: 'der' });
  if (!certKey.equals(publicKey)) fail('المفتاح العام لا يطابق الشهادة');
  const chosen = usable.map((s) => s.id).sort((a, b) => (ALGORITHMS[b].digest === 'sha512') - (ALGORITHMS[a].digest === 'sha512'))[0];
  const expected = digests.get(chosen);
  if (!expected) fail('ملخص المحتوى غائب لخوارزمية التوقيع');
  if (!contentDigest(apk, layout, ALGORITHMS[chosen].digest).equals(expected)) fail('محتوى الملف تغيّر بعد التوقيع');
  return crypto.createHash('sha256').update(certificates[0]).digest('hex');
}

/**
 * بصمات SHA-256 لشهادات موقّعي APK بعد التحقق الكامل من v3 (إن وجد) وإلا v2. يرمي إن لم يصح شيء.
 * مثل `apkSignerFingerprints` في الـAPK: الفحص بعدها `fingerprint in result`.
 */
function apkSignerFingerprints(apk) {
  const buf = Buffer.isBuffer(apk) ? apk : Buffer.from(apk);
  const layout = sections(buf);
  const scheme = layout.pairs.has(V3) ? V3 : layout.pairs.has(V2) ? V2 : null;
  if (!scheme) fail('لا توقيع v2 أو v3');
  const out = [];
  for (const one of new Reader(layout.pairs.get(scheme)).prefixed().items()) out.push(signer(one, scheme, buf, layout));
  if (!out.length) fail('لا موقّع');
  return out;
}

/** يرمي برسالة عربية إن لم يوقّع مفتاحُ المستودع الملف. */
function requireSignedBy(apk, fingerprint) {
  const want = String(fingerprint ?? '').toLowerCase().replace(/:/g, '');
  if (!/^[0-9a-f]{64}$/.test(want)) fail('بصمة المستودع غير صالحة');
  const got = apkSignerFingerprints(apk);
  if (!got.includes(want)) throw Object.assign(new Error('توقيع الإضافة لا يطابق مفتاح المستودع؛ لم تُثبَّت'), { code: 'APK_SIGNER_MISMATCH' });
  return got;
}

module.exports = { apkSignerFingerprints, requireSignedBy, contentDigest, sections };
