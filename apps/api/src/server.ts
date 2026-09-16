import { closePool, initPool } from '@vantara/db';
import { buildApp } from './app.ts';
import { loadConfig } from './lib/config.ts';
import { startJobs, type JobRunner } from './jobs/index.ts';

const config = loadConfig();
initPool({ connectionString: config.DATABASE_URL });

const { app, ctx } = await buildApp(config);

let jobs: JobRunner | undefined;
if (process.env['VANTARA_DISABLE_JOBS'] !== 'true') {
  jobs = await startJobs(ctx);
}

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`uchiyomi upstream: ${config.UCHIYOMI_URL}`);

/**
 * إطفاء منظّم: أوقف قبول الطلبات، ثم أنهِ الوظائف الجارية، ثم أغلق القاعدة.
 * القتل الفوري يترك جلسات قراءة مفتوحة ووظائف معلّقة.
 */
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — shutting down`);

    void (async () => {
      try {
        await app.close();
        await jobs?.stop();
        await closePool();
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      }
    })();
  });
}
