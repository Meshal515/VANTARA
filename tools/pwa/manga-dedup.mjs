/**
 * تدقيق الهوية في كتالوج المانجا (قاعدة 8K: أعمال فريدة لا صفوف).
 *
 *   node tools/pwa/manga-dedup.mjs [--pages=3] [--details=400] [--edge] [--json=out.json]
 *                                  [--aliases-out=apps/web/data/manga-aliases.json]
 *
 * 1. يجمع قوائم كل المصادر (الرائج + الأحدث، عدة صفحات)، مرآة واحدة لكل موقع.
 * 2. يجمّعها كما يجمّعها التطبيق (`canonicalIndex` بالأسماء البديلة المعروفة).
 * 3. يقرأ الأسماء البديلة من صفحة كل عمل، ويكشف:
 *    - تكرارًا ظاهرًا: بطاقتان، واسم إحداهما من أسماء الأخرى البديلة.
 *    - دمجًا مريبًا: بطاقة واحدة تحمل نسخًا بفصول متباعدة جدًا (قد تكون عملين).
 * والتقرير: Raw entries · Canonical unique · Merged · Duplicates visible · Ambiguous.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { liveFetcher, useLinkedom } from './live-fetcher.mjs';
import { ENGINES } from '../../apps/web/pwa/sources/engines/index.js';
import { aliasEvidence, canonicalIndex, mirrorFamily } from '../../apps/web/lib/catalog.js';

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

// 2) التجميع كما في التطبيق (بلا أسماء بديلة بعد)
const before = canonicalIndex();
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
      card.chapters = d?.chapters?.length ?? null;
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

// 5) بعد الربط بالأسماء البديلة
const after = canonicalIndex({ aliases });
for (const e of entries) after.add(e);

const merged = cards.filter((c) => new Set(c.editions.map((e) => mirrorFamily(e.sourceId))).size > 1);
const report = {
  rawEntries: entries.length,
  uniqueBefore: cards.length,
  uniqueAfter: after.list().length,
  crossSourceMerged: merged.length,
  detailsRead: done,
  withAliases: aliases.size,
  duplicatesVisibleBefore: duplicates.length,
  ambiguousRejected: after.rejected?.length ?? 0,
};
console.log('| المقياس | القيمة |\n|---|---|');
for (const [k, v] of Object.entries(report)) console.log(`| ${k} | ${v} |`);
console.log('\nتكرارات ظاهرة كُشفت (قبل الربط):');
for (const d of duplicates.slice(0, 40)) console.log(`- «${d.a}» [${d.sources[0].join('، ')}] = «${d.b}» [${d.sources[1].join('، ')}] ← ${d.evidence}`);
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
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ report, duplicates, rejected: after.rejected ?? [] }, null, 2));
