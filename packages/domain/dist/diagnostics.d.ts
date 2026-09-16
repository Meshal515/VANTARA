/**
 * تنقية diagnostics البلاغات.
 *
 * البلاغ يرفق حالة النظام تلقائيًا، وهذا مفيد — وخطر. هذه الطبقة تضمن أن
 * ما يُخزَّن لا يحمل كوكيز ولا توكنات ولا ترويسات مصادقة، حتى لو أرسلها العميل.
 */
/**
 * ينسخ القيمة مع إسقاط كل مفتاح محظور وتنقية كل نص.
 * يقطع عند MAX_DEPTH حتى لا يعلّقه كائن دائري أو عميق.
 */
export declare function scrubDiagnostics(input: unknown, depth?: number): unknown;
/** فحص للاختبارات وللتأكيد قبل الكتابة: هل بقي سرّ ظاهر؟ */
export declare function containsSecret(value: unknown): boolean;
//# sourceMappingURL=diagnostics.d.ts.map