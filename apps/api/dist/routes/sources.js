import { z } from 'zod';
import { query, queryOne } from '@vantara/db';
import { looksRelevant, usableForReading, usableForSearch, verdictFrom, } from '@vantara/domain';
import { requireSession, sessionOf } from "../lib/context.js";
export async function sourceRoutes(app, ctx) {
    /**
     * مزامنة سجل المصادر مع ما يراه Uchiyomi.
     *
     * المصدر الجديد يُسجَّل REGISTERED_NOT_TESTED. لا يُرفع إلى SUPPORTED إلا
     * بدليل من `/v1/sources/:id/probe` — هذه هي قاعدة "لا Supported بلا evidence".
     */
    app.post('/v1/sources/sync', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const session = sessionOf(request);
        const user = await ctx.uchiyomi.me(session.token);
        if (user.role !== 'admin')
            return reply.code(403).send({ error: 'admin_only' });
        const sources = await ctx.uchiyomi.listSources(session.token);
        let added = 0;
        for (const source of sources) {
            const row = await queryOne(`INSERT INTO vantara_source_verdicts (source_id, source_name, lang)
              VALUES ($1, $2, $3)
         ON CONFLICT (source_id)
         DO UPDATE SET source_name = EXCLUDED.source_name, lang = EXCLUDED.lang
         RETURNING (xmax = 0) AS inserted`, [source.id, source.name, source.lang]);
            if (row?.inserted)
                added++;
        }
        const status = await ctx.uchiyomi.extensionStatus(session.token).catch(() => null);
        return reply.send({ total: sources.length, added, engine: status });
    });
    app.get('/v1/sources', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const onlyUsable = request.query.usable === 'true';
        const rows = await query(`SELECT source_id, source_name, lang, verdict, evidence, tested_at, last_success_at, notes
         FROM vantara_source_verdicts
        ORDER BY verdict, source_name`);
        const content = rows
            .map((row) => ({
            id: row.source_id,
            name: row.source_name,
            lang: row.lang,
            verdict: row.verdict,
            testedAt: row.tested_at,
            lastSuccessAt: row.last_success_at,
            notes: row.notes,
            usableForReading: usableForReading(row.verdict),
            usableForSearch: usableForSearch(row.verdict),
            hasEvidence: Object.keys(row.evidence).length > 0,
        }))
            .filter((row) => !onlyUsable || row.usableForReading);
        return reply.send({ content });
    });
    app.get('/v1/sources/:id/evidence', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const row = await queryOne(`SELECT * FROM vantara_source_verdicts WHERE source_id = $1`, [id]);
        if (!row)
            return reply.code(404).send({ error: 'not_found' });
        return reply.send({
            id: row.source_id,
            verdict: row.verdict,
            testedAt: row.tested_at,
            evidence: row.evidence,
        });
    });
    /**
     * تسجيل نتيجة فحص المعيار الخمسي.
     *
     * الفحص نفسه يجري في وظيفة خلفية (`source.probe`) لأنه يستغرق دقائق على
     * مصادر بطيئة؛ هذا المسار يتلقّى الدليل ويحسب الحكم منه.
     */
    app.put('/v1/sources/:id/evidence', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const session = sessionOf(request);
        const user = await ctx.uchiyomi.me(session.token);
        if (user.role !== 'admin')
            return reply.code(403).send({ error: 'admin_only' });
        const probe = z.object({
            popular: z.object({ ok: z.boolean(), count: z.number().optional(), error: z.string().optional() }),
            search: z.object({
                ok: z.boolean(),
                count: z.number().optional(),
                relevant: z.boolean().optional(),
                error: z.string().optional(),
            }),
            chapters: z.object({ ok: z.boolean(), count: z.number().optional(), error: z.string().optional() }),
            pagesOldest: z.object({ ok: z.boolean(), count: z.number().optional(), error: z.string().optional() }),
            pagesNewest: z.object({ ok: z.boolean(), count: z.number().optional(), error: z.string().optional() }),
            imagesDecoded: z.object({
                ok: z.boolean(),
                types: z.array(z.string()).optional(),
                error: z.string().optional(),
            }),
        });
        const parsed = probe.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'bad_request', detail: parsed.error.issues });
        }
        const evidence = parsed.data;
        const verdict = verdictFrom(evidence);
        const row = await queryOne(
        // $2 يُستخدم في سياقَي نوع مختلفين، فالتحويل الصريح ضروري وإلا فشل الاستدلال
        `UPDATE vantara_source_verdicts
          SET verdict = $2::source_verdict,
              evidence = $3::jsonb,
              tested_at = now(),
              last_success_at = CASE WHEN $2::source_verdict = 'SUPPORTED'
                                     THEN now() ELSE last_success_at END
        WHERE source_id = $1
        RETURNING verdict`, [id, verdict, JSON.stringify(evidence)]);
        if (!row)
            return reply.code(404).send({ error: 'not_found' });
        await query(`INSERT INTO vantara_audit_log (actor_id, action, target, detail)
       VALUES ($1, 'source.verdict', $2, $3)`, [session.userId, id, JSON.stringify({ verdict })]);
        return reply.send({ id, verdict });
    });
    /**
     * بحث VANTARA.
     *
     * ثلاثة فروق عن Uchiyomi الخام:
     *  1. المصادر غير الصالحة للبحث تُستبعد من النتائج (SEARCH_BROKEN تضخّ ضجيجًا).
     *  2. الأعمال المحذوفة للجميع تُحجب.
     *  3. الأعمال الممنوعة بالسياسة تُحجب.
     */
    app.get('/v1/search', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const parsed = z
            .object({ q: z.string().min(1).max(200) })
            .safeParse(request.query);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const q = parsed.data.q;
        const grouped = await ctx.uchiyomi.searchAll(q, sessionOf(request).token);
        const [searchable, deleted, blocked] = await Promise.all([
            query(`SELECT source_id FROM vantara_source_verdicts WHERE verdict = 'SUPPORTED'`),
            query(`SELECT series_ref FROM vantara_deleted_works WHERE restored_at IS NULL`),
            query(`SELECT source_id, series_ref FROM vantara_content_policy
          WHERE rule IN ('BLOCK_SOURCE', 'BLOCK_SERIES')`),
        ]);
        const allowedSources = new Set(searchable.map((r) => r.source_id));
        const deletedRefs = new Set(deleted.map((r) => r.series_ref));
        const blockedSources = new Set(blocked.map((r) => r.source_id).filter((v) => v !== null));
        const blockedSeries = new Set(blocked.map((r) => r.series_ref).filter((v) => v !== null));
        // سجل فارغ ⇒ لا نحجب شيئًا: تشغيل أول بلا sync يجب أن يبحث لا أن يصمت
        const filterSources = allowedSources.size > 0;
        const content = grouped
            .map((group) => ({
            ...group,
            providers: group.providers.filter((provider) => !blockedSources.has(provider.source) &&
                (!filterSources || allowedSources.has(provider.source))),
        }))
            .filter((group) => group.providers.length > 0 &&
            !group.providers.some((p) => deletedRefs.has(p.sourceId) || blockedSeries.has(p.sourceId)));
        return reply.send({
            content,
            /** تشخيص: هل البحث ضيّق بسبب مصادر غير مختبرة؟ */
            meta: {
                query: q,
                groupsBeforeFilter: grouped.length,
                groupsAfterFilter: content.length,
                searchableSources: allowedSources.size,
                relevanceHint: looksRelevant(q, grouped.map((g) => g.title)),
            },
        });
    });
}
//# sourceMappingURL=sources.js.map