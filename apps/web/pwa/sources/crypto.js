/**
 * فك «حامي الفصول» في قوالب Madara (CryptoJS AES بمفتاح OpenSSL EVP_BytesToKey
 * من MD5). WebCrypto لا يقدّم MD5، فهنا تطبيق صغير له.
 */

function md5(bytes) {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(off + i * 4, true);
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}

export function md5Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return [...md5(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hexBytes = (hex) => Uint8Array.from(String(hex).match(/../g) ?? [], (h) => parseInt(h, 16));
const b64Bytes = (b64) => Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0));

/** CryptoJS.AES.decrypt({ct, s}, password) بالنص الواضح UTF-8. */
export async function decryptCryptoJs({ ct, s }, password) {
  const salt = hexBytes(s);
  const pass = new TextEncoder().encode(password);
  let derived = new Uint8Array(0);
  let prev = new Uint8Array(0);
  while (derived.length < 48) {
    const input = new Uint8Array(prev.length + pass.length + salt.length);
    input.set(prev);
    input.set(pass, prev.length);
    input.set(salt, prev.length + pass.length);
    prev = md5(input);
    const next = new Uint8Array(derived.length + prev.length);
    next.set(derived);
    next.set(prev, derived.length);
    derived = next;
  }
  const key = await crypto.subtle.importKey('raw', derived.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: derived.slice(32, 48) }, key, b64Bytes(ct));
  return new TextDecoder().decode(plain);
}
