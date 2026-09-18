import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { query } from '@vantara/db';
import type { Config } from './lib/config.ts';
import { buildContext, type AppContext } from './lib/context.ts';
import { registerCors } from './lib/cors.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { discoveryRoutes } from './routes/discovery.ts';
import { reportRoutes } from './routes/reports.ts';
import { libraryRoutes } from './routes/library.ts';
import { sourceRoutes } from './routes/sources.ts';

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildApp(config: Config): Promise<BuiltApp> {
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
  // الواجهة على الـAPK تعمل من `https://localhost`، فكل نداء cross-origin.
  // بلا هذا يفشل كل شيء عند الـpreflight ويبدو للمستخدم انقطاع شبكة.
  registerCors(app, config);
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      // الأخطاء الداخلية تُسجَّل كاملة ولا يُعاد منها شيء للعميل
      request.log.error({ err: error }, 'request failed');
      return reply.code(status).send({ error: 'internal_error' });
    }
    return reply.code(status).send({ error: error.code ?? 'bad_request', message: error.message });
  });

  /** حياة العملية. لا يلمس القاعدة — يجيب حتى وهي ساقطة. */
  app.get('/livez', async () => ({ ok: true }));

  /**
   * الجهوزية الحقيقية: القاعدة وUchiyomi.
   * يرجع 503 إذا سقط أحدهما، فـUptime Kuma يرى العطل لا يخمّنه.
   */
  app.get('/healthz', async (_request, reply) => {
    const [db, upstream] = await Promise.all([
      query('SELECT 1').then(
        () => true,
        () => false,
      ),
      ctx.uchiyomi.healthy(),
    ]);
    const ok = db && upstream;
    return reply.code(ok ? 200 : 503).send({ ok, db, uchiyomi: upstream });
  });

  await authRoutes(app, ctx);
  await sourceRoutes(app, ctx);
  await reportRoutes(app, ctx);
  await adminRoutes(app, ctx);
  // كان معرَّفًا وغير مسجَّل: إضافة عمل من البحث كانت تفشل بـ404 بينما مالك
  // المكتبة هو Uchiyomi وهذا مساره الوحيد للكتابة عنده
  await catalogRoutes(app, ctx);
  // عقد الشاشة للمكتبة والاستكشاف: صفحة واحدة لكل نداء، منفصل عن مسار التدقيق
  await discoveryRoutes(app, ctx);
  await libraryRoutes(app, ctx);

  // الواجهة تُقدَّم من نفس الأصل هنا أيضًا (الويب)، لكن الـAPK أصل آخر —
  // ولذلك CORS مُسجَّل أعلاه بقائمة بيضاء
  const webRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    process.env['VANTARA_WEB_ROOT'] ?? '../../web',
  );

  if (existsSync(join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: ['index.html'],
      // الإضافة تضع cache-control: max-age=0 من نفسها وتطغى على setHeaders،
      // فنعطّلها ونتولّى كل مسار بما يناسبه
      cacheControl: false,
      setHeaders(reply, path) {
        // الـservice worker لا يُكاش أبدًا: نسخة قديمة منه تُجمّد التطبيق على
        // قشرة قديمة ولا تصل التحديثات
        if (path.endsWith('/sw.js')) {
          reply.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
          reply.setHeader('service-worker-allowed', '/');
          return;
        }
        // الصفحة نفسها تُراجَع دائمًا: هي التي تحمل أسماء بقية الملفات
        if (path.endsWith('/index.html')) {
          reply.setHeader('cache-control', 'no-cache');
          return;
        }
        if (path.endsWith('.webmanifest')) {
          reply.setHeader('content-type', 'application/manifest+json; charset=utf-8');
          reply.setHeader('cache-control', 'public, max-age=3600');
          return;
        }
        // الخطوط والأيقونات ثابتة المحتوى
        if (/\.(woff2|png|svg|ico)$/.test(path)) {
          reply.setHeader('cache-control', 'public, max-age=604800');
          return;
        }
        // JS وCSS بلا بصمة في أسمائها، فبلا توجيه يكاشها المتصفح تخمينًا
        // ويخدم كودًا قديمًا. المراجعة كل مرة تكلّف 304 وتضمن الصحة.
        if (/\.(js|css)$/.test(path)) {
          reply.setHeader('cache-control', 'no-cache');
        }
      },
    });
    // التطبيق شاشة واحدة: أي مسار غير /v1 و/livez يُعيد الصفحة
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/v1/') || request.url.startsWith('/health')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn({ webRoot }, 'web assets not found — serving API only');
  }

  return { app, ctx };
}
