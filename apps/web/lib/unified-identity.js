/**
 * الهوية الموحدة عبر الأقسام: دالة تجميع نقية لـ«توحيد المحتوى» (الرئيسية المشتركة).
 * لا تُستدعى من الواجهة بعد؛ تُوصل بـ`unifyFeed` (فرع وكيل الإعدادات) هكذا:
 *   unifyFeed(items) = unifyWorks(items, { imdbOfAnilist, seasonsOfImdb, animeOfImdb })
 *
 * المدخل: مصفوفة عناصر بالترتيب المطلوب للعرض، كل عنصر:
 *   {
 *     section: 'manga' | 'anime' | 'cinema',
 *     id: string,          // مرجع القسم نفسه: 'ext:<مفتاح>' | 'anime:<AniList>' | 'tt…' أو 'cinema:tt…'
 *     kind?: string,       // الأنمي: صيغة AniList (TV, TV_SHORT, ONA, MOVIE, OVA, SPECIAL, MUSIC)
 *                          // السينما: 'movie' | 'series'
 *     ids?: { anilist?: number, mal?: number, imdb?: 'tt…', season?: number }, // season: موسم سينمائي صريح
 *     ...أي حقول أخرى تُحمل كما هي
 *   }
 * الخيارات (كلها اختيارية، بيانات محفوظة لا شبكة):
 *   imdbOfAnilist(al) → { imdb: 'tt…', seasons?: number[] } | null   // ani.zip (anime-imdb.js parseAniZip)
 *   seasonsOfImdb(imdb) → عدد مواسم المسلسل في Cinemeta | null
 *   animeOfImdb(imdb, group) → عدد أعمال AniList بصيغة group ('movie' | 'series') التي يربطها ani.zip بهذا IMDb
 *
 * المخرج: مصفوفة بلا تكرار، بترتيب أول ظهور:
 *   { section, id, kind, item, sources: [{ section, id, kind, item }] }
 *   `section`/`id`/`item` للمصدر الأساسي الذي يحدد صفحة التفاصيل: الأنمي إن وُجد (نوعه الأصلي)، وإلا أول ظهور.
 *
 * القواعد (في الشك: عملان):
 *   - داخل القسم: المانجا بفئة مرجعها (canonicalRefOf)، والأنمي بمعرّف AniList، والسينما بنوع+IMDb.
 *   - المانجا لا تُدمج مع غير المانجا أبدًا (المانجا وأنميها عملان مرتبطان).
 *   - أنمي ↔ سينما بمعرّف IMDb وحده (ani.zip/Wikidata)، وبشرطين:
 *       فيلم ↔ فيلم فقط، ومسلسل (TV/TV_SHORT/ONA) ↔ مسلسل فقط؛ OVA/SPECIAL/MUSIC لا تُدمج.
 *       IMDb يملكه عمل AniList واحد فقط؛ والمسلسل يغطي موسمًا واحدًا هو موسم بطاقة السينما
 *       الصريح، أو المسلسل كله موسم واحد. وإلا (مواسم AniList المنفصلة تحت IMDb واحد) يبقيان منفصلين.
 * الكلفة خطية: Map وunion-find، بلا مقارنة أزواج.
 */
import { canonicalRefOf } from './manga-alias-store.js';

const SERIES = new Set(['TV', 'TV_SHORT', 'ONA']);
const tt = (v) => (/^tt\d+$/.test(String(v ?? '')) ? String(v) : null);

function keysOf(it) {
  const ids = it.ids ?? {};
  const id = String(it.id ?? '');
  if (it.section === 'manga') {
    const out = [`manga:${canonicalRefOf(id)}`];
    if (ids.anilist) out.push(`manga-al:${ids.anilist}`);
    return out;
  }
  if (it.section === 'anime') {
    const al = Number(ids.anilist ?? (/^anime:\d+$/.test(id) ? id.slice(6) : NaN));
    const mal = Number(ids.mal ?? (/^mal:\d+$/.test(id) ? id.slice(4) : NaN));
    if (Number.isFinite(al) && al > 0) return [`anime:${al}`];
    // بطاقة بمعرّف MAL وحده: تُربط لاحقًا بعمل AniList الذي يحمل هذا MAL إن كان واحدًا فقط (malOf)
    if (Number.isFinite(mal) && mal > 0) return [`anime-mal:${mal}`];
    return [`anime-id:${id}`];
  }
  if (it.section === 'cinema') {
    const imdb = tt(ids.imdb) ?? tt(id.replace(/^cinema:/, '').split(':')[0]);
    const kind = it.kind === 'series' ? 'series' : 'movie';
    if (!imdb) return [`cinema-id:${id}`];
    return [`cinema:${kind}:${imdb}${kind === 'series' && Number.isInteger(ids.season) ? `:s${ids.season}` : ''}`];
  }
  return [`other:${it.section}:${id}`];
}

/**
 * مفتاح السينما الذي يطابق عمل الأنمي هذا، أو null.
 * `animeOfImdb(imdb, group)` يعدّ أعمال AniList بالصيغة نفسها ('movie' | 'series') تحت هذا IMDb؛
 * الـOVA والخاصة لا تنافس المسلسل (One Piece: مسلسل واحد + حلقتا OVA تحت tt0388629).
 */
export function animeCinemaKey(it, { imdbOfAnilist = () => null, seasonsOfImdb = () => null, animeOfImdb = () => null, cinemaKeys = null } = {}) {
  const ids = it.ids ?? {};
  const al = Number(ids.anilist ?? (/^anime:\d+$/.test(String(it.id ?? '')) ? String(it.id).slice(6) : NaN));
  const mapped = Number.isFinite(al) && al > 0 ? imdbOfAnilist(al) : null;
  const imdb = tt(ids.imdb) ?? tt(mapped?.imdb);
  if (!imdb) return null;
  const group = it.kind === 'MOVIE' ? 'movie' : SERIES.has(it.kind) ? 'series' : null;
  if (!group) return null;
  const owners = animeOfImdb(imdb, group);
  if (owners != null && owners !== 1) return null;
  if (group === 'movie') return `cinema:movie:${imdb}`;
  const seasons = [...new Set((mapped?.seasons ?? []).filter((s) => Number.isInteger(s) && s > 0))];
  const total = seasonsOfImdb(imdb);
  if (seasons.length === 1) {
    const explicit = `cinema:series:${imdb}:s${seasons[0]}`;
    if (cinemaKeys?.has(explicit)) return explicit;
  }
  // المسلسل كله: العمل الوحيد بصيغة مسلسل تحت IMDb، ومواسمه في ani.zip تغطي كل مواسم Cinemeta.
  // موسم أول وحده تحت مسلسل من أربعة مواسم ليس المسلسل (لا دمج للموسم بالسلسلة الأم).
  if (owners === 1 && Number.isInteger(total) && total > 0 && seasons.length >= total && seasons.includes(1)) return `cinema:series:${imdb}`;
  if (owners == null && seasons.length === 1 && seasons[0] === 1 && total === 1) return `cinema:series:${imdb}`;
  return null;
}

export function unifyWorks(items, options = {}) {
  const list = (items ?? []).filter((it) => it && it.section && it.id != null);
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const byKey = new Map();
  const claim = (key, i) => { if (byKey.has(key)) union(byKey.get(key), i); else byKey.set(key, i); };
  list.forEach((it, i) => { for (const k of keysOf(it)) claim(k, i); });
  // MAL ← AniList: قد يقسم AniList مدخل MAL واحدًا عملين (مثلًا ONA بجزأين)، فلا ربط إلا بمالك واحد
  const malOwners = new Map();
  list.forEach((it, i) => {
    const mal = Number(it.ids?.mal);
    if (it.section !== 'anime' || !(mal > 0) || !keysOf(it)[0].startsWith('anime:')) return;
    if (!malOwners.has(mal)) malOwners.set(mal, new Set());
    malOwners.get(mal).add(find(i));
  });
  for (const [mal, owners] of malOwners) if (owners.size === 1 && byKey.has(`anime-mal:${mal}`)) union(byKey.get(`anime-mal:${mal}`), [...owners][0]);
  const cinemaKeys = new Set([...byKey.keys()].filter((k) => k.startsWith('cinema:')));
  // عملان أنمي مختلفان يشيران لبطاقة سينما واحدة: لا أحد منهما يُدمج (لا نجمع موسمين عبر السينما)
  const wanted = new Map();
  list.forEach((it, i) => {
    if (it.section !== 'anime') return;
    const key = animeCinemaKey(it, { ...options, cinemaKeys });
    if (!key || !byKey.has(key)) return;
    if (!wanted.has(key)) wanted.set(key, new Map());
    wanted.get(key).set(find(i), i);
  });
  for (const [key, owners] of wanted) if (owners.size === 1) union(byKey.get(key), [...owners.values()][0]);
  // اختياري (`franchiseToRoot`): بطاقة مسلسل سينما تمثّل سلسلة أنمي مقسّمة مواسم في AniList تُلحق بأول
  // موسم (مواسمه في ani.zip تبدأ بـ1) مصدرًا له، فلا تظهر مرة ثانية في الرئيسية المشتركة. المواسم الأخرى
  // تبقى أعمالًا مستقلة ولا تُجمع ببعضها.
  if (options.franchiseToRoot) {
    const { imdbOfAnilist = () => null } = options;
    const roots = new Map();
    list.forEach((it, i) => {
      if (it.section !== 'anime' || !SERIES.has(it.kind)) return;
      const al = Number(it.ids?.anilist ?? (/^anime:\d+$/.test(String(it.id)) ? String(it.id).slice(6) : NaN));
      const m = imdbOfAnilist(al);
      const imdb = tt(it.ids?.imdb) ?? tt(m?.imdb);
      const seasons = (m?.seasons ?? []).filter((s) => s > 0);
      if (!imdb || !seasons.length || Math.min(...seasons) !== 1) return;
      if (!roots.has(imdb)) roots.set(imdb, new Set());
      roots.get(imdb).add(find(i));
    });
    for (const [imdb, set] of roots) {
      const key = `cinema:series:${imdb}`;
      if (set.size !== 1 || !byKey.has(key) || find(byKey.get(key)) !== byKey.get(key) && [...set][0] === find(byKey.get(key))) continue;
      const cinemaRoot = find(byKey.get(key));
      if (list[cinemaRoot].section !== 'cinema') continue; // سبق دمجها بأنمي آخر
      union(cinemaRoot, [...set][0]);
    }
  }
  const groups = new Map();
  list.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, members]) => {
    const primary = members.find((m) => m.section === 'anime') ?? members[0];
    const sources = [];
    const seen = new Set();
    for (const m of members) {
      const k = `${m.section}|${m.id}`;
      if (!seen.has(k)) { seen.add(k); sources.push({ section: m.section, id: m.id, kind: m.kind ?? null, item: m }); }
    }
    return { section: primary.section, id: primary.id, kind: primary.kind ?? null, item: primary, sources };
  });
}

/**
 * نقطة الدخول التي يحمّلها وكيل الإعدادات (`unifyFeed`) إن وُجد هذا الملف. تجريبية: لا تُفعَّل في الواجهة.
 * @param {Array<{section:'manga'|'anime'|'cinema', id:string, kind?:string, ids?:object}>} items بترتيب العرض
 * @param {{ imdbOfAnilist?: Function, seasonsOfImdb?: Function, animeOfImdb?: Function, franchiseToRoot?: boolean }} [options]
 * @returns {Array<{section, id, kind, item, sources}>} عمل واحد لكل مجموعة، بترتيب أول ظهور
 */
export function unifyFeed(items, options = {}) {
  return unifyWorks(items, options);
}
