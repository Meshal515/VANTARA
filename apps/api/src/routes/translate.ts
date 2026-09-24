import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession, type AppContext } from '../lib/context.ts';

/**
 * الترجمة المرئية: وكيلٌ إلى عامل الترجمة (Python) على جهاز البيت.
 *
 * الجوال يرسل الصفحة (JPEG/WebP base64) وبيانات الفصل، والعامل يكشف الفقاعات
 * ويقرأ النص ويبيّض ويكتب العربي ويرجع الصفحة المترجمة صورةً مع المناطق.
 * اللغة والسياق (Luna) عند sync-worker: العامل يمرّر توكن المستخدم كما وصل
 * في `Authorization`، فالحدّ الأسبوعي والقاموس يبقيان مع الحساب لا مع الجهاز.
 *
 * لماذا هنا لا مباشرةً إلى العامل: نفس الجلسة ونفس CORS ونفس النفق، والعامل
 * يبقى غير معروض على الإنترنت إلا من هذا الخادم.
 */

const body = z.object({
  image: z.object({
    mediaType: z.enum(['image/jpeg', 'image/webp', 'image/png']).default('image/jpeg'),
    data: z.string().min(1).max(12 * 1024 * 1024),
  }),
  seriesRef: z.string().min(1).max(200),
  seriesTitle: z.string().max(200).nullish(),
  chapterKey: z.string().max(250).nullish(),
  chapterNumber: z.number().nullish(),
  pageIndex: z.number().int().min(0).max(100_000).default(0),
  sourceLang: z.enum(['en', 'ja', 'ko', 'zh', 'auto']).default('auto'),
  pageHash: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
  debug: z.boolean().default(false),
});

export async function translateRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const worker = ctx.config.TRANSLATION_WORKER_URL?.replace(/\/+$/, '');

  app.post(
    '/v1/translate/page',
    {
      preHandler: requireSession(ctx),
      // صفحة كاملة base64: أوسع من حدّ الجسم العام (1MB)
      bodyLimit: 16 * 1024 * 1024,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!worker) return reply.code(503).send({ error: 'translation_not_configured' });
      const parsed = body.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
      const bearer = request.headers.authorization;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      try {
        const res = await fetch(`${worker}/translate/page`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(bearer ? { authorization: bearer } : {}) },
          body: JSON.stringify(parsed.data),
          signal: controller.signal,
        });
        const text = await res.text();
        if (res.status === 413 || res.status === 400) return reply.code(400).send({ error: 'bad_image' });
        if (!res.ok) {
          request.log.warn({ status: res.status }, 'translation worker failed');
          return reply.code(502).send({ error: 'translation_worker' });
        }
        return reply.header('content-type', 'application/json; charset=utf-8').send(text);
      } catch (error) {
        request.log.warn({ err: error }, 'translation worker unreachable');
        return reply.code(503).send({ error: 'translation_worker_offline' });
      } finally {
        clearTimeout(timer);
      }
    },
  );

  /** هل العامل حيّ؟ القارئ يسأل مرة قبل أن يعرض زرّ الترجمة. */
  app.get('/v1/translate/health', { preHandler: requireSession(ctx) }, async (_request, reply) => {
    if (!worker) return reply.send({ ok: false, reason: 'translation_not_configured' });
    try {
      const res = await fetch(`${worker}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return reply.send({ ok: false, reason: `http_${res.status}` });
      const health = (await res.json()) as Record<string, unknown>;
      return reply.send({ ok: true, ...health });
    } catch {
      return reply.send({ ok: false, reason: 'offline' });
    }
  });
}
