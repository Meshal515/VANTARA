import { UchiyomiError, } from "./types.js";
/**
 * العميل الوحيد الذي يتكلم مع Uchiyomi.
 *
 * VANTARA لا يتكلم مع Suwayomi مباشرة (D-01) ولا يكتب تقدمًا من عنده (D-02):
 * `setProgress` هنا تمريرة إلى Uchiyomi، وليست كتابة في جداولنا.
 */
export class UchiyomiClient {
    #baseUrl;
    #serviceToken;
    #timeoutMs;
    #retries;
    #fetch;
    constructor(options) {
        this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.#serviceToken = options.serviceToken;
        this.#timeoutMs = options.timeoutMs ?? 30_000;
        this.#retries = options.retries ?? 2;
        this.#fetch = options.fetchImpl ?? globalThis.fetch;
    }
    async #request(path, options = {}) {
        const url = new URL(this.#baseUrl + path);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined)
                url.searchParams.set(key, String(value));
        }
        const token = options.token ?? this.#serviceToken;
        const headers = { Accept: 'application/json' };
        if (token)
            headers['Authorization'] = `Bearer ${token}`;
        if (options.body !== undefined)
            headers['Content-Type'] = 'application/json';
        let lastError;
        const maxAttempts = options.noRetry ? 0 : this.#retries;
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            // مهلة لكل محاولة على حدة، لا للعملية كلها
            const signal = AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs);
            try {
                const response = await this.#fetch(url, {
                    method: options.method ?? 'GET',
                    headers,
                    signal,
                    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
                });
                if (response.status === 404 && options.allow404)
                    return undefined;
                if (!response.ok) {
                    const detail = await this.#errorDetail(response);
                    const error = new UchiyomiError(detail.message ?? `${response.status} on ${path}`, response.status, detail.code, path);
                    // 4xx حقيقة ثابتة: لا فائدة من إعادة المحاولة
                    if (!error.retryable || attempt === maxAttempts)
                        throw error;
                    lastError = error;
                }
                else {
                    if (response.status === 204)
                        return undefined;
                    return (await response.json());
                }
            }
            catch (err) {
                if (err instanceof UchiyomiError && !err.retryable)
                    throw err;
                if (attempt === maxAttempts)
                    throw err;
                lastError = err;
            }
            // تراجع أُسّي: 200ms, 400ms, 800ms …
            await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
        }
        throw lastError instanceof Error ? lastError : new Error(`request to ${path} failed`);
    }
    async #errorDetail(response) {
        try {
            const body = (await response.json());
            return {
                ...(body.error !== undefined ? { code: body.error } : {}),
                ...(body.message ?? body.error ? { message: body.message ?? body.error } : {}),
            };
        }
        catch {
            return {};
        }
    }
    /** يرمي إذا كانت الاستجابة فارغة — للمسارات التي يجب أن تُرجع جسمًا. */
    async #require(path, options = {}) {
        const out = await this.#request(path, options);
        if (out === undefined)
            throw new UchiyomiError(`empty response`, 502, undefined, path);
        return out;
    }
    // ───────────────────────── الصحة والمصادقة ─────────────────────────
    async healthy() {
        try {
            await this.#request('/healthz', { timeoutMs: 5_000 });
            return true;
        }
        catch {
            return false;
        }
    }
    async needsSetup() {
        const out = await this.#require('/api/setup/status');
        return out.needsSetup;
    }
    /**
     * تحقق من بيانات الدخول عند Uchiyomi. VANTARA لا يخزّن كلمات مرور ولا يتحقق منها.
     */
    login(username, password) {
        return this.#require('/auth/login', {
            method: 'POST',
            body: { username, password },
            // Uchiyomi يحدّ معدّل هذا المسار؛ إعادة المحاولة تحرق الميزانية
            noRetry: true,
        });
    }
    me(token) {
        return this.#require('/auth/me', { token });
    }
    /**
     * يصكّ توكن `uy_…` طويل العمر باسم صاحب `sessionToken`.
     *
     * هذا ما يعفي VANTARA من دورة refresh: توكن الجلسة عند Uchiyomi يعيش 900
     * ثانية، أما هذا فيعيش بعمر جلسة VANTARA. السرّ يُرجَع مرة واحدة فقط.
     */
    mintToken(sessionToken, options) {
        return this.#require('/api/tokens', {
            method: 'POST',
            token: sessionToken,
            body: options,
        });
    }
    async revokeToken(sessionToken, tokenId) {
        await this.#request(`/api/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'DELETE',
            token: sessionToken,
            allow404: true,
        });
    }
    listUsers() {
        return this.#require('/api/admin/users');
    }
    // ───────────────────────────── المصادر ─────────────────────────────
    async listSources(token) {
        const out = await this.#require('/api/sources', token !== undefined ? { token } : {});
        return out.content;
    }
    /**
     * بحث عبر كل المصادر، مُجمّعًا بالعنوان مع `providers[]`.
     * هذا هو ما يجعل طبقة الهوية عندنا إثراءً لا بناءً — انظر RESULTS.md §3.
     */
    async searchAll(q, token) {
        const out = await this.#require('/api/sources/search-all', {
            query: { q },
            timeoutMs: 120_000,
            ...(token !== undefined ? { token } : {}),
        });
        return out.content;
    }
    /** بحث مسطّح: صف لكل مصدر، بلا تجميع. */
    async find(q, token) {
        const out = await this.#require('/api/sources/find', {
            query: { q },
            timeoutMs: 120_000,
            ...(token !== undefined ? { token } : {}),
        });
        return out.content;
    }
    /** ملاحظة: المعامل اسمه `sourceId` لا `id` — `id` يرجع 400. */
    sourceDetail(source, sourceId) {
        return this.#require('/api/sources/detail', {
            query: { source, sourceId },
            timeoutMs: 120_000,
        });
    }
    testSource(sourceId, token) {
        return this.#require(`/api/admin/sources/${encodeURIComponent(sourceId)}/test`, {
            method: 'POST',
            timeoutMs: 120_000,
            ...(token !== undefined ? { token } : {}),
        });
    }
    extensionStatus(token) {
        return this.#require('/api/admin/extensions/status', token !== undefined ? { token } : {});
    }
    // ─────────────────────── الأعمال والفصول والصفحات ───────────────────
    series(id, token) {
        return this.#request(`/api/series/${encodeURIComponent(id)}`, {
            allow404: true,
            ...(token !== undefined ? { token } : {}),
        });
    }
    async chapters(seriesId, token) {
        const out = await this.#require(`/api/series/${encodeURIComponent(seriesId)}/books`, token !== undefined ? { token } : {});
        return out.content;
    }
    /** نسخ الفصل من مصادر مختلفة — ChapterVariant الجاهز. */
    versions(seriesId, token) {
        return this.#require(`/api/series/${encodeURIComponent(seriesId)}/versions`, token !== undefined ? { token } : {});
    }
    /**
     * قائمة صفحات الفصل.
     *
     * upstream يرجع **مصفوفة مجرّدة** لا `{ content }` كبقية المسارات، وقراءتها
     * على أنها `{ content }` تعطي صفر صفحات بصمت. نتحمّل الشكلين.
     */
    async pages(bookId, token) {
        const out = await this.#require(`/api/books/${encodeURIComponent(bookId)}/pages`, token !== undefined ? { token } : {});
        return Array.isArray(out) ? out : out.content;
    }
    book(bookId, token) {
        return this.#request(`/api/books/${encodeURIComponent(bookId)}`, {
            allow404: true,
            ...(token !== undefined ? { token } : {}),
        });
    }
    /**
     * التقدم يُكتب هنا وهنا فقط (D-02). التوكن إلزامي: التقدم ملك مستخدم بعينه،
     * ولا يُكتب بتوكن خدمة.
     */
    async setProgress(bookId, token, update) {
        await this.#request(`/api/books/${encodeURIComponent(bookId)}/progress`, {
            method: 'PUT',
            token,
            body: update,
        });
    }
    history(token) {
        return this.#require('/api/history', { token });
    }
    stats(token) {
        return this.#require('/api/stats', { token });
    }
    rating(seriesId, token, value) {
        return this.#require(`/api/ratings/${encodeURIComponent(seriesId)}`, {
            method: 'PUT',
            token,
            body: { rating: value },
        });
    }
    /** عنوان صورة الصفحة. `pageNumber` 1-based. تُقدَّم عبر vantara-api. */
    pageImageUrl(bookId, pageNumber, maxWidth) {
        const url = new URL(`${this.#baseUrl}/img/books/${encodeURIComponent(bookId)}/page/${String(pageNumber)}`);
        if (maxWidth !== undefined)
            url.searchParams.set('maxWidth', String(maxWidth));
        return url.toString();
    }
}
//# sourceMappingURL=client.js.map