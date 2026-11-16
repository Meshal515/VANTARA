/**
 * محاكاة المصادر فوق بيانات حقيقية (manga-identity-bench.json): كيف تسمّي المصادر
 * نفس العمل، وما الأدلة التي تحملها معها فعلًا في التطبيق. الحقيقة الأرضية معرّف AniList.
 *
 * للاختبار وحده؛ لا يُحمَّل في التطبيق.
 *
 * المصادر (كل واحد عائلة مختلفة، فحارس «مصدر يعرضهما عملين» يعمل كما في التطبيق):
 *   teamx     يسرد الاسم الإنجليزي (أو الروماجي إن غاب)، ورابطه slug منه.
 *   manga3asq يسرد الروماجي، بلا أسماء بديلة.
 *   mangadex  اسم MangaDex الرئيسي، وأسماؤه البديلة كلها (`withMangaDexNames`).
 *   mangatime الاسم العربي من MangaDex؛ نصف الأعمال برابط slug إنجليزي (Madara)، والنصف برقم.
 * و«تفاصيل»: أسماء صفحة العمل (AniList synonyms + الروماجي + الأصلي) كما يتعلّمها الجهاز
 * (`learnAliases`) بمفتاح بطاقة teamx.
 */
import { normalizeTitle } from '../catalog.js';

const P = 'eu.kanade.tachiyomi.extension';
const slug = (t) => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const edition = (source, al, manga) => ({ sourceId: `${P}.${source}`, label: source, manga, al });

export function simulate(works, scenario = 'full') {
  const entries = [];
  const aliases = new Map();
  const withDex = scenario === 'mangadex' || scenario === 'full';
  const withDetails = scenario === 'details' || scenario === 'full';
  for (const w of works) {
    const [en, romaji, native] = w.t;
    const main = en || romaji;
    if (!main) continue;
    entries.push(edition('ar.teamx', w.al, { title: main, url: `/series/${slug(main)}` }));
    if (romaji && romaji !== main) entries.push(edition('ar.manga3asq', w.al, { title: romaji, url: `/manga/${slug(romaji)}/` }));
    const arabic = w.d?.a?.ar?.[0];
    if (arabic) entries.push(edition('ar.mangatime', w.al, { title: arabic, url: w.al % 2 ? `/manhwa/${slug(main)}` : `/p/${w.al}` }));
    if (withDex && w.d) {
      const names = [...new Set(Object.values(w.d.a).flat())];
      entries.push(edition('all.mangadex', w.al, { title: w.d.t, url: `/manga/dex-${w.al}`, altNames: names }));
    }
    if (withDetails) {
      const key = normalizeTitle(main);
      const names = [romaji, native, ...(w.s ?? [])].filter((n) => n && n !== main);
      if (key && names.length) aliases.set(key, [...new Set([...(aliases.get(key) ?? []), ...names])]);
    }
  }
  return { entries, aliases };
}

/**
 * يقيس البطاقات مقابل الحقيقة:
 *   wrongPairs  أزواج أعمال مختلفة (معرّفا AniList) في بطاقة واحدة — دمج خاطئ.
 *   homonyms    منها ما سببه عنوانان متطابقان بعد التطبيع (لا دليل يفرّقهما بالاسم).
 *   duplicates  بطاقات زائدة لعمل واحد (عدد بطاقاته − 1) — دمج فائت.
 *   correctPairs/expectedPairs أزواج نسخ العمل الواحد التي اجتمعت / كل أزواجه.
 */
export function measure(cards, works) {
  const titlesOf = new Map(works.map((w) => [w.al, w]));
  const cardsOf = new Map();
  const wrong = new Map();
  let correctPairs = 0;
  let expectedPairs = 0;
  const editionsOf = new Map();
  cards.forEach((card, i) => {
    const als = card.editions.map((e) => e.al);
    for (const al of als) {
      if (!cardsOf.has(al)) cardsOf.set(al, new Set());
      cardsOf.get(al).add(i);
      editionsOf.set(al, (editionsOf.get(al) ?? 0) + 1);
    }
    const counts = new Map();
    for (const al of als) counts.set(al, (counts.get(al) ?? 0) + 1);
    for (const n of counts.values()) correctPairs += (n * (n - 1)) / 2;
    const distinct = [...counts.keys()].sort((a, b) => a - b);
    for (let a = 0; a < distinct.length; a++) for (let b = a + 1; b < distinct.length; b++) {
      const key = `${distinct[a]}|${distinct[b]}`;
      if (!wrong.has(key)) wrong.set(key, card.editions.filter((e) => e.al === distinct[a] || e.al === distinct[b]).map((e) => e.manga.title));
    }
  });
  for (const n of editionsOf.values()) expectedPairs += (n * (n - 1)) / 2;
  const wrongPairs = [...wrong].map(([key, ts]) => {
    const [a, b] = key.split('|').map(Number);
    const keysA = new Set(cards.flatMap((c) => c.editions.filter((e) => e.al === a).map((e) => normalizeTitle(e.manga.title))));
    const homonym = cards.some((c) => c.editions.some((e) => e.al === b && keysA.has(normalizeTitle(e.manga.title))));
    return { a, b, homonym, titles: [...new Set(ts)] };
  });
  const missedWorks = [...cardsOf].filter(([, s]) => s.size > 1).map(([al, s]) => ({ al, cards: s.size, title: titlesOf.get(al)?.t?.[0] ?? titlesOf.get(al)?.t?.[1] }));
  return {
    works: cardsOf.size,
    cards: cards.length,
    duplicates: missedWorks.reduce((t, m) => t + m.cards - 1, 0),
    oneCardWorks: cardsOf.size - missedWorks.length,
    correctPairs,
    expectedPairs,
    wrongPairCount: wrongPairs.length,
    homonymPairs: wrongPairs.filter((p) => p.homonym).length,
    wrongPairs: wrongPairs.filter((p) => !p.homonym).concat(wrongPairs.filter((p) => p.homonym)),
    missedWorks,
  };
}
