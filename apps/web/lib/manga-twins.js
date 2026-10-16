/**
 * أعمال مكررة بأسماء متقاربة: «City Of Sin» عند TeamX و«City of Sins» عند MangaSwat، و«Murim
 * Psychopath» و«Psychopath in Murim». كل مصدر يسمّي العمل بترجمته فتظهر بطاقتان وثلاث بأغلفة
 * مختلفة. الاسم وحده لا يكفي دليلًا (City of Sin قد يكون غير City of Sins)، أما الاسم المتقارب
 * مع **نفس أعلى فصل** في مصدرين فدليل قوي. والخادم يعرف أعلى فصل لكل عمل من كل الأجهزة والجامعين
 * (`/v1/updates/twins`)، والحساب هنا على الجهاز (خطة الخادم المجانية لا تتسع له).
 *
 * الناتج أسماء بديلة (المالك ← أسماؤه الأخرى) تدخل فهرس البطاقات كأي اسم بديل، وحارس الفهرس
 * باقٍ: مصدر يعرض الاسمين عملين منفصلين لا يُدمجان أبدًا.
 */
import { singular } from './catalog.js';

const STOP = new Set(['s', 't', 'the', 'a', 'an', 'of', 'and', '&', 'in', 'to', 'is', 'my', 'i', 'as', 'for', 'with', 'on', 'at', 'from', 'by', 'who', 'that', 'me']);
const YEAR = /^(?:19|20)\d\d$/;

function prepare(key, number) {
  if (typeof key !== 'string' || !Number.isFinite(number) || number < 5) return null;
  const tokens = key.split(' ').filter(Boolean);
  // عنوان بغير اللاتينية لا يُقارن هنا (الأسماء العربية لها أدلتها من صفحات الأعمال)
  if (!tokens.length || tokens.some((t) => !/^[a-z0-9]+$/.test(t))) return null;
  const list = tokens.filter((t) => !STOP.has(t) && !/^\d+$/.test(t)).map(singular);
  if (list.length < 2) return null;
  return {
    key,
    number,
    list,
    words: new Set(list),
    // موسم/جزء (2، 3) يفرّق عملين؛ سنة الإصدار («(2022)») لا تُحسب
    digits: tokens.filter((t) => /^\d+$/.test(t) && !YEAR.test(t)).join(' '),
    loose: list.join(' '),
    chars: list.join('').length,
  };
}

/** هل العملان واحد؟ الاسم متقارب والفصل نفسه (أو قريب جدًا لاسم شبه مطابق). */
export function twins(a, b) {
  if (a.digits !== b.digits) return false;
  const diff = Math.abs(a.number - b.number);
  if (diff > 3) return false;
  const low = Math.min(a.number, b.number);
  if (a.loose === b.loose) return true;
  let shared = 0;
  for (const w of a.words) if (b.words.has(w)) shared += 1;
  const sim = shared / (a.words.size + b.words.size - shared);
  const [short, long] = a.words.size <= b.words.size ? [a, b] : [b, a];
  if (shared === short.words.size && short.words.size < long.words.size) {
    // اسم داخل اسم أطول: «Shangri-La Frontier» = «Shangri-La Frontier ~Kusoge Hunter…»، و«Pick Me Up» =
    // «Pick Me Up: Infinite Gacha». لكن «Shuumatsu no Harem» غير «… Fantasia» (فصل 6)، و«The End is
    // a Game to Me» ليس داخل عنوان طويل فيه «game» و«end» صدفة. فالفصل نفسه، 20 فما فوق، والقصير
    // أول الطويل أو نصفه على الأقل
    const prefix = short.list.every((w, i) => long.list[i] === w);
    return diff === 0 && low >= 20 && shared >= 2 && short.chars >= 6 && (prefix || sim >= 0.4);
  }
  if (low < 10) return false;
  return diff === 0 ? sim >= 0.6 : sim >= 0.7;
}

/**
 * `rows`: [مفتاح العمل (بلا «ext:»)، أعلى فصل]. يرجع { المالك: [أسماء أخرى] } لكل مجموعة متطابقة
 * (المالك أطول الأسماء ثم الأسبق أبجديًا).
 */
export function twinAliases(rows) {
  const list = rows.map(([key, number]) => prepare(key, Number(number))).filter(Boolean);
  // فهرس الكلمات: لا يُقارن عمل إلا بمن يشاركه كلمة
  const byWord = new Map();
  list.forEach((p, i) => { for (const w of p.words) { const l = byWord.get(w) ?? []; l.push(i); byWord.set(w, l); } });
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  list.forEach((p, i) => {
    const seen = new Set();
    for (const w of p.words) {
      const peers = byWord.get(w);
      if (peers.length > 200) continue; // كلمة شائعة جدًا: بقية الكلمات تكفي
      for (const j of peers) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        if (twins(p, list[j])) parent[find(j)] = find(i);
      }
    }
  });
  const groups = new Map();
  list.forEach((p, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), p]); });
  const out = {};
  for (const g of groups.values()) {
    if (g.length < 2 || g.length > 4) continue; // أكثر من أربعة أسماء متقاربة: سلسلة أعمال لا عمل واحد
    const owner = [...g].sort((x, y) => y.key.length - x.key.length || x.key.localeCompare(y.key))[0];
    out[owner.key] = g.filter((p) => p !== owner).map((p) => p.key);
  }
  return out;
}
