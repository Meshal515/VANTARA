import type { FastifyReply, FastifyRequest } from 'fastify';
import { UchiyomiClient } from '@vantara/uchiyomi';
import type { Config } from './config.ts';
import { deriveKey } from './crypto.ts';
import { SESSION_COOKIE, SessionStore, type Session } from './sessions.ts';

export interface AppContext {
  config: Config;
  uchiyomi: UchiyomiClient;
  sessions: SessionStore;
}

export function buildContext(config: Config): AppContext {
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
export function requireSession(ctx: AppContext) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
    void ctx.sessions.touch(session.id).catch(() => {});
  };
}

/** الجلسة بعد أن ضمنها requireSession. يرمي إن استُخدم بلا الحارس. */
export function sessionOf(request: FastifyRequest): Session {
  const session = request.session;
  if (!session) throw new Error('route is missing the requireSession guard');
  return session;
}

export { SESSION_COOKIE };
