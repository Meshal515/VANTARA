'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { apkSignerFingerprints, requireSignedBy } = require('./apk-signature.cjs');

// مولّدة لهذا الاختبار (apksigner، مفاتيح اختبار لا تُستعمل في غيره): RSA بمخطط v2، وEC بمخطط v3
const RSA = fs.readFileSync(path.join(__dirname, 'test-fixtures/signed-rsa-v2.apk'));
const EC = fs.readFileSync(path.join(__dirname, 'test-fixtures/signed-ec-v3.apk'));
const RSA_CERT = '6b1ece4bb5d452286d30e5427fa41285dd4735efe47fb078efc5dc2558b7e46e';
const EC_CERT = '6bd590b318c4c96c88f312ca31f23083b1d5babd41dd12e8139257b6ce789c0c';

test('v2 (RSA) and v3 (EC) signatures verify and yield the certificate SHA-256', () => {
  assert.deepEqual(apkSignerFingerprints(RSA), [RSA_CERT]);
  assert.deepEqual(apkSignerFingerprints(EC), [EC_CERT]);
  assert.deepEqual(requireSignedBy(RSA, RSA_CERT.toUpperCase().match(/../g).join(':')), [RSA_CERT]);
});

test('a file signed by another key is refused with the repository message', () => {
  assert.throws(() => requireSignedBy(RSA, EC_CERT), /توقيع الإضافة لا يطابق مفتاح المستودع/);
  assert.throws(() => requireSignedBy(RSA, 'not-a-fingerprint'), /بصمة المستودع غير صالحة/);
});

test('any byte changed after signing is refused (content, central directory, signature)', () => {
  const at = (buf, i) => { const t = Buffer.from(buf); t[i] ^= 0x01; return t; };
  // كتلة التوقيع في هذا الملف تبدأ عند 4096، وزوج v2 عند 4116 بطول 1374 (يليه حشو 0x42726577 غير موقّع بالمعيار
  // نفسه، فلا يُختبر). الدليل المركزي عند 8192.
  const cd = RSA.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), 8192);
  for (const tampered of [at(RSA, 40), at(RSA, cd + 20), at(RSA, 4116 + 1300), at(RSA, 4116 + 200), at(EC, 40)]) {
    assert.throws(() => apkSignerFingerprints(tampered), /توقيع الإضافة غير صالح/);
  }
});

test('unsigned or non-zip input is refused, never trusted', () => {
  assert.throws(() => apkSignerFingerprints(Buffer.from('not a zip')), /الملف ليس ZIP|نهاية الدليل/);
  // ZIP عادي بلا كتلة توقيع: نهاية الدليل المركزي وحدها
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  assert.throws(() => apkSignerFingerprints(eocd), /لا كتلة توقيع|الدليل المركزي/);
});
