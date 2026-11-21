import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/extension-engine.js', () => ({ default: { isAvailable: () => false, onSourcesChanged: () => () => {} } }));
import { mirrorFamily, sourcePackage } from '../lib/catalog.js';
import { isMangaDex } from '../lib/manga-evidence.js';
import { collapseMirrors, displayName, sourceRank } from './works.js';

// صفر مصادر مدمجة: الإضافة المثبّتة من مستودع معرّفها `حزمة#رقم`. كل ما يقرأ اسم الموقع من آخر المعرّف كان يقرأ
// «mangastarz#123»، فتضيع عائلة المرايا وترتيب الثقة واسم العرض وتمييز MangaDex لمن ثبّتها من المستودع.
const P = 'eu.kanade.tachiyomi.extension';
describe('an installed extension id (pkg#id) is the same site as its package', () => {
  it('the package of every id form', () => {
    expect(sourcePackage(`${P}.ar.mangastarz#123`)).toBe(`${P}.ar.mangastarz`);
    expect(sourcePackage(`${P}.all.mangadex@en`)).toBe(`${P}.all.mangadex`);
    expect(sourcePackage(`${P}.ar.teamx`)).toBe(`${P}.ar.teamx`);
  });

  it('mirror family, trust rank, display name and MangaDex are those of the package', () => {
    expect(mirrorFamily(`${P}.ar.mangastarz#123`)).toBe('mangalek');
    expect(mirrorFamily(`${P}.ar.mangastarz`)).toBe('mangalek');
    expect(mirrorFamily(`${P}.ar.hizomanga#9`)).toBe(`${P}.ar.hizomanga#9`);
    expect(sourceRank(`${P}.ar.mangalek#5`)).toBe(sourceRank(`${P}.ar.mangalek`));
    expect(sourceRank(`${P}.ar.teamx#5`)).toBeLessThan(sourceRank(`${P}.ar.unknownsite#5`));
    expect(displayName(null, `${P}.ar.hizomanga#9`)).toBe('HizoManga');
    expect(displayName(`${P}.ar.mangalek#9`, `${P}.ar.mangalek#9`)).toBe('Mangalek');
    expect(isMangaDex(`${P}.all.mangadex#2499283573021220255`)).toBe(true);
  });

  it('five mirrors installed from a repository are still one source in listings', () => {
    const list = ['mangastarz', 'mangalek', 'mangaspark'].map((slug, i) => ({ id: `${P}.ar.${slug}#${i + 1}`, label: slug }));
    const kept = collapseMirrors(list);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(`${P}.ar.mangalek#2`);
  });
});
