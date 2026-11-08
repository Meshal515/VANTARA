/**
 * مقياس الهوية الواحدة للمانجا على بيانات حقيقية مثبّتة (لا شبكة):
 * 1911 عملًا من AniList (الأشهر غير الروايات + كل ما يرتبط بها: تتمات، أجزاء جانبية، نسخ بديلة،
 * ون شوت) و561 منها بأسمائها في MangaDex (156 بعنوان عربي). الحقيقة الأرضية معرّف AniList.
 * المصادر محاكاة بما تحمله فعلًا (fixtures/manga-identity-sim.js).
 *
 * المعيار: صفر دمج خاطئ بدليل. «المتجانسات» — عملان مختلفان بعنوان واحد بعد التطبيع (أغلبها
 * فصل تجريبي ون شوت باسم السلسلة: «Naruto» و«NARUTO» الفصل التجريبي) — لا يفرّقها الاسم أصلًا،
 * فتُعدّ وحدها ولا يُسمح بزيادتها. والدمج الفائت يُقاس ولا يُسمح بتراجعه.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalIndex } from './catalog.js';
import { measure, simulate } from './fixtures/manga-identity-sim.js';

const { works } = JSON.parse(readFileSync(new URL('./fixtures/manga-identity-bench.json', import.meta.url), 'utf8'));

const run = (scenario) => {
  const { entries, aliases } = simulate(works, scenario);
  const t0 = performance.now();
  const index = canonicalIndex({ aliases });
  for (const e of entries) index.add(e);
  const cards = index.list();
  return { entries: entries.length, ms: performance.now() - t0, ...measure(cards, works) };
};

// الحدود = القياس عند تثبيت المقياس (2026-11-08). تحسين يرفعها؛ تراجع يكسر الاختبار.
const FLOOR = {
  titles: { oneCardWorks: 1024, homonymPairs: 63 },
  mangadex: { oneCardWorks: 1114, homonymPairs: 65 },
  details: { oneCardWorks: 1769, homonymPairs: 63 },
  full: { oneCardWorks: 1821, homonymPairs: 65 },
};

describe('manga identity benchmark (real AniList + MangaDex titles)', () => {
  it('the fixture is large and real', () => {
    expect(works.length).toBeGreaterThan(1500);
    expect(works.filter((w) => w.d?.a?.ar).length).toBeGreaterThan(100);
    expect(works.filter((w) => w.r?.some(([, t]) => t === 'SEQUEL' || t === 'PREQUEL')).length).toBeGreaterThan(100);
  });

  for (const scenario of Object.keys(FLOOR)) {
    it(`${scenario}: zero evidence-driven wrong merges, no regression in merges`, () => {
      const m = run(scenario);
      const evidenceWrong = m.wrongPairs.filter((p) => !p.homonym);
      console.log(`[identity-bench] ${scenario}: entries=${m.entries} works=${m.works} cards=${m.cards} oneCard=${m.oneCardWorks} duplicates=${m.duplicates} pairs ${m.correctPairs}/${m.expectedPairs} wrong=${evidenceWrong.length} homonyms=${m.homonymPairs} ${Math.round(m.ms)}ms`);
      expect(evidenceWrong).toEqual([]);
      expect(m.homonymPairs).toBeLessThanOrEqual(FLOOR[scenario].homonymPairs);
      expect(m.oneCardWorks).toBeGreaterThanOrEqual(FLOOR[scenario].oneCardWorks);
      // آلاف النسخ على الخيط الرئيسي: لا كلفة تربيعية
      expect(m.ms).toBeLessThan(3000);
    });
  }

  it('sequels, prequels and spin-offs with a related title never share a card', () => {
    const { entries, aliases } = simulate(works, 'full');
    const index = canonicalIndex({ aliases });
    for (const e of entries) index.add(e);
    const cardOf = new Map();
    index.list().forEach((card, i) => { for (const e of card.editions) (cardOf.get(e.al) ?? cardOf.set(e.al, new Set()).get(e.al)).add(i); });
    const m = measure(index.list(), works);
    const homonym = new Set(m.wrongPairs.filter((p) => p.homonym).map((p) => `${Math.min(p.a, p.b)}|${Math.max(p.a, p.b)}`));
    let checked = 0;
    const merged = [];
    for (const w of works) for (const [other, type] of w.r ?? []) {
      if (!['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'PARENT'].includes(type) || !cardOf.has(other)) continue;
      checked++;
      if (homonym.has(`${Math.min(w.al, other)}|${Math.max(w.al, other)}`)) continue;
      if ([...cardOf.get(w.al)].some((c) => cardOf.get(other).has(c))) merged.push([w.al, other, type]);
    }
    console.log(`[identity-bench] related pairs checked=${checked}`);
    expect(checked).toBeGreaterThan(800);
    expect(merged).toEqual([]);
  });
});
