package com.vantara.anime.episodes

import com.vantara.anime.adapters.SourceEpisode

/**
 * «الحلقة 3» يجب أن تكون نفس الحلقة في كل المصادر التي تُجمع سيرفراتها في قائمة واحدة.
 *
 * بلاغ المالك (16 نوفمبر 2026، Tatsuki Fujimoto 17-26): عمل من قصص منفصلة، والمواقع ترتّب حلقاته
 * بترتيبات مختلفة. كانت سيرفرات «الحلقة 3» تُجمع من مصدرين بالرقم وحده، فسيرفر يشغّل الثالثة وآخر
 * يشغّل الرابعة، وتتغير الحلقة بتغيير السيرفر.
 *
 * القاعدة: المصدر الأول (الأعلى ترتيبًا) يحدد هوية الحلقة باسمها. مصدر لاحق اسم حلقته بنفس الرقم
 * مختلف بوضوح (بنفس الكتابة: لاتيني مع لاتيني، عربي مع عربي) وفي قائمته حلقة تحمل اسم حلقة المصدر
 * الأول برقم آخر = ترتيبه مختلف، فتُؤخذ تلك الحلقة بدل رقمها. وإن اختلف الاسم ولم نجد مطابقًا لا
 * نخلطه بالقائمة. الأسماء العامة («الحلقة 3»، «Episode 3») واللغات المختلفة لا تكفي دليلًا: يبقى
 * الرقم كما هو (السلوك السابق)، فلا نُسقط مصادر سليمة.
 */
object EpisodeAlign {
    sealed interface Result {
        /** استعمل هذه الحلقة (قد تكون نفس المختارة بالرقم أو المُصحّحة بالاسم). */
        data class Use(val episode: SourceEpisode, val realigned: Boolean) : Result
        /** اسمها حلقة أخرى ولا مطابق لاسم حلقة المصدر الأول: لا تُخلط سيراتها. */
        object Skip : Result
    }

    private val GENERIC = setOf(
        "episode", "ep", "eps", "e", "part", "pt", "final", "end", "the", "and", "of", "a", "an",
        "sub", "dub", "raw", "hd", "fhd", "uncensored", "special", "ova", "ona",
        "الحلقة", "حلقة", "الحلقه", "حلقه", "مترجمة", "مترجم", "مدبلجة", "مدبلج", "الأخيرة", "الاخيرة", "اون", "لاين",
    )

    private enum class Script { LATIN, ARABIC, OTHER }

    private fun script(text: String): Script {
        var latin = 0
        var arabic = 0
        for (ch in text) {
            if (ch in 'a'..'z') latin++
            else if (ch in '؀'..'ۿ') arabic++
        }
        return when {
            latin == 0 && arabic == 0 -> Script.OTHER
            latin >= arabic -> Script.LATIN
            else -> Script.ARABIC
        }
    }

    /** كلمات الاسم بلا أرقام ولا كلمات عامة ولا كلمات اسم العمل نفسه. */
    internal fun words(name: String, workTitle: String? = null): Set<String> {
        val split = Regex("[^\\p{L}]+")
        val work = workTitle?.lowercase()?.split(split)?.filter { it.isNotEmpty() }?.toSet().orEmpty()
        return name.lowercase().split(split)
            .filter { it.length >= 2 && it !in GENERIC && it !in work }
            .toSet()
    }

    /** اسم يميّز حلقة بعينها (لا «الحلقة 3» ولا اسم العمل وحده). */
    internal fun meaningful(words: Set<String>) = words.sumOf { it.length } >= 4

    /** يصلح اسمًا مرجعًا لهوية الحلقة؟ */
    fun identifies(name: String, workTitle: String? = null) = meaningful(words(name, workTitle))

    private fun similarity(a: Set<String>, b: Set<String>): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val inter = a.intersect(b).size.toDouble()
        return inter / (a.size + b.size - inter)
    }

    /**
     * [anchorName]: اسم الحلقة المطلوبة في المصدر الأول (null = لا مرجع بعد).
     * [picked]: حلقة هذا المصدر بالرقم (null = لا حلقة بهذا الرقم).
     */
    fun align(anchorName: String?, picked: SourceEpisode?, episodes: List<SourceEpisode>, workTitle: String? = null): Result? {
        val anchor = anchorName?.let { words(it, workTitle) }?.takeIf(::meaningful)
        if (anchor == null || picked == null) return picked?.let { Result.Use(it, false) }
        val mine = words(picked.name, workTitle)
        // لا دليل: اسم عام، أو كتابة مختلفة (عربي مقابل إنجليزي قد يكون ترجمة لنفس الحلقة)
        if (!meaningful(mine) || script(picked.name.lowercase()) != script(anchorName.lowercase())) return Result.Use(picked, false)
        if (similarity(anchor, mine) >= SAME) return Result.Use(picked, false)
        val match = episodes
            .map { it to similarity(anchor, words(it.name, workTitle)) }
            .filter { (e, s) -> s >= SAME && e !== picked }
            .maxByOrNull { it.second }
            ?.first
        return if (match != null) Result.Use(match, true) else Result.Skip
    }

    /** نفس الحلقة: نصف الكلمات على الأقل مشتركة. */
    private const val SAME = 0.5
}
