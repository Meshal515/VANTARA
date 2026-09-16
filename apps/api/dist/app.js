import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, {} from 'fastify';
import { query } from '@vantara/db';
import { buildContext } from "./lib/context.js";
import { authRoutes } from "./routes/auth.js";
import { presenceRoutes } from "./routes/presence.js";
import { profileRoutes } from "./routes/profiles.js";
import { reportRoutes } from "./routes/reports.js";
import { socialRoutes } from "./routes/social.js";
import { sourceRoutes } from "./routes/sources.js";
export async function buildApp(config) {
    const app = Fastify({
        // في الاختبار نكتم السجل كليًا بدل تعطيل سجل الطلبات وحده
        logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
        // VANTARA يقف خلف Cloudflare Tunnel: العنوان الحقيقي يأتي في الترويسة
        trustProxy: true,
        bodyLimit: 1024 * 1024,
    });
    const ctx = buildContext(config);
    await app.register(helmet, {
        // الواجهة تُقدَّم من أصل آخر؛ CSP تُضبط هناك لا هنا
        contentSecurityPolicy: false,
    });
    await app.register(cookie, { secret: config.SESSION_SECRET });
    await app.register(rateLimit, {
        global: false,
        max: 300,
        timeWindow: '1 minute',
    });
    app.setErrorHandler((error, request, reply) => {
        const status = error.statusCode ?? 500;
        if (status >= 500) {
            // الأخطاء الداخلية تُسجَّل كاملة ولا يُعاد منها شيء للعميل
            request.log.error({ err: error }, 'request failed');
            return reply.code(status).send({ error: 'internal_error' });
        }
        return reply.code(status).send({ error: error.code ?? 'bad_request', message: error.message });
    });
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));
    /** حياة العملية. لا يلمس القاعدة — يجيب حتى وهي ساقطة. */
    app.get('/livez', async () => ({ ok: true }));
    /**
     * الجهوزية الحقيقية: القاعدة وUchiyomi.
     * يرجع 503 إذا سقط أحدهما، فـUptime Kuma يرى العطل لا يخمّنه.
     */
    app.get('/healthz', async (_request, reply) => {
        const [db, upstream] = await Promise.all([
            query('SELECT 1').then(() => true, () => false),
            ctx.uchiyomi.healthy(),
        ]);
        const ok = db && upstream;
        return reply.code(ok ? 200 : 503).send({ ok, db, uchiyomi: upstream });
    });
    await authRoutes(app, ctx);
    await profileRoutes(app, ctx);
    await presenceRoutes(app, ctx);
    await socialRoutes(app, ctx);
    await sourceRoutes(app, ctx);
    await reportRoutes(app, ctx);
    return { app, ctx };
}
//# sourceMappingURL=app.js.map