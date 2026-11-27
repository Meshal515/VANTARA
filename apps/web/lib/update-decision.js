/**
 * عقل قرار «آخر التحديثات» المشترك (المرحلة 1 من docs/plans/2026-11-26-local-latest-updates.ar.md): الخادم
 * (services/sync-worker/src/updates.ts) والنظام المحلي القادم يستعملان القرار نفسه حرفيًا. نُقل كما هو بلا تغيير سلوك.
 * لا شبكة ولا تخزين هنا: دوال صافية تُختبر وحدها.
 *
 * @typedef {'chapter'|'episode'|'movie'} UnitKind
 * @typedef {{ season: number|null, number: number, publishedAt: number|null }} Unit
 * @typedef {{ season: number|null, number: number }} Mark
 */

/** أكبر قفزة تُقبل فوق خط الأساس؛ ما بعدها ترقيم مصدر خاطئ لا فصول جديدة. */
export const JUMP = Object.freeze({ chapter: 30, episode: 12 });

/** هوية الحدث: العمل + الوحدة. 12.50 و12.5 نفس الفصل. */
export function eventId(work, kind, season, number) {
  const n = number == null ? '' : String(Math.round(number * 1000) / 1000);
  if (kind === 'chapter') return `${work}|c:${n}`;
  if (kind === 'movie') return `${work}|movie`;
  return season == null ? `${work}|e:${n}` : `${work}|s${season}e:${n}`;
}

/** هل الوحدة فوق خط الأساس (الموسم أولًا ثم الرقم)؟ */
export const isAbove = (u, m) => (u.season ?? 0) > (m.season ?? 0) || ((u.season ?? 0) === (m.season ?? 0) && u.number > m.number);

/**
 * Every dated unit is history, including delayed catch-up below the watermark.
 * Undated first sightings stay a baseline; small later advances may use firstSeenAt.
 * The UI accepts live insertions only with a trustworthy, genuinely recent publishedAt.
 * An undated movie visit never manufactures a release event.
 * @param {{ kind: UnitKind, units: Unit[] }} report
 * @param {Mark|null} mark
 * @returns {{ fresh: Unit[], mark: Mark|null }}
 */
export function decide(report, mark, _now) {
  if (report.kind === 'movie') return { fresh: report.units.filter((u) => u.publishedAt != null).slice(0, 1), mark: mark ?? { season: null, number: 0 } };
  const sorted = [...report.units].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.number - b.number);
  const top = sorted[sorted.length - 1];
  const limit = JUMP[report.kind];
  if (!mark) {
    // UP1: خط الأساس الأول بفحص القفزة أيضًا. رقم شاذ كبير (قراءة خاطئة، RD7) كان يصير الخط من أول مشاهدة، فيرفض isAbove
    // كل الفصول الحقيقية بعده ويختفي العمل من «آخر التحديثات». الخط = أعلى رقم في الموسم الأعلى يتصل بما تحته (فجوته عن
    // الفصل الذي قبله ضمن حد القفزة)، والشاذ فوقه لا يصير خطًا ولا حدثًا. وحدة واحدة بلا ما يقارن بها تُقبل كما هي.
    const season = sorted.filter((u) => (u.season ?? 0) === (top.season ?? 0));
    let base = season[season.length - 1];
    for (let i = season.length - 1; i > 0; i--) {
      if (season[i].number - season[i - 1].number <= limit) { base = season[i]; break; }
      base = season[i - 1];
    }
    const outlier = (u) => (u.season ?? 0) === (base.season ?? 0) && u.number > base.number;
    return { fresh: sorted.filter((u) => u.publishedAt != null && !outlier(u)), mark: { season: base.season, number: base.number } };
  }
  const above = sorted.filter((u) => {
    if (!isAbove(u, mark)) return false;
    // موسم جديد يبدأ من أوله؛ وفي نفس الموسم قفزة معقولة فقط
    if ((u.season ?? 0) > (mark.season ?? 0)) return (u.season ?? 0) === (mark.season ?? 0) + 1 && u.number <= limit;
    return u.number - mark.number <= limit;
  });
  const fresh = [...sorted.filter((u) => u.publishedAt != null), ...above.filter((u) => u.publishedAt == null)];
  const last = above[above.length - 1];
  return { fresh, mark: last ? { season: last.season, number: last.number } : mark };
}
