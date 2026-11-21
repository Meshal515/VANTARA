import { describe, expect, it } from 'vitest';
import { _pending, reportSource, reportedSourceId } from './source-report.js';

// تشخيص المصادر: إضافة مثبّتة من مستودع معرّفها «حزمة#رقم»، والخادم يقبل [a-z0-9._@-] فقط. كانت تقاريرها تُسقط كلها
describe('source reports reach the server for installed extensions', () => {
  it('an installed extension id is sent in a form the server accepts, without ambiguity', () => {
    const million = 'eu.kanade.tachiyomi.extension.all.mangamillion#8929911308540155494';
    expect(reportedSourceId(million)).toBe('eu.kanade.tachiyomi.extension.all.mangamillion.8929911308540155494');
    expect(reportedSourceId(million)).toMatch(/^[a-z0-9._@-]{1,120}$/i);
    // معرّفات الحزمة القديمة والتكملة بلا تغيير
    expect(reportedSourceId('eu.kanade.tachiyomi.extension.ar.teamx')).toBe('eu.kanade.tachiyomi.extension.ar.teamx');
    expect(reportedSourceId('eu.kanade.tachiyomi.extension.all.mangadex@en')).toBe('eu.kanade.tachiyomi.extension.all.mangadex@en');
  });

  it('the queued event carries the accepted id', () => {
    reportSource({ section: 'manga', sourceId: 'eu.kanade.tachiyomi.extension.ar.hizomanga#123', stage: 'cover', outcome: 'timeout', reason: 'timeout', ms: 6000 });
    expect(_pending().at(-1)).toMatchObject({ sourceId: 'eu.kanade.tachiyomi.extension.ar.hizomanga.123', stage: 'cover', outcome: 'timeout' });
  });
});
