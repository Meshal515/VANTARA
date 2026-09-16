/** أنواع Uchiyomi REST المستخدمة فعليًا، مشتقة من openapi.yaml v0.34. */
export class UchiyomiError extends Error {
    status;
    code;
    path;
    constructor(message, status, code, path) {
        super(message);
        this.status = status;
        this.code = code;
        this.path = path;
        this.name = 'UchiyomiError';
    }
    /** الأخطاء العابرة: تستحق إعادة محاولة، بخلاف 4xx. */
    get retryable() {
        return this.status === 429 || this.status === 502 || this.status >= 503;
    }
}
//# sourceMappingURL=types.js.map