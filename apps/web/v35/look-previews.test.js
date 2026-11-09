import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CINEMA_WORK_STYLES, MANGA_WORK_STYLES, WORK_STYLES } from './appearance.js';
import { homePreview, requiredPreviews, workPreview } from './look-previews.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('لقطات المعاينة الحقيقية', () => {
  it('لكل نمط معرّف ولكل رئيسية لقطة بالمقاسات الثلاثة، موجودة وصغيرة', () => {
    const missing = requiredPreviews().filter((p) => !existsSync(resolve(WEB, p.slice(1))));
    expect(missing, 'ولّدها: node tools/ui-previews/generate-look-previews.mjs').toEqual([]);
    for (const p of requiredPreviews()) expect(statSync(resolve(WEB, p.slice(1))).size).toBeLessThan(90_000);
  });

  it('القائمة تغطي كل أنماط المانجا والأنمي والسينما (الأساسي وثلاثة أنماط)', () => {
    const all = requiredPreviews();
    for (const s of MANGA_WORK_STYLES) expect(all).toContain(workPreview('manga', s.id, 'phone'));
    for (const s of WORK_STYLES) expect(all).toContain(workPreview('anime', s.id, 'pc'));
    expect(all).toContain(workPreview('cinema', 'current', 'ipad'));
    for (const s of CINEMA_WORK_STYLES) expect(all).toContain(workPreview('cinema', s.id, 'phone'));
    expect(CINEMA_WORK_STYLES.map((s) => s.id)).toEqual(['current', 'premiere', 'poster', 'marquee']);
    expect(all).toContain(homePreview('cinema', 'phone'));
    expect(all).toContain(homePreview('unified', 'phone'));
    expect(all).toHaveLength(3 * (3 + 4 + 5 + 4) + 3);
  });

  it('لا لقطة يتيمة في المجلد: كل ملف له نمط أو رئيسية', () => {
    const want = new Set(requiredPreviews().map((p) => p.split('/').pop()));
    const extra = readdirSync(resolve(WEB, 'v35/looks')).filter((f) => !want.has(f));
    expect(extra).toEqual([]);
  });
});
