import PgBoss from 'pg-boss';
import type { AppContext } from '../lib/context.ts';
/**
 * الوظائف الخلفية عبر pg-boss — داخل نفس PostgreSQL، بلا Redis.
 *
 * قائمة الوظائف مقصودة القِلّة: كل واحدة تفعل شيئًا واحدًا وتسجّل أثرها.
 */
export declare const QUEUES: {
    readonly sessionPurge: "session.purge";
    readonly presenceSweep: "presence.sweep";
    readonly sourceProbe: "source.probe";
    readonly sourceSync: "source.sync";
    readonly translationChapter: "translation.chapter";
    readonly translationPage: "translation.page";
    readonly reportDiagnose: "report.diagnose";
    readonly backupRun: "backup.run";
};
export interface JobRunner {
    boss: PgBoss;
    stop(): Promise<void>;
}
export declare function startJobs(ctx: AppContext): Promise<JobRunner>;
//# sourceMappingURL=index.d.ts.map