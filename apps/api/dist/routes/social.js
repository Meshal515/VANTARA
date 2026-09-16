import { z } from 'zod';
import { query, queryOne, transaction } from '@vantara/db';
import { maskSpoilers } from '@vantara/domain';
import { requireSession, sessionOf } from "../lib/context.js";
const seriesRef = z.string().min(1).max(200);
const commentBody = z.object({
    seriesRef,
    chapterRef: z.string().min(1).max(200).optional(),
    parentId: z.number().int().positive().optional(),
    body: z.string().min(1).max(4000),
    /** رقم الفصل الذي يُحجب التعليق قبله. */
    spoilerAfter: z.number().optional(),
});
const recommendBody = z.object({
    seriesRef,
    seriesTitle: z.string().max(400).optional(),
    /** اسم المستخدم المستهدف، أو "all" للجميع. */
    to: z.string().min(1).max(64),
    message: z.string().max(500).optional(),
});
async function logActivity(actorId, verb, seriesRefValue, payload = {}) {
    await query(`INSERT INTO vantara_activity_events (actor_id, verb, series_ref, payload)
     VALUES ($1, $2, $3, $4)`, [actorId, verb, seriesRefValue, JSON.stringify(payload)]);
}
export async function socialRoutes(app, ctx) {
    // ───────────────────────────── التعليقات ─────────────────────────────
    app.post('/v1/comments', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const parsed = commentBody.safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const input = parsed.data;
        const { userId } = sessionOf(request);
        // الرد يجب أن يكون على تعليق في نفس العمل، وإلا صار خيطًا معلّقًا
        if (input.parentId !== undefined) {
            const parent = await queryOne(`SELECT series_ref FROM vantara_comments WHERE id = $1 AND deleted_at IS NULL`, [input.parentId]);
            if (!parent)
                return reply.code(404).send({ error: 'parent_not_found' });
            if (parent.series_ref !== input.seriesRef) {
                return reply.code(400).send({ error: 'parent_series_mismatch' });
            }
        }
        const row = await queryOne(`INSERT INTO vantara_comments
         (author_id, target_type, series_ref, chapter_ref, parent_id, body, spoiler_after_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`, [
            userId,
            input.chapterRef !== undefined ? 'chapter' : 'series',
            input.seriesRef,
            input.chapterRef ?? null,
            input.parentId ?? null,
            input.body.trim(),
            input.spoilerAfter !== undefined ? String(input.spoilerAfter) : null,
        ]);
        await logActivity(userId, 'comment.created', input.seriesRef, { commentId: row?.id });
        return reply.code(201).send({ id: row?.id });
    });
    /**
     * تعليقات عمل، محجوبة حسب تقدم القارئ.
     *
     * التعليق المحجوب يبقى في القائمة معلَّمًا `masked: true` بلا نصّه — الواجهة
     * تعرض "اضغط لكشف". حجبه بالإخفاء من القائمة كان سيكشف وجوده بعدد التعليقات.
     */
    app.get('/v1/comments/:seriesRef', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { seriesRef: ref } = request.params;
        const progress = z.coerce
            .number()
            .optional()
            .safeParse(request.query.progress);
        const rows = await query(`SELECT c.id, u.username AS author, c.body, c.chapter_ref, c.spoiler_after_ref,
              c.parent_id, c.created_at, c.edited_at,
              (SELECT jsonb_object_agg(emoji, n) FROM (
                 SELECT emoji, count(*) AS n
                   FROM vantara_comment_reactions
                  WHERE comment_id = c.id
                  GROUP BY emoji
               ) AS agg) AS reactions
         FROM vantara_comments c
         JOIN vantara_users u ON u.uchiyomi_user_id = c.author_id
        WHERE c.series_ref = $1 AND c.deleted_at IS NULL
        ORDER BY c.created_at`, [ref]);
        const readerProgress = progress.success && progress.data !== undefined
            ? { number: progress.data, kind: 'numbered' }
            : undefined;
        const masked = maskSpoilers(rows, (row) => row.spoiler_after_ref === null
            ? undefined
            : { number: Number(row.spoiler_after_ref), kind: 'numbered' }, readerProgress);
        return reply.send({
            content: masked.map(({ comment, masked: hidden }) => ({
                id: comment.id,
                author: comment.author,
                parentId: comment.parent_id,
                chapterRef: comment.chapter_ref,
                createdAt: comment.created_at,
                editedAt: comment.edited_at,
                reactions: comment.reactions ?? {},
                masked: hidden,
                ...(hidden ? {} : { body: comment.body }),
            })),
        });
    });
    /** حذف تعليق: للكاتب فقط، وحذف ناعم حتى لا تنكسر الردود المعلّقة عليه. */
    app.delete('/v1/comments/:id', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const { userId } = sessionOf(request);
        const row = await queryOne(`UPDATE vantara_comments SET deleted_at = now()
        WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
        RETURNING id`, [id, userId]);
        if (!row)
            return reply.code(404).send({ error: 'not_found' });
        return reply.code(204).send();
    });
    app.put('/v1/comments/:id/reactions/:emoji', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id, emoji } = request.params;
        if ([...emoji].length > 4)
            return reply.code(400).send({ error: 'bad_request' });
        const { userId } = sessionOf(request);
        await query(`INSERT INTO vantara_comment_reactions (comment_id, uchiyomi_user_id, emoji)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, userId, emoji]);
        return reply.code(204).send();
    });
    app.delete('/v1/comments/:id/reactions/:emoji', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id, emoji } = request.params;
        const { userId } = sessionOf(request);
        await query(`DELETE FROM vantara_comment_reactions
        WHERE comment_id = $1 AND uchiyomi_user_id = $2 AND emoji = $3`, [id, userId, emoji]);
        return reply.code(204).send();
    });
    // ──────────────────────────── التوصيات ─────────────────────────────
    app.post('/v1/recommendations', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const parsed = recommendBody.safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const input = parsed.data;
        const session = sessionOf(request);
        let toId = null;
        if (input.to !== 'all') {
            const target = await queryOne(`SELECT uchiyomi_user_id FROM vantara_users WHERE username = $1`, [input.to]);
            if (!target)
                return reply.code(404).send({ error: 'recipient_not_found' });
            if (target.uchiyomi_user_id === session.userId) {
                return reply.code(400).send({ error: 'cannot_send_to_self' });
            }
            toId = target.uchiyomi_user_id;
        }
        const row = await queryOne(`INSERT INTO vantara_recommendations (from_id, to_id, series_ref, series_title, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [session.userId, toId, input.seriesRef, input.seriesTitle ?? null, input.message ?? null]);
        await logActivity(session.userId, 'recommendation.sent', input.seriesRef, {
            to: input.to,
            recommendationId: row?.id,
        });
        return reply.code(201).send({ id: row?.id });
    });
    /** صندوق التوصيات: الموجَّهة لي، والموجَّهة للجميع من غيري. */
    app.get('/v1/recommendations/inbox', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { userId } = sessionOf(request);
        const rows = await query(`SELECT r.id, u.username AS "from", r.series_ref AS "seriesRef",
              r.series_title AS "seriesTitle", r.message, r.state, r.created_at AS "createdAt"
         FROM vantara_recommendations r
         JOIN vantara_users u ON u.uchiyomi_user_id = r.from_id
        WHERE (r.to_id = $1 OR (r.to_id IS NULL AND r.from_id <> $1))
        ORDER BY r.created_at DESC
        LIMIT 100`, [userId]);
        return reply.send({ content: rows });
    });
    app.put('/v1/recommendations/:id/state', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const parsed = z
            .object({ state: z.enum(['SENT', 'READ', 'SAVED', 'NOT_INTERESTED']) })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const { userId } = sessionOf(request);
        const row = await queryOne(`UPDATE vantara_recommendations SET state = $3
        WHERE id = $1 AND (to_id = $2 OR (to_id IS NULL AND from_id <> $2))
        RETURNING id`, [id, userId, parsed.data.state]);
        if (!row)
            return reply.code(404).send({ error: 'not_found' });
        return reply.code(204).send();
    });
    // ─────────────────── التقييم الجماعي والنشاط ──────────────────────
    /**
     * التقييم الفردي يُكتب في Uchiyomi (D-02)؛ هذا المسار يمرّره ثم يسجّل نشاطًا.
     * التجميع الجماعي يُحسب من تقييمات Uchiyomi، ولا نحتفظ بنسخة ثانية منها.
     */
    app.put('/v1/ratings/:seriesRef', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { seriesRef: ref } = request.params;
        const parsed = z.object({ rating: z.number().min(0).max(10) }).safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'bad_request' });
        const session = sessionOf(request);
        await ctx.uchiyomi.rating(ref, session.token, parsed.data.rating);
        await logActivity(session.userId, 'rating.set', ref, { rating: parsed.data.rating });
        return reply.code(204).send();
    });
    app.get('/v1/activity', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const limit = z.coerce
            .number()
            .int()
            .min(1)
            .max(200)
            .catch(50)
            .parse(request.query.limit);
        const rows = await query(`SELECT e.id, u.username AS actor, e.verb, e.series_ref AS "seriesRef",
              e.payload, e.created_at AS "createdAt"
         FROM vantara_activity_events e
         JOIN vantara_users u ON u.uchiyomi_user_id = e.actor_id
         LEFT JOIN vantara_user_gates g ON g.uchiyomi_user_id = e.actor_id
        WHERE e.series_ref IS NULL
           OR NOT EXISTS (SELECT 1 FROM vantara_deleted_works d
                           WHERE d.series_ref = e.series_ref AND d.restored_at IS NULL)
        ORDER BY e.created_at DESC
        LIMIT $1`, [limit]);
        return reply.send({ content: rows });
    });
    /** من وصل أي فصل — Read Together. */
    app.get('/v1/read-together/:seriesRef', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { seriesRef: ref } = request.params;
        const rows = await query(`SELECT u.username, p.chapter_label AS "chapterLabel", p.progress,
              max(s.last_beat_at) AS "lastRead"
         FROM vantara_users u
         LEFT JOIN vantara_presence p
                ON p.uchiyomi_user_id = u.uchiyomi_user_id AND p.series_ref = $1
         LEFT JOIN vantara_reading_sessions s
                ON s.uchiyomi_user_id = u.uchiyomi_user_id AND s.series_ref = $1
        GROUP BY u.username, p.chapter_label, p.progress, u.first_seen_at
        ORDER BY u.first_seen_at`, [ref]);
        return reply.send({ content: rows });
    });
    /** إحصائيات VANTARA: وقت القراءة المحتسب. البقية تُقرأ من /api/stats. */
    app.get('/v1/stats/me', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const session = sessionOf(request);
        const row = await queryOne(`SELECT sum(active_ms)::text AS total_ms,
              sum(active_ms) FILTER (WHERE started_at > now() - interval '30 days')::text AS month_ms,
              count(*)::text AS sessions,
              round(avg(active_ms))::text AS avg_ms,
              max(active_ms)::text AS longest_ms,
              count(DISTINCT series_ref)::text AS series
         FROM vantara_reading_sessions
        WHERE uchiyomi_user_id = $1`, [session.userId]);
        const ms = (value) => Number(value ?? 0);
        return reply.send({
            totalMinutes: Math.round(ms(row?.total_ms) / 60_000),
            last30Minutes: Math.round(ms(row?.month_ms) / 60_000),
            sessions: Number(row?.sessions ?? 0),
            avgSessionMinutes: Math.round(ms(row?.avg_ms) / 60_000),
            longestSessionMinutes: Math.round(ms(row?.longest_ms) / 60_000),
            distinctSeries: Number(row?.series ?? 0),
            upstream: await ctx.uchiyomi.stats(session.token).catch(() => null),
        });
    });
    // مُعرَّفة هنا لأنها تلمس نفس الجداول: استعادة snapshot الدمج
    app.post('/v1/merges/:id/split', { preHandler: requireSession(ctx) }, async (request, reply) => {
        const { id } = request.params;
        const session = sessionOf(request);
        const user = await ctx.uchiyomi.me(session.token);
        if (user.role !== 'admin')
            return reply.code(403).send({ error: 'admin_only' });
        const reverted = await transaction(async (client) => {
            const { rows } = await client.query(`UPDATE vantara_merge_snapshots SET reverted_at = now()
          WHERE id = $1 AND reverted_at IS NULL
          RETURNING id, before`, [id]);
            const snapshot = rows[0];
            if (!snapshot)
                return undefined;
            await client.query(`INSERT INTO vantara_audit_log (actor_id, action, target, detail)
         VALUES ($1, 'merge.split', $2, $3)`, [session.userId, id, JSON.stringify(snapshot.before)]);
            return snapshot;
        });
        if (!reverted)
            return reply.code(404).send({ error: 'not_found' });
        return reply.send({ id: reverted.id, restored: reverted.before });
    });
}
//# sourceMappingURL=social.js.map