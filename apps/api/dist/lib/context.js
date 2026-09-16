import { UchiyomiClient } from '@vantara/uchiyomi';
import { deriveKey } from "./crypto.js";
import { SESSION_COOKIE, SessionStore } from "./sessions.js";
export function buildContext(config) {
    const uchiyomi = new UchiyomiClient({
        baseUrl: config.UCHIYOMI_URL,
        ...(config.UCHIYOMI_SERVICE_TOKEN !== undefined
            ? { serviceToken: config.UCHIYOMI_SERVICE_TOKEN }
            : {}),
    });
    const sessions = new SessionStore({
        key: deriveKey(config.SESSION_SECRET, 'session-token'),
        ttlDays: config.SESSION_TTL_DAYS,
        uchiyomi,
    });
    return { config, uchiyomi, sessions };
}
/**
 * يرفض الطلب بـ401 إذا لم تكن هناك جلسة صالحة.
 *
 * الرسالة واحدة في كل الحالات — كوكي مفقود، منتهي، مُبطل، أو معدَّل — حتى لا
 * يفرّق المهاجم بين "لا توجد جلسة" و"جلسة انتهت".
 */
export function requireSession(ctx) {
    return async function (request, reply) {
        const cookie = request.cookies[SESSION_COOKIE];
        if (!cookie) {
            await reply.code(401).send({ error: 'unauthorized' });
            return;
        }
        const session = await ctx.sessions.resolve(cookie);
        if (!session) {
            void reply.clearCookie(SESSION_COOKIE, { path: '/' });
            await reply.code(401).send({ error: 'unauthorized' });
            return;
        }
        request.session = session;
        // اللمسة لا تعيق الطلب؛ فشلها لا يُسقِطه
        void ctx.sessions.touch(session.id).catch(() => { });
    };
}
/** الجلسة بعد أن ضمنها requireSession. يرمي إن استُخدم بلا الحارس. */
export function sessionOf(request) {
    const session = request.session;
    if (!session)
        throw new Error('route is missing the requireSession guard');
    return session;
}
export { SESSION_COOKIE };
//# sourceMappingURL=context.js.map