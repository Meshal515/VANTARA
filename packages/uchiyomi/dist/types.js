/** أنواع Uchiyomi REST المستخدمة فعليًا، مشتقة من openapi.yaml v0.34. */
export class UchiyomiError extends Error {
    status;
    code;
    path;
    // حقول صريحة لا parameter properties: strip-only mode في Node لا يدعمها
    constructor(message, status, code, path) {
        super(message);
        this.name = 'UchiyomiError';
        this.status = status;
        this.code = code;
        this.path = path;
    }
    /** الأخطاء العابرة: تستحق إعادة محاولة، بخلاف 4xx. */
    get retryable() {
        return this.status === 429 || this.status === 502 || this.status >= 503;
    }
}
//# sourceMappingURL=types.js.map