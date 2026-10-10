/**
 * تدقيق الهوية في كتالوج المانجا (قاعدة 8K: أعمال فريدة لا صفوف).
 *
 *   node tools/pwa/manga-dedup.mjs [--pages=3] [--details=400] [--edge] [--json=out.json]
 *                                  [--aliases-out=apps/web/data/manga-aliases.json]
 *
 * 1. يجمع قوائم كل المصادر (الرائج + الأحدث، عدة صفحات)، مرآة واحدة لكل موقع.
 * 2. يجمّعها كما يجمّعها التطبيق (`canonicalIndex`): أدلة القوائم نفسها (توأم
 *    العنوان، اسم الرابط، أسماء MangaDex) + الأسماء البديلة المشحونة.
 * 3. يقرأ الأسماء البديلة وعدد الفصول من صفحة كل بطاقة، ويكشف:
 *    - تكرارًا ظاهرًا: بطاقتان، واسم إحداهما من أسماء الأخرى البديلة.
 *    - بطاقات بلا فصول: كل نسخها ردّت بلا فصل (لا تُعرض في التطبيق بعد أول فتح).
 * والتقرير: Raw entries · Unique (exact) · Unique before details · Unique after ·
 * Merged · Duplicates visible · Ambiguous rejected.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { aliasEvidence, canonicalIndex, mirrorFamily, normalizeTitle } from '../../apps/web/lib/catalog.js';

useLinkedom();
const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PAGES = Number(arg('pages', 3));
const DETAILS = Number(arg('details', 400));
const fetch = process.argv.includes('--edge') ? await (await import('./edge-fetcher.mjs')).edgeFetcher() : liveFetcher();
const t = (p, ms = 30_000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const all = JSON.parse(readFileSync(new URL('../../apps/web/pwa/sources/defs.json', import.meta.url))).sources.filter((d) => d.content === 'manga');
const seenFamily = new Set();
const defs = all.filter((d) => {
  const f = mirrorFamily(d.id);
  if (seenFamily.has(f)) return false;
  seenFamily.add(f);
  return true;
});

// 1) القوائم
const entries = [];
for (const def of defs) {
  const engine = ENGINES[def.engine].create(def, { fetch });
  let n = 0;
  for (const kind of ['popular', 'latest']) {
    for (let page = 1; page <= PAGES; page++) {
      const res = await t(engine[kind](page)).catch(() => null);
      for (const manga of res?.mangas ?? []) {
        entries.push({ sourceId: def.id, label: def.label, manga, engine });
        n++;
      }
      if (!res?.hasNextPage) break;
    }
  }
  console.error(`${def.id.split('.').pop().padEnd(18)} ${n}`);
}

// 2) التجميع كما في التطبيق: أدلة القوائم + الأسماء المشحونة (بلا صفحات بعد)
let shipped = {};
try {
  shipped = JSON.parse(readFileSync(new URL('../../apps/web/data/manga-aliases.json', import.meta.url))).aliases ?? {};
} catch {
  shipped = {};
}
const exactKeys = new Set(entries.map((e) => normalizeTitle(e.manga.title)).filter(Boolean));
const before = canonicalIndex({ aliases: new Map(Object.entries(shipped)) });
for (const e of entries) before.add(e);
const cards = before.list();

// 3) الأسماء البديلة من صفحات الأعمال (حتى DETAILS عملًا، بالتوازي المحدود)
const queue = cards.slice(0, DETAILS);
const aliases = new Map();
let done = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let card = queue.shift(); card; card = queue.shift()) {
      const ed = card.editions[0];
      const d = await t(ed.engine.series(ed.manga)).catch(() => null);
      const names = d?.manga?.altNames ?? [];
      if (names.length) aliases.set(card.key, names);
      // عدد الفصول من كل نسخ البطاقة (بطاقة بلا فصول = كلها ردّت بصفر)
      const counts = await Promise.all(card.editions.map((e, i) => (i === 0 ? Promise.resolve(d?.chapters?.length ?? null) : t(e.engine.chapters(e.manga)).then((c) => c?.length ?? null, () => null))));
      card.chapters = counts.every((c) => c === 0) ? 0 : Math.max(...counts.map((c) => c ?? -1));
      if (++done % 50 === 0) console.error(`details ${done}`);
    }
  }),
);

// 4) تكرار ظاهر: اسم بطاقة موجود داخل أسماء بطاقة أخرى البديلة
const byKey = new Map(cards.map((c) => [c.key, c]));
const duplicates = [];
for (const [key, names] of aliases) {
  for (const other of cards) {
    if (other.key === key) continue;
    const ev = aliasEvidence(other.key, names);
    if (ev) duplicates.push({ a: byKey.get(key).title, b: other.title, evidence: ev, sources: [byKey.get(key).editions.map((e) => e.label), other.editions.map((e) => e.label)] });
  }
}

// 5) بعد الربط بالأسماء البديلة (المشحونة + صفحات الأعمال)
const learned = new Map(Object.entries(shipped));
for (const [key, names] of aliases) learned.set(key, [...new Set([...(learned.get(key) ?? []), ...names])]);
const after = canonicalIndex({ aliases: learned });
for (const e of entries) after.add(e);
const afterCards = after.list();
const afterKeys = new Set(afterCards.map((c) => c.key));
const stillDuplicate = duplicates.filter((d) => {
  const ka = after.canonicalOf(d.a);
  const kb = after.canonicalOf(d.b);
  return ka !== kb && afterKeys.has(ka) && afterKeys.has(kb);
});

const merged = afterCards.filter((c) => new Set(c.editions.map((e) => mirrorFamily(e.sourceId))).size > 1);
const empty = cards.filter((c) => c.chapters === 0);
const report = {
  rawEntries: entries.length,
  uniqueExactTitles: exactKeys.size,
  uniqueBeforeDetails: cards.length,
  uniqueAfter: afterCards.length,
  crossSourceMerged: merged.length,
  detailsRead: done,
  withAliases: aliases.size,
  duplicatesVisibleBefore: duplicates.length,
  duplicatesVisibleAfter: stillDuplicate.length,
  emptyCards: empty.length,
  ambiguousRejected: after.rejected?.length ?? 0,
};
console.log('| المقياس | القيمة |\n|---|---|');
for (const [k, v] of Object.entries(report)) console.log(`| ${k} | ${v} |`);
console.log('\nتكرارات ظاهرة كُشفت (قبل الربط):');
for (const d of duplicates.slice(0, 40)) console.log(`- «${d.a}» [${d.sources[0].join('، ')}] = «${d.b}» [${d.sources[1].join('، ')}] ← ${d.evidence}`);
if (stillDuplicate.length) {
  console.log('\nتكرارات باقية بعد الربط:');
  for (const d of stillDuplicate.slice(0, 40)) console.log(`- «${d.a}» = «${d.b}» ← ${d.evidence}`);
}
if (empty.length) {
  console.log('\nبطاقات بلا فصول (كل نسخها ردّت بصفر):');
  for (const c of empty.slice(0, 40)) console.log(`- «${c.title}» [${c.editions.map((e) => e.label).join('، ')}]`);
}
if (after.rejected?.length) {
  console.log('\nأسماء بديلة رُفضت لأنها تشير لأكثر من عمل:');
  for (const r of after.rejected.slice(0, 20)) console.log(`- ${r}`);
}
if (arg('aliases-out')) {
  // يُدمج مع الموجود: ما عُرف سابقًا لا يضيع إن لم تظهر صفحته هذه المرة
  let prev = {};
  try {
    prev = JSON.parse(readFileSync(arg('aliases-out'), 'utf8')).aliases ?? {};
  } catch {
    prev = {};
  }
  const merged = { ...prev };
  for (const [key, names] of aliases) merged[key] = [...new Set([...(merged[key] ?? []), ...names])];
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(arg('aliases-out'), `${JSON.stringify({ $comment: 'الأسماء البديلة لأعمال المانجا: مفتاح العمل ← أسماؤه الأخرى (من صفحات الأعمال). tools/pwa/manga-dedup.mjs --aliases-out', aliases: sorted }, null, 1)}\n`);
  console.error(`aliases: ${Object.keys(sorted).length} works`);
}
// كل دمج بين عناوين مختلفة يُطبع للمراجعة البشرية: ZERO WRONG MERGE لا يُفترض، يُفحص
const multi = afterCards.filter((c) => (c.keys ?? []).length > 1);
console.log(`\nبطاقات تجمع عناوين مختلفة (${multi.length}):`);
for (const c of multi) console.log(`- «${c.title}» ← ${c.editions.map((e) => `«${e.manga.title}» [${e.label}]`).join('، ')}`);
const lite = (e) => ({ sourceId: e.sourceId, label: e.label, manga: { title: e.manga.title, url: e.manga.url, memo: e.manga.memo, altNames: e.manga.altNames } });
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ report, duplicates, rejected: after.rejected ?? [], merged: multi.map((c) => ({ key: c.key, keys: c.keys, titles: c.editions.map((e) => e.manga.title) })), entries: entries.map(lite) }, null, 2));
