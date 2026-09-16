/**
 * مفتاح مشتق من SESSION_SECRET بـHKDF، مع info مختلفة لكل استخدام، حتى لا
 * يُستخدم نفس المفتاح لتشفير التوكنات وتوقيع الكوكيز.
 */
export declare function deriveKey(secret: string, info: string): Buffer;
/** يُرجع `nonce.tag.ciphertext` بـbase64url. */
export declare function encrypt(plaintext: string, key: Buffer): string;
export declare function decrypt(payload: string, key: Buffer): string;
/** معرّف جلسة: 256 بت عشوائية، لا تخمين ولا تسلسل. */
export declare function newSessionId(): string;
/** مقارنة بزمن ثابت لسلسلتين قد تختلفان طولًا. */
export declare function safeEqual(a: string, b: string): boolean;
//# sourceMappingURL=crypto.d.ts.map