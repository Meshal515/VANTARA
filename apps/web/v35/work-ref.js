/**
 * هوية العمل الواحدة: مرجعه، واسمه المعروض، ونسخه في المصادر.
 *
 * كل شاشة كانت تبني المرجع بطريقتها (`ext:` + العنوان بحروف صغيرة هنا،
 * و`ext:` + العنوان المطبَّع هناك)، فيصير العمل الواحد عملين: فريم «Wistoria:
 * Wand and Sword» ليس نفس عمل المكتبة. وكانت نسخ العمل (أي مصدر فيه وبأي رابط)
 * تُحفظ في جهاز من فتحه وحده، فيُفتح عمل صديقك عندك «لا فصول».
 *
 * هنا القواعد مرة واحدة:
 *   - المرجع من العنوان المطبَّع دائمًا (`refForTitle`).
 *   - المرجع الداخلي لا يُعرض أبدًا: الاسم من الخادم، ثم ما عندنا، ثم المرجع
 *     نفسه مكتوبًا كعنوان («ext:slam dunk» ← «Slam Dunk»).
 *   - النسخ اتحادُ ما عند الجهاز وما عند الخادم، والخادم يعرف ما عرفه أي جهاز.
 */

import { normalizeTitle } from '../lib/catalog.js';

const PREFIX = /^ext:/i;

export const isInternalRef = (text) => typeof text === 'string' && PREFIX.test(text.trim());

/** مرجع العمل في المزامنة. نفس القاعدة في المكتبة والمجلس والفريم. */
export function refForTitle(title) {
  const key = normalizeTitle(String(title ?? ''));
  return key ? `ext:${key}` : null;
}

/** «slam dunk» ← «Slam Dunk». العربي يبقى كما هو. */
export function titleFromRef(ref) {
  const key = String(ref ?? '').replace(PREFIX, '').trim();
  if (!key) return '';
  return key.replace(/(^|\s)([a-z])/g, (_, space, ch) => space + ch.toUpperCase());
}

/** أول اسمٍ حقيقي بين المرشّحين، وإلا اسمٌ مشتق من المرجع. لا يرجع `ext:` أبدًا. */
export function displayTitle(ref, ...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !isInternalRef(c)) return c.trim();
  }
  return titleFromRef(ref) || 'عمل';
}

/** نسخ العمل كما يحفظها الخادم: ما يلزم لفتحها فقط. */
export function compactEditions(editions) {
  return (editions ?? [])
    .filter((e) => e?.sourceId && e.manga?.url)
    .map((e) => ({
      sourceId: e.sourceId,
      label: e.label ?? e.sourceId,
      manga: {
        url: e.manga.url,
        title: e.manga.title ?? '',
        thumbnailUrl: e.manga.thumbnailUrl ?? null,
        memo: typeof e.manga.memo === 'string' ? e.manga.memo : '',
      },
    }));
}

export function serverEditions(row) {
  if (!row?.editions_json) return [];
  try {
    const list = JSON.parse(row.editions_json);
    return Array.isArray(list) ? compactEditions(list) : [];
  } catch {
    return [];
  }
}

/** اتحاد بالمصدر. الأول يفوز: نسخة الجهاز (بتفاصيلها) قبل نسخة الخادم المختصرة. */
export function mergeEditions(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const e of list ?? []) {
      if (!e?.sourceId || seen.has(e.sourceId)) continue;
      seen.add(e.sourceId);
      out.push(e);
    }
  }
  return out;
}

/** هل يعرف الجهاز عن العمل ما لا يعرفه الخادم؟ وحده هذا يستحق كتابة. */
export function describesMore(row, { title, coverUrl, editions }) {
  const known = new Set(serverEditions(row).map((e) => e.sourceId));
  const urls = new Map(serverEditions(row).map((e) => [e.sourceId, e.manga.url]));
  const newEdition = compactEditions(editions).some((e) => !known.has(e.sourceId) || urls.get(e.sourceId) !== e.manga.url);
  const newTitle = Boolean(title) && !isInternalRef(title) && !row?.title;
  const newCover = Boolean(coverUrl) && !row?.cover_url;
  return newEdition || newTitle || newCover;
}
