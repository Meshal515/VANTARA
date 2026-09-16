import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, transaction } from '@vantara/db';
import {
  HEARTBEAT_INTERVAL_MS,
  creditForBeat,
  redactForViewers,
  statusFor,
  type PresenceStatus,
  type VisiblePresence,
} from '@vantara/domain';
import { requireSession, sessionOf, type AppContext } from '../lib/context.ts';

const beatBody = z.object({
  visible: z.boolean(),
  interactions: z.number().int().min(0).max(1000),
  seriesRef: z.string().max(200).optional(),
  seriesTitle: z.string().max(400).optional(),
  chapterRef: z.string().max(200).optional(),
  chapterLabel: z.string().max(200).optional(),
  progress: z.number().min(0).max(1).optional(),
  pagesSeen: z.number().int().min(0).max(10_000).optional(),
});

interface OpenSession {
  id: string;
  last_beat_at: Date;
  active_ms: string;
}

export async function presenceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * نبضة واحدة تفعل شيئين: تحدّث الحضور، وتضيف الوقت المستحق لجلسة القراءة.
   *
   * الوقت لا يأتي من فارق التوقيتات مباشرة — `creditForBeat` تسقط النبضة غير
   * الظاهرة أو بلا تفاعل، وتسقّف الفجوة، حتى لا يُحسب تبويب نائم كقراءة.
   */
  app.post(
    '/v1/presence/beat',
    {
      preHandler: requireSession(ctx),
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = beatBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

      const beat = parsed.data;
      const { userId } = sessionOf(request);
      const reading = beat.visible && beat.seriesRef !== undefined;

      const credited = await transaction(async (client) => {
        await client.query(
          `INSERT INTO vantara_presence
             (uchiyomi_user_id, status, series_ref, series_title,
              chapter_ref, chapter_label, progress, device, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (uchiyomi_user_id) DO UPDATE SET
             status = EXCLUDED.status,
             series_ref = EXCLUDED.series_ref,
             series_title = EXCLUDED.series_title,
             chapter_ref = EXCLUDED.chapter_ref,
             chapter_label = EXCLUDED.chapter_label,
             progress = EXCLUDED.progress,
             device = EXCLUDED.device,
             updated_at = now()`,
          [
            userId,
            reading ? 'READING' : 'ONLINE',
            beat.seriesRef ?? null,
            beat.seriesTitle ?? null,
            beat.chapterRef ?? null,
            beat.chapterLabel ?? null,
            beat.progress ?? null,
            request.headers['user-agent']?.slice(0, 200) ?? null,
          ],
        );

        if (beat.seriesRef === undefined) return 0;

        const { rows } = await client.query<OpenSession>(
          `SELECT id, last_beat_at, active_ms
             FROM vantara_reading_sessions
            WHERE uchiyomi_user_id = $1
              AND series_ref = $2
              AND coalesce(chapter_ref, '') = coalesce($3, '')
              AND ended_at IS NULL
            FOR UPDATE`,
          [userId, beat.seriesRef, beat.chapterRef ?? null],
        );

        const open = rows[0];
        if (!open) {
          await client.query(
            `INSERT INTO vantara_reading_sessions
               (uchiyomi_user_id, series_ref, chapter_ref, interactions, pages_seen)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, beat.seriesRef, beat.chapterRef ?? null, beat.interactions, beat.pagesSeen ?? 0],
          );
          // النبضة الأولى تفتح الجلسة ولا تُحتسب: لا فترة سابقة تُقاس
          return 0;
        }

        const since = Date.now() - open.last_beat_at.getTime();
        const credit = creditForBeat(beat, since);

        await client.query(
          `UPDATE vantara_reading_sessions
              SET active_ms = active_ms + $2,
                  interactions = interactions + $3,
                  pages_seen = GREATEST(pages_seen, $4),
                  last_beat_at = now()
            WHERE id = $1`,
          [open.id, credit, beat.interactions, beat.pagesSeen ?? 0],
        );

        return credit;
      });

      return reply.send({ ok: true, creditedMs: credited, nextBeatMs: HEARTBEAT_INTERVAL_MS });
    },
  );

  /** إغلاق صريح عند مغادرة القارئ. الجلسات المنسية تُغلقها وظيفة الصيانة. */
  app.post('/v1/presence/leave', { preHandler: requireSession(ctx) }, async (request, reply) => {
    const { userId } = sessionOf(request);
    await query(
      `UPDATE vantara_reading_sessions SET ended_at = now()
        WHERE uchiyomi_user_id = $1 AND ended_at IS NULL`,
      [userId],
    );
    await query(
      `UPDATE vantara_presence SET status = 'ONLINE', series_ref = NULL, series_title = NULL,
              chapter_ref = NULL, chapter_label = NULL, progress = NULL, updated_at = now()
        WHERE uchiyomi_user_id = $1`,
      [userId],
    );
    return reply.code(204).send();
  });

  /**
   * من متصل وماذا يقرأ.
   *
   * القارئ المُخفي يظهر ONLINE بلا عمل ولا فصل. هذا يسدّ التسريب الذي يخلقه
   * خيار محتوى البالغين لو بُثّ ما يُقرأ للجميع.
   */
  app.get('/v1/presence', { preHandler: requireSession(ctx) }, async (_request, reply) => {
    const rows = await query<{
      uchiyomi_user_id: string;
      username: string;
      series_title: string | null;
      chapter_label: string | null;
      progress: number | null;
      updated_at: Date;
      reading: boolean;
      incognito: boolean;
    }>(
      `SELECT p.uchiyomi_user_id, u.username, p.series_title, p.chapter_label, p.progress,
              p.updated_at,
              (p.status = 'READING') AS reading,
              (g.incognito_until IS NOT NULL AND g.incognito_until > now()) AS incognito
         FROM vantara_presence p
         JOIN vantara_users u USING (uchiyomi_user_id)
         LEFT JOIN vantara_user_gates g USING (uchiyomi_user_id)
        ORDER BY u.first_seen_at`,
    );

    const now = Date.now();
    const content: VisiblePresence[] = rows.map((row) => {
      const ago = now - row.updated_at.getTime();
      const status: PresenceStatus = statusFor(ago, { reading: row.reading });
      const full: VisiblePresence = {
        userId: row.uchiyomi_user_id,
        username: row.username,
        status,
        ...(row.series_title !== null ? { seriesTitle: row.series_title } : {}),
        ...(row.chapter_label !== null ? { chapterLabel: row.chapter_label } : {}),
        ...(row.progress !== null ? { progress: row.progress } : {}),
      };
      return redactForViewers(full, { incognito: row.incognito });
    });

    return reply.send({ content });
  });

  /** الإخفاء المؤقت: مدة بالدقائق، أو 0 لإلغائه فورًا. */
  app.put('/v1/presence/incognito', { preHandler: requireSession(ctx) }, async (request, reply) => {
    const parsed = z.object({ minutes: z.number().int().min(0).max(1440) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const { userId } = sessionOf(request);
    const until = parsed.data.minutes === 0 ? null : `${String(parsed.data.minutes)} minutes`;

    const row = await queryOne<{ incognito_until: Date | null }>(
      `UPDATE vantara_user_gates
          SET incognito_until = CASE WHEN $2::text IS NULL
                                     THEN NULL
                                     ELSE now() + $2::interval END
        WHERE uchiyomi_user_id = $1
        RETURNING incognito_until`,
      [userId, until],
    );

    return reply.send({ incognitoUntil: row?.incognito_until ?? null });
  });
}
