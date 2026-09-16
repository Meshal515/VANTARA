import PgBoss from 'pg-boss';
import { query } from '@vantara/db';
import type { AppContext } from '../lib/context.ts';

/**
 * الوظائف الخلفية عبر pg-boss — داخل نفس PostgreSQL، بلا Redis.
 *
 * قائمة الوظائف مقصودة القِلّة: كل واحدة تفعل شيئًا واحدًا وتسجّل أثرها.
 */
export const QUEUES = {
  sessionPurge: 'session.purge',
  presenceSweep: 'presence.sweep',
  sourceProbe: 'source.probe',
  sourceSync: 'source.sync',
  translationChapter: 'translation.chapter',
  translationPage: 'translation.page',
  reportDiagnose: 'report.diagnose',
  backupRun: 'backup.run',
} as const;

export interface JobRunner {
  boss: PgBoss;
  stop(): Promise<void>;
}

export async function startJobs(ctx: AppContext): Promise<JobRunner> {
  const boss = new PgBoss({
    connectionString: ctx.config.DATABASE_URL,
    schema: 'pgboss',
    // الوظائف قليلة ومتباعدة؛ لا داعي لاستطلاع كل ثانية
    pollingIntervalSeconds: 5,
  });

  boss.on('error', (error) => {
    // pg-boss يرمي على أخطاء الاتصال؛ تجاهلها صامتًا يخفي عطلًا حقيقيًا
    console.error('[pg-boss]', error);
  });

  await boss.start();

  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }

  /** الجلسات المنتهية تبقى صفوفًا ميتة حتى تُحذف. */
  await boss.work(QUEUES.sessionPurge, async () => {
    const purged = await ctx.sessions.purgeExpired();
    if (purged > 0) console.log(`[jobs] purged ${String(purged)} expired sessions`);
  });

  /**
   * إغلاق جلسات القراءة المنسية.
   *
   * القارئ الذي يغلق التبويب لا يرسل `/leave`. بلا هذه المكنسة تبقى جلسته
   * مفتوحة، فيمنع الفهرس الفريد فتح جلسة جديدة لنفس الفصل.
   */
  await boss.work(QUEUES.presenceSweep, async () => {
    const closed = await query<{ id: string }>(
      `UPDATE vantara_reading_sessions
          SET ended_at = last_beat_at
        WHERE ended_at IS NULL
          AND last_beat_at < now() - interval '5 minutes'
        RETURNING id`,
    );
    await query(
      `UPDATE vantara_presence SET status = 'OFFLINE', series_ref = NULL, series_title = NULL,
              chapter_ref = NULL, chapter_label = NULL, progress = NULL
        WHERE status <> 'OFFLINE' AND updated_at < now() - interval '5 minutes'`,
    );
    if (closed.length > 0) {
      console.log(`[jobs] closed ${String(closed.length)} stale reading sessions`);
    }
  });

  /** مزامنة سجل المصادر مع Uchiyomi. الأحكام لا تُلمس — فقط التسجيل. */
  await boss.work(QUEUES.sourceSync, async () => {
    const sources = await ctx.uchiyomi.listSources();
    for (const source of sources) {
      await query(
        `INSERT INTO vantara_source_verdicts (source_id, source_name, lang)
              VALUES ($1, $2, $3)
         ON CONFLICT (source_id)
         DO UPDATE SET source_name = EXCLUDED.source_name, lang = EXCLUDED.lang`,
        [source.id, source.name, source.lang],
      );
    }
    console.log(`[jobs] synced ${String(sources.length)} sources`);
  });

  // كل خمس دقائق: مكنسة الحضور. كل ليلة: تنظيف الجلسات ومزامنة المصادر.
  await boss.schedule(QUEUES.presenceSweep, '*/5 * * * *');
  await boss.schedule(QUEUES.sessionPurge, '17 3 * * *');
  await boss.schedule(QUEUES.sourceSync, '43 4 * * *');

  return {
    boss,
    stop: async () => {
      await boss.stop({ graceful: true, timeout: 20_000 });
    },
  };
}
