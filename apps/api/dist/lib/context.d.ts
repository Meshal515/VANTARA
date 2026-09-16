import type { FastifyReply, FastifyRequest } from 'fastify';
import { UchiyomiClient } from '@vantara/uchiyomi';
import type { Config } from './config.ts';
import { SESSION_COOKIE, SessionStore, type Session } from './sessions.ts';
export interface AppContext {
    config: Config;
    uchiyomi: UchiyomiClient;
    sessions: SessionStore;
}
export declare function buildContext(config: Config): AppContext;
declare module 'fastify' {
    interface FastifyRequest {
        session?: Session;
    }
}
/**
 * يرفض الطلب بـ401 إذا لم تكن هناك جلسة صالحة.
 *
 * الرسالة واحدة في كل الحالات — كوكي مفقود، منتهي، مُبطل، أو معدَّل — حتى لا
 * يفرّق المهاجم بين "لا توجد جلسة" و"جلسة انتهت".
 */
export declare function requireSession(ctx: AppContext): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
/** الجلسة بعد أن ضمنها requireSession. يرمي إن استُخدم بلا الحارس. */
export declare function sessionOf(request: FastifyRequest): Session;
export { SESSION_COOKIE };
//# sourceMappingURL=context.d.ts.map