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
/**
 * مفتاح ترتيب مركّب: [الرقم، رتبة النوع].
 * Prologue بلا رقم يسبق الفصل 0؛ Epilogue بلا رقم يلي الجميع.
 */
export declare function orderKey(chapter: ChapterOrder): [number, number];
export declare function compareChapters(a: ChapterOrder, b: ChapterOrder): number;
/**
 * هل يُعرض تعليق مربوط بفصل لقارئ وصل إلى فصل معيّن؟
 *
 * `undefined` للتقدم يعني "لم يبدأ" ⇒ يُحجب كل ما هو مربوط بفصل.
 * التعليق غير المربوط بفصل (`after` غير معرّف) يُعرض دائمًا.
 */
export declare function isVisible(after: ChapterOrder | undefined, readerProgress: ChapterOrder | undefined): boolean;
export interface MaskedComment<T> {
    comment: T;
    masked: boolean;
}
/** يبقي التعليق في القائمة لكن يعلّمه محجوبًا — الواجهة تعرض "اضغط لكشف". */
export declare function maskSpoilers<T>(comments: readonly T[], spoilerOf: (comment: T) => ChapterOrder | undefined, readerProgress: ChapterOrder | undefined): MaskedComment<T>[];
//# sourceMappingURL=spoilers.d.ts.map