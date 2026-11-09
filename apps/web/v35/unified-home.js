/**
 * الرئيسية المشتركة (توحيد المحتوى): أعمالك من الأقسام الثلاثة في مكان واحد، كل عمل بوسم نوعه.
 *
 * ثلاث قواعد:
 *   - لا تُجمع القوائم مباشرة: كل العناصر تمرّ من نقطة واحدة (`unifiedFeed`) تستدعي `unifyFeed`
 *     من `lib/unified-identity.js` (منع التكرار عبر الأقسام). إلى أن يصل ذلك الملف، يطبّق الوسيط
 *     هنا إزالة تكرار بالمعرّفات المطابقة حرفيًا فقط، لا بالعنوان: مانجا وأنميها بالاسم نفسه عملان.
 *   - هذا عرض فقط: لا يكتب في المكتبة ولا التقدم ولا يدمجها. البيانات كما هي في جداولها.
 *   - صفحة التفاصيل يحددها نوع العمل (`section`)، لا القالب.
 */

export const KINDS = Object.freeze([
  { id: 'all', name: 'الكل' },
  { id: 'manga', name: 'مانجا' },
  { id: 'anime', name: 'أنمي' },
  { id: 'movie', name: 'أفلام', tag: 'فيلم' },
  { id: 'series', name: 'مسلسلات', tag: 'مسلسل' },
]);
export const KIND_TAG = Object.freeze({ manga: 'مانجا', anime: 'أنمي', movie: 'فيلم', series: 'مسلسل', cinema: 'سينما' });

/** القسم والنوع والمعرّفات من مرجع العمل في المزامنة. */
export function describeRef(ref, { label = '', cinemaTypes = {} } = {}) {
  const r = String(ref ?? '');
  if (r.startsWith('anime:')) {
    const raw = r.slice(6);
    return { section: 'anime', kind: 'anime', ids: /^\d+$/.test(raw) ? { anilist: raw } : {} };
  }
  if (r.startsWith('cinema:')) {
    const [, id, season] = r.split(':');
    const known = cinemaTypes[id];
    const kind = known === 'series' || known === 'movie' ? known : season || /الموسم|الحلقة/.test(label) ? 'series' : /فيلم/.test(label) ? 'movie' : 'cinema';
    return { section: 'cinema', kind, ids: /^tt\d+$/.test(id ?? '') ? { imdb: id } : {} };
  }
  if (r.startsWith('al:')) {
    const raw = r.slice(3);
    return { section: 'manga', kind: 'manga', ids: /^\d+$/.test(raw) ? { anilist: raw } : {} };
  }
  return { section: 'manga', kind: 'manga', ids: {} };
}

/**
 * عناصر الرئيسية من صفوف الحساب: المكتبة وآخر المشاهدات، الأحدث أولًا. عنصر لكل مرجع.
 * @param {(table: string, pick: (r: any) => boolean) => any[]} rows
 */
export function collectItems(rows, { userId, cinemaTypes = {} } = {}) {
  const mine = (r) => r.user_id === userId && !r.removed && typeof r.series_ref === 'string';
  const byRef = new Map();
  const add = (r, at, extra) => {
    const old = byRef.get(r.series_ref);
    if (old && old.at >= at) {
      Object.assign(old, { inLibrary: old.inLibrary || extra.inLibrary, label: old.label || extra.label || '' });
      return;
    }
    const label = extra.label ?? old?.label ?? '';
    const d = describeRef(r.series_ref, { label, cinemaTypes });
    byRef.set(r.series_ref, {
      ref: r.series_ref,
      ...d,
      title: r.series_title || old?.title || '',
      cover: r.cover_url || old?.cover || null,
      at,
      label,
      inLibrary: Boolean(extra.inLibrary || old?.inLibrary),
    });
  };
  for (const r of rows('work_views', mine)) add(r, r.viewed_at ?? 0, { label: r.chapter_label ?? '' });
  for (const r of rows('library', mine)) add(r, r.added_at ?? 0, { inLibrary: true });
  return [...byRef.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** مفاتيح هوية مطابقة حرفيًا. MAL يعدّ المانجا والأنمي بأرقام منفصلة، فمفتاحه بنوع الوسيط. */
function identityKeys(item) {
  const ids = item.ids ?? {};
  const media = item.section === 'manga' ? 'manga' : 'video';
  const keys = [`ref:${item.ref}`];
  if (ids.anilist) keys.push(`anilist:${ids.anilist}`);
  if (ids.mal) keys.push(`mal:${media}:${ids.mal}`);
  if (ids.imdb) keys.push(`imdb:${ids.imdb}`);
  if (ids.tmdb) keys.push(`tmdb:${ids.tmdbType ?? media}:${ids.tmdb}`);
  return keys;
}

/** الوسيط المؤقت: يدمج ما يتشارك معرّفًا مطابقًا حرفيًا. الأول (الأحدث) يحدد القسم. */
export function dedupeByIds(items) {
  const owner = new Map();
  const out = [];
  for (const item of items) {
    const keys = identityKeys(item);
    const hit = keys.map((k) => owner.get(k)).find(Boolean);
    if (hit) {
      hit.sources.push({ section: item.section, ref: item.ref });
      hit.ids = { ...item.ids, ...hit.ids };
      for (const k of identityKeys(item)) if (!owner.has(k)) owner.set(k, hit);
      continue;
    }
    const merged = { ...item, sources: [{ section: item.section, ref: item.ref }] };
    out.push(merged);
    for (const k of keys) owner.set(k, merged);
  }
  return out;
}

let identityImpl = null;
/**
 * يحمّل `unifyFeed` من وكيل منع التكرار إن وُجد ملفه. غيابه ليس خطأ: يبقى الوسيط.
 * @returns {Promise<Function|null>}
 */
export async function loadIdentity(importer = () => import('../lib/unified-identity.js')) {
  try {
    const m = await importer();
    if (typeof m?.unifyFeed === 'function') identityImpl = m.unifyFeed;
  } catch {
    // الملف لم يُدمج بعد
  }
  return identityImpl;
}

/**
 * النقطة الوحيدة التي تمر منها عناصر الرئيسية المشتركة. كل عنصر يخرج بـ`section` (صفحة تفاصيله)
 * و`sources` (من أين جاء).
 */
export function unifiedFeed(items, unify = identityImpl) {
  const input = items.map((i) => ({ ...i, id: i.id ?? i.ref, ids: { ...(i.ids ?? {}) } }));
  const list = (unify ?? dedupeByIds)(input);
  return list.map((group) => {
    const item = group.item ?? group;
    return {
      ...item,
      sources: (group.sources ?? [{ section: item.section, ref: item.ref }]).map((s) => ({ ...s, ref: s.ref ?? s.id })),
    };
  });
}

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();

/** تصفية بالنوع والبحث في العنوان. الأنمي لا يدخل «أفلام»: النوع هو القسم. */
export function filterItems(items, { kind = 'all', query = '' } = {}) {
  const q = fold(query);
  return items.filter((i) => (kind === 'all' || i.kind === kind) && (!q || fold(i.title).includes(q)));
}

export function countKinds(items) {
  const out = { all: items.length, manga: 0, anime: 0, movie: 0, series: 0 };
  for (const i of items) if (i.kind in out) out[i.kind] += 1;
  return out;
}
