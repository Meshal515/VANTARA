/**
 * جلسة بلا كلمة مرور.
 *
 * VANTARA تطبيق خاص بين ثلاثة أشخاص، واختيار الحساب **هو** تسجيل الدخول. لا
 * كلمة مرور ولا PIN ولا إدخال معرّف. الجلسة تُنشأ خلف الكواليس فور اللمس.
 *
 * ما يعنيه ذلك صراحة: من يعرف عنوان الـWorker يستطيع أن يصكّ جلسة لأي من
 * الحسابات الثلاثة. هذا اختيار مقصود لا سهو — الاحتكاك الصفري كان المطلوب،
 * والمكشوف هو نشاط قراءة ثلاثة أصدقاء. ما يحدّه:
 *
 *   - لا إنشاء حسابات: المعرّفات الثلاثة في قاعدة البيانات هي كل ما يُقبل.
 *   - العنوان غير منشور في أي مكان عام.
 *   - تدوير VANTARA_SESSION_SECRET يُبطل كل التوكنات فورًا.
 *
 * ولا سرّ داخل الـAPK: التوقيع يحدث هنا بمفتاح لا يملكه العميل، والعميل يحمل
 * التوكن الناتج فقط.
 */

const encoder = new TextEncoder();

/** سنة: نحن نزيل الاحتكاك، وإعادة الدخول كل أسبوع احتكاك. */
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface TokenPayload {
  uid: string;
  iat: number;
  exp: number;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// النوع مُثبَّت على ArrayBuffer لا ArrayBufferLike: crypto.subtle يطلب
// BufferSource، وSharedArrayBuffer لا يُقبل فيه
function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function mintToken(userId: string, secret: string, now = Date.now()): Promise<string> {
  const payload: TokenPayload = { uid: userId, iat: now, exp: now + TOKEN_TTL_MS };
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(body));
  return `${body}.${base64urlEncode(new Uint8Array(signature))}`;
}

/**
 * يعيد الـuser_id أو null.
 *
 * التحقق بـcrypto.subtle.verify لا بمقارنة نصية: المقارنة النصية تُسرّب طول
 * البادئة المطابقة زمنيًا.
 */
export async function verifyToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await keyFor(secret),
      base64urlDecode(signature),
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as TokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now) return null;
  return payload.uid;
}

/** التوكن من ترويسة Authorization. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
