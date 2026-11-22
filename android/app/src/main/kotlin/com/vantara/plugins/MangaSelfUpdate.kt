package com.vantara.plugins

/**
 * التحديث الذاتي الآمن لإضافات المانجا (قرار المالك، 20 نوفمبر 2026؛ SE3 وEF1):
 *
 * - **يُحدَّث وحده فقط إن كان الإصدار الجديد آمنًا ويعمل:** آمن = توقيع المستودع وبصمته وتحميل فعلي لمصادره (كما في
 *   التثبيت اليدوي)؛ يعمل = مصدر واحد منه على الأقل أرجع أعمالًا فعلًا ([UpdatePreflight] بنتيجة VERIFIED).
 *   «لم يُتحقق لأن الموقع لم يرد» لا يكفي للتلقائي (يكفي لليدوي): يُترك لفحص الغد، والإصدار الحالي باقٍ.
 * - **يدويًا:** «حدّث الآن» يمر بالتثبيت نفسه (installExtension) ويرفع أي تثبيت للإصدار.
 * - **الرجوع:** «ارجع للإصدار السابق» يعيد آخر إصدار سليم محفوظ على الجهاز، ويُثبَّت عليه فلا يعود التلقائي للإصدار
 *   الذي رجع منه المستخدم؛ يُحدَّث تلقائيًا فقط إلى إصدار **أحدث** منه.
 * - EF1: صفحة اختفت (404/410) أو نطاق تغيّر أو قراءة فشلت (EXTENSION_PARSE) = سبب لفحص تحديث فوري لتلك الإضافة
 *   (مرة كل 6 ساعات على الأكثر)، لا انتظار فحص الغد.
 */
object MangaSelfUpdate {
    enum class Action { APPLY, SKIP_NOT_NEWER, SKIP_HELD, SKIP_UNVERIFIED, SKIP_REJECTED }

    const val DAILY_MS = 24 * 3_600_000L
    const val FAILURE_CHECK_GAP_MS = 6 * 3_600_000L

    /** إصدار المستودع أحدث من المثبت؟ برقم الإصدار إن عُرف للطرفين، وإلا باختلاف الاسم. */
    fun newer(installedCode: Long, installedName: String, repoCode: Long, repoName: String): Boolean =
        if (installedCode > 0 && repoCode > 0) repoCode > installedCode else repoName.isNotBlank() && repoName != installedName

    /**
     * قرار التحديث التلقائي. `held` رقم الإصدار الذي رجع منه المستخدم يدويًا (أو null). `verdict` نتيجة فحص الإصدار
     * الجديد، أو null إن لم يُفحص (لا يُطبَّق ما لم يُفحص).
     */
    fun decide(newer: Boolean, held: Long?, repoCode: Long, verdict: UpdatePreflight.Verdict?): Action = when {
        !newer -> Action.SKIP_NOT_NEWER
        held != null && (repoCode <= 0 || repoCode <= held) -> Action.SKIP_HELD
        verdict == null || !verdict.accept -> Action.SKIP_REJECTED
        verdict.code != "RUNTIME_UPDATE_VERIFIED" -> Action.SKIP_UNVERIFIED
        else -> Action.APPLY
    }

    /** أصناف الفشل التي تعني أن الإضافة قد تحتاج إصدارًا أحدث (EF1): الموقع تغيّر لا انقطع. */
    fun suggestsUpdate(code: String): Boolean =
        code == "SITE_HTTP_404" || code == "SITE_HTTP_410" || code == "EXTENSION_PARSE" || code == "EXTENSION_FAILED"
}
