/**
 * إذن الصور والفيديو.
 *
 * `<img>` و`<video>` لا يرسلان ترويسة Authorization، فالوسائط تأخذ في
 * رابطها «إذنًا» قصيرًا يصدره الجالب لمن دخل بتوكن صحيح. الإذن موقّع بمفتاح
 * مشتق من سر الهوية بعنوان مختلف (`vantara-fetch-grant`)، فلا يصلح توكنَ دخول
 * ولا يصلح التوكنُ إذنًا. لا يحمل الجهاز ولا يكشف شيئًا غير المستخدم ونهاية
 * الصلاحية.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const GRANT_TTL_MS = 12 * 60 * 60 * 1000;
const PURPOSE = 'vantara-fetch-grant:v1';

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

// مثبّت على ArrayBuffer: crypto.subtle يطلب BufferSource لا SharedArrayBuffer
function unb64url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function key(secret: string) {
  // مفتاح الإذن = HMAC(سر الهوية، الغرض): مشتق ومنفصل عن مفتاح توكن الدخول
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = new Uint8Array(await crypto.subtle.sign('HMAC', base, encoder.encode(PURPOSE)));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function mintGrant(userId: string, secret: string, now = Date.now()): Promise<{ grant: string; expiresAt: number }> {
  const exp = now + GRANT_TTL_MS;
  const body = b64url(encoder.encode(JSON.stringify({ u: userId, e: exp })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)));
  return { grant: `${body}.${b64url(sig)}`, expiresAt: exp };
}

export async function verifyGrant(grant: unknown, secret: string, now = Date.now()): Promise<string | null> {
  if (typeof grant !== 'string' || !secret || grant.length > 512) return null;
  const [body, sig] = grant.split('.');
  if (!body || !sig) return null;
  const signature = unb64url(sig);
  const payload = unb64url(body);
  if (!signature || !payload) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await key(secret), signature, encoder.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const { u, e } = JSON.parse(decoder.decode(payload)) as { u?: unknown; e?: unknown };
    if (typeof u !== 'string' || !u || typeof e !== 'number' || now >= e || e - now > GRANT_TTL_MS) return null;
    return u;
  } catch {
    return null;
  }
}
