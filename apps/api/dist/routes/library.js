import { z } from 'zod';
import { query } from '@vantara/db';
import { UchiyomiError } from '@vantara/uchiyomi';
import { requireSession, sessionOf } from "../lib/context.js";
/** الصور تُقدَّم عبر VANTARA لا مباشرة: المتصفح يحمل كوكي مبهمًا، والتوكن عندنا. */
const IMAGE_KINDS = ['series-thumb', 'series-backdrop', 'book-thumb', 'page'];
const ALLOWED_IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
]);
export async function libraryRoutes(app, ctx) {
    const base = ctx.config.UCHIYOMI_URL.replace(/\/+$/, '');
    /** الأعمال المتابَعة، بعد حجب المحذوف للجميع. */
    app.get('/v1/library', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const session = sessionOf(request);
        const response = await fetch(`${base}/api/series/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok)
            return reply.code(502).send({ error: 'upstream_unavailable' });
        const payload = (await response.json());
        const series = payload.content ?? [];
        const deleted = new Set((await query(`SELECT series_ref FROM vantara_deleted_works WHERE restored_at IS NULL`)).map((row) => row.series_ref));
        return reply.send({
            content: series
                .filter((row) => !deleted.has(row.id))
                .map((row) => ({
                id: row.id,
                title: row.name,
                chapters: row.booksCount,
                unread: row.booksUnreadCount,
                inProgress: row.booksInProgressCount,
                accent: row.color ?? null,
                summary: row.metadata?.summary ?? null,
                status: row.metadata?.status ?? null,
            })),
        });
    });
    app.get('/v1/series/:id', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const session = sessionOf(request);
        const deleted = await query(`SELECT series_ref FROM vantara_deleted_works
        WHERE series_ref = $1 AND restored_at IS NULL`, [id]);
        // المحذوف للجميع يختفي من كل مسار، لا من البحث وحده
        if (deleted.length > 0)
            return reply.code(404).send({ error: 'not_found' });
        try {
            const [series, chapters] = await Promise.all([
                ctx.uchiyomi.series(id, session.token),
                ctx.uchiyomi.chapters(id, session.token).catch(() => []),
            ]);
            if (!series)
                return reply.code(404).send({ error: 'not_found' });
            return reply.send({ series, chapters });
        }
        catch (err) {
            if (err instanceof UchiyomiError && err.status === 404) {
                return reply.code(404).send({ error: 'not_found' });
            }
            throw err;
        }
    });
    /**
     * الفصول التي يعرضها المصدر ولم تُجلب بعد.
     *
     * العمل يُضاف بلا تنزيل (`chapterFrom: none`)، فقائمة المصدر هي كل ما نعرفه
     * عنه في البداية. بدون هذا المسار تبدو المكتبة فارغة وهي ليست كذلك.
     */
    app.get('/v1/series/:id/listing', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const session = sessionOf(request);
        const response = await fetch(`${base}/api/series/${encodeURIComponent(id)}/listing`, {
            headers: { Authorization: `Bearer ${session.token}` },
            signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok)
            return reply.code(502).send({ error: 'upstream_unavailable' });
        const payload = (await response.json());
        const listed = payload.content ?? [];
        return reply.send({
            checkedAt: payload.checkedAt ?? null,
            // الأحدث أولًا: هذا ما يريده القارئ المتابع
            content: [...listed].sort((a, b) => b.number - a.number).slice(0, 400),
        });
    });
    /**
     * يجلب فصولًا محددة عند الطلب.
     *
     * القراءة عند الطلب لا مرآة دائمة: نجلب ما يُقرأ الآن، لا الفصول الـ332.
     */
    app.post('/v1/series/:id/fetch', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const parsed = z
            .object({ numbers: z.array(z.number()).min(1).max(5) })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const session = sessionOf(request);
        const response = await fetch(`${base}/api/sources/fetch`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ seriesId: id, numbers: parsed.data.numbers }),
            signal: AbortSignal.timeout(180_000),
        });
        const payload = (await response.json().catch(() => null));
        if (!response.ok) {
            return reply.code(response.status === 404 ? 404 : 502).send({ error: 'fetch_failed', detail: payload });
        }
        return reply.send(payload);
    });
    /**
     * صفحات الفصل، مع موضع القراءة السابق.
     *
     * الأبعاد تأتي من upstream فيبني القارئ صندوقًا بنسبة أبعاد دقيقة لكل صفحة
     * قبل تحميلها — وهذا ما يمنع قفزة التخطيط في شرائح الويبتون الطويلة.
     */
    app.get('/v1/books/:id/pages', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const session = sessionOf(request);
        const [pages, book] = await Promise.all([
            ctx.uchiyomi.pages(id, session.token),
            ctx.uchiyomi.book(id, session.token).catch(() => undefined),
        ]);
        if (pages.length === 0)
            return reply.code(404).send({ error: 'no_pages' });
        return reply.send({
            content: pages.map((page) => ({
                number: page.number,
                width: page.width ?? null,
                height: page.height ?? null,
            })),
            pagesCount: book?.media?.pagesCount ?? pages.length,
            resumeAt: book?.readProgress?.page ?? null,
            completed: book?.readProgress?.completed ?? false,
        });
    });
    /** التقدم يُكتب عند Uchiyomi وحده (D-02) — هذا تمريرة لا كتابة. */
    app.put('/v1/books/:id/progress', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const parsed = z
            .object({ page: z.number().int().min(0).optional(), completed: z.boolean().optional() })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const session = sessionOf(request);
        await ctx.uchiyomi.setProgress(id, session.token, parsed.data);
        return reply.code(204).send();
    });
    /**
     * بروكسي الصور.
     *
     * يلزم لأن المتصفح يحمل كوكي VANTARA المبهم فقط، وصور Uchiyomi تحتاج توكنه.
     * ولأن التوكن يبقى عند الخادم، لا يمكن أن يُقرأ من الصفحة.
     *
     * لا يُعاد إلا ما يُثبت أنه صورة: مصدر يرجع صفحة تحدٍّ بترويسة HTML كان
     * سيصل للقارئ كصورة مكسورة بلا تفسير.
     */
    const streamImage = async (reply, token, path) => {
        const upstream = await fetch(`${base}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(60_000),
        });
        if (!upstream.ok || !upstream.body) {
            return reply.code(upstream.status === 404 ? 404 : 502).send({ error: 'image_unavailable' });
        }
        const type = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
        if (!ALLOWED_IMAGE_TYPES.has(type)) {
            return reply.code(502).send({ error: 'not_an_image', contentType: type });
        }
        const length = upstream.headers.get('content-length');
        if (length !== null)
            void reply.header('content-length', length);
        return reply
            .header('content-type', type)
            // الصفحة لا تتغير لنفس المعرّف؛ الكاش الخاص يجعل التمرير للخلف فوريًا
            .header('cache-control', 'private, max-age=86400, immutable')
            .send(upstream.body);
    };
    app.get('/v1/img/:kind/:id', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { kind, id } = request.params;
        if (!IMAGE_KINDS.includes(kind)) {
            return reply.code(400).send({ error: 'bad_request' });
        }
        const session = sessionOf(request);
        const encoded = encodeURIComponent(id);
        const maxWidth = z.coerce
            .number()
            .int()
            .min(64)
            .max(4096)
            .optional()
            .catch(undefined)
            .parse(request.query.maxWidth);
        const suffix = maxWidth !== undefined ? `?maxWidth=${String(maxWidth)}` : '';
        const paths = {
            'series-thumb': `/img/series/${encoded}/thumb`,
            'series-backdrop': `/img/series/${encoded}/backdrop`,
            'book-thumb': `/img/books/${encoded}/thumb`,
            page: '',
        };
        if (kind === 'page')
            return reply.code(400).send({ error: 'use /v1/img/page/:id/:n' });
        return streamImage(reply, session.token, paths[kind] + suffix);
    });
    app.get('/v1/img/page/:id/:n', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id, n } = request.params;
        const index = z.coerce.number().int().min(0).max(10_000).safeParse(n);
        if (!index.success)
            return reply.code(400).send({ error: 'bad_request' });
        const session = sessionOf(request);
        const maxWidth = z.coerce
            .number()
            .int()
            .min(64)
            .max(4096)
            .optional()
            .catch(undefined)
            .parse(request.query.maxWidth);
        const suffix = maxWidth !== undefined ? `?maxWidth=${String(maxWidth)}` : '';
        return streamImage(reply, session.token, `/img/books/${encodeURIComponent(id)}/page/${String(index.data)}${suffix}`);
    });
}
//# sourceMappingURL=library.js.map