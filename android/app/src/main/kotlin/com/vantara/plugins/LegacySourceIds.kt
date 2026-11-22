package com.vantara.plugins

import dev.vantara.spike.SPIKE_SOURCES

/**
 * المرحلة 1 من «صفر مصادر مدمجة» (docs/audits/ZERO_BUILTIN_MIGRATION_PLAN.md): قراءة الصيغتين.
 *
 * المكتبة والتقدّم والتنزيلات والعلامات حفظت مصادر الحزم المدمجة سابقًا بمعرّفها القديم: `pkg` (المصدر العربي)
 * و`pkg@lang` (التكملة). الإضافة المثبّتة من مستودع تُعرف بـ`pkg#sourceId`. هنا الجسر بينهما، من بيانات الحزم المدمجة
 * نفسها (SPIKE_SOURCES وFILLER_SOURCES)، بلا جدول ثانٍ يُنسى تحديثه:
 *
 *  - المعرّف القديم يبقى هو المعرّف الظاهر للواجهة لمصدر الحزمة نفسها وإن صار إضافة مثبّتة، فلا يُعاد كتابة صف واحد،
 *    وكل جهاز (حتى بإصدار أقدم) يقرأ نفس المعرّف.
 *  - معرّف قديم يُطلب بينما حزمته مثبّتة من مستودع: يُحمَّل المصدر نفسه من الإضافة المثبّتة.
 *  - `pkg#sourceId` لحزمة مدمجة غير مثبّتة من مستودع (من جهاز آخر مثلًا): يُحمَّل من المدمجة.
 *
 * الاختيار هنا مطابق لما يحمّله المحرك للمعرّف القديم: العربي بـarabicSourceIds ثم أول مصدر عربي
 * (selectArabicSources)، والتكملة بمعرّفها المثبّت ثم أول مصدر بلغتها.
 */
object LegacySourceIds {
    /** مصدر داخل حزمة: معرّفه ولغته، كما في الحزمة المحمّلة أو في سجل الإضافة المثبّتة. */
    data class Entry(val id: String, val lang: String)

    /** هل للحزمة معرّفات قديمة أصلًا (مدمجة سابقًا)؟ */
    fun isFormerBuiltin(pkg: String): Boolean = packageSpec(pkg) != null

    /** المصدر العربي الذي يعنيه المعرّف القديم `pkg`، من مصادر الحزمة. */
    private fun arabicChoice(pkg: String, all: List<Entry>): Entry? {
        val spec = SPIKE_SOURCES.firstOrNull { it.pkg == pkg } ?: return null
        val exact = if (spec.arabicSourceIds.isNotEmpty()) all.filter { it.id in spec.arabicSourceIds } else emptyList()
        return exact.ifEmpty { all.filter { it.lang.equals("ar", ignoreCase = true) } }.firstOrNull()
    }

    /** المصدر الذي يعنيه `pkg@lang`. */
    private fun fillerChoice(pkg: String, lang: String, all: List<Entry>): Entry? {
        val filler = FILLER_SOURCES.firstOrNull { it.pkg == pkg && it.lang == lang } ?: return null
        return filler.sourceId?.let { id -> all.firstOrNull { it.id == id } } ?: all.firstOrNull { it.lang.equals(lang, ignoreCase = true) }
    }

    /**
     * المعرّف الظاهر لمصدر من إضافة مثبّتة: القديم إن كان هذا المصدر هو ما يعنيه معرّف قديم لحزمته، وإلا `pkg#id`.
     */
    fun visibleId(pkg: String, source: Entry, all: List<Entry>): String {
        if (!isFormerBuiltin(pkg)) return "$pkg#${source.id}"
        if (arabicChoice(pkg, all)?.id == source.id) return pkg
        for (filler in FILLER_SOURCES) {
            if (filler.pkg == pkg && fillerChoice(pkg, filler.lang, all)?.id == source.id) return "$pkg@${filler.lang}"
        }
        return "$pkg#${source.id}"
    }

    /** معرّف قديم (`pkg` أو `pkg@lang`) ← معرّف المصدر داخل الحزمة، أو null إن لم يعنِ مصدرًا منها. */
    fun sourceIdFor(legacyId: String, all: List<Entry>): String? {
        if ('#' in legacyId) return null
        val (pkg, lang) = splitSourceId(legacyId)
        if (!isFormerBuiltin(pkg)) return null
        return (if (lang == null) arabicChoice(pkg, all) else fillerChoice(pkg, lang, all))?.id
    }
}
