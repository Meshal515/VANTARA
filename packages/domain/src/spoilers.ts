/**
 * حجب التعليقات حسب تقدم القارئ.
 *
 * أرقام الفصول في هذا العالم ليست أعدادًا عشرية بسيطة: يوجد 0 وPrologue و1.5
 * و10.1 وSpecial وSide Story وExtra وEpilogue. الترتيب هنا يتعامل مع ذلك بدل
 * أن يفترض float.
 */

export interface ChapterOrder {
  /** الرقم إن كان للفصل رقم. */
  number?: number;
  /** فصول خارج الترقيم: Prologue قبل الكل، Epilogue بعده. */
  kind?: 'prologue' | 'numbered' | 'special' | 'side' | 'extra' | 'epilogue';
}

const KIND_RANK: Record<NonNullable<ChapterOrder['kind']>, number> = {
  prologue: -1,
  numbered: 0,
  // الخاصة والجانبية والإضافية لا تقع في سلسلة القصة، فتُرتَّب بعد رقمها
  special: 0.5,
  side: 0.5,
  extra: 0.5,
  epilogue: 1,
};

/**
 * مفتاح ترتيب مركّب: [الرقم، رتبة النوع].
 * Prologue بلا رقم يسبق الفصل 0؛ Epilogue بلا رقم يلي الجميع.
 */
export function orderKey(chapter: ChapterOrder): [number, number] {
  const kind = chapter.kind ?? 'numbered';
  if (chapter.number === undefined) {
    if (kind === 'prologue') return [Number.NEGATIVE_INFINITY, 0];
    if (kind === 'epilogue') return [Number.POSITIVE_INFINITY, 0];
    return [Number.POSITIVE_INFINITY, KIND_RANK[kind]];
  }
  return [chapter.number, KIND_RANK[kind]];
}

export function compareChapters(a: ChapterOrder, b: ChapterOrder): number {
  const [an, ak] = orderKey(a);
  const [bn, bk] = orderKey(b);
  if (an !== bn) return an < bn ? -1 : 1;
  return ak - bk;
}

/**
 * هل يُعرض تعليق مربوط بفصل لقارئ وصل إلى فصل معيّن؟
 *
 * `undefined` للتقدم يعني "لم يبدأ" ⇒ يُحجب كل ما هو مربوط بفصل.
 * التعليق غير المربوط بفصل (`after` غير معرّف) يُعرض دائمًا.
 */
export function isVisible(
  after: ChapterOrder | undefined,
  readerProgress: ChapterOrder | undefined,
): boolean {
  if (after === undefined) return true;
  if (readerProgress === undefined) return false;
  return compareChapters(readerProgress, after) >= 0;
}

export interface MaskedComment<T> {
  comment: T;
  masked: boolean;
}

/** يبقي التعليق في القائمة لكن يعلّمه محجوبًا — الواجهة تعرض "اضغط لكشف". */
export function maskSpoilers<T>(
  comments: readonly T[],
  spoilerOf: (comment: T) => ChapterOrder | undefined,
  readerProgress: ChapterOrder | undefined,
): MaskedComment<T>[] {
  return comments.map((comment) => ({
    comment,
    masked: !isVisible(spoilerOf(comment), readerProgress),
  }));
}
