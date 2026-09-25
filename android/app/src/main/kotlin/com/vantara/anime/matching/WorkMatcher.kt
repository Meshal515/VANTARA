package com.vantara.anime.matching

import java.text.Normalizer

/**
 * دمج النسخ بين المصادر: «One Piece» في WitAnime و«ون بيس» في OkAnime
 * و«ONE PIECE - الحلقات» في Anime4Up = عمل واحد في VANTARA.
 *
 * الترتيب من الأقوى للأضعف:
 *  1. معرّف خارجي مشترك (MAL/AniList) ← نفس العمل قطعًا.
 *  2. عنوان مطبَّع مطابق + نفس الموسم + نفس النوع (فيلم/مسلسل).
 *  3. تشابه كلمات عالٍ + نفس الموسم + لا تعارض في السنة/عدد الحلقات.
 *
 * والأهم ما **لا** يُدمج: الموسم الثاني ليس الأول، والفيلم ليس المسلسل،
 * و«Naruto» ليس «Naruto Shippuden». الدمج الخاطئ أسوأ من التكرار: يشغّل حلقة
 * من عمل آخر.
 */
data class WorkSignals(
    val titles: List<String>,
    val malId: Long? = null,
    val anilistId: Long? = null,
    val year: Int? = null,
    val episodes: Int? = null,
    val isMovie: Boolean? = null,
)

data class TitleKey(
    val base: String,
    val season: Int,
    val part: Int,
    val movie: Boolean,
    val tokens: Set<String>,
)

object TitleNormalizer {
    private val ARABIC_DIACRITICS = Regex("[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]")
    private val NOISE_AR = listOf("انمي", "أنمي", "مترجم", "مترجمة", "مدبلج", "مدبلجة", "الحلقات", "جميع", "كامل", "اون لاين", "مشاهدة", "تحميل", "حلقة", "الحلقة")
    private val NOISE_EN = setOf("anime", "the", "tv", "series", "subbed", "dubbed", "episodes", "episode", "online", "watch", "full", "hd", "arabic")
    private val ROMAN = mapOf("ii" to 2, "iii" to 3, "iv" to 4, "v" to 5, "vi" to 6)
    private val AR_ORDINALS = mapOf(
        "الاول" to 1, "الثاني" to 2, "الثالث" to 3, "الرابع" to 4, "الخامس" to 5, "السادس" to 6, "السابع" to 7, "الثامن" to 8,
    )

    /** حروف عربية موحّدة، لاتيني بلا تشكيل، أرقام غربية. */
    fun fold(raw: String): String {
        var s = Normalizer.normalize(raw, Normalizer.Form.NFKD).replace(Regex("\\p{Mn}+"), "")
        s = s.replace(ARABIC_DIACRITICS, "")
        s = s.replace(Regex("[أإآٱ]"), "ا").replace('ة', 'ه').replace('ى', 'ي').replace('ؤ', 'و').replace('ئ', 'ي')
        s = s.map { c -> if (c in '٠'..'٩') '0' + (c - '٠') else c }.joinToString("")
        return s.lowercase()
    }

    fun key(raw: String): TitleKey {
        var s = fold(raw)
        var season = 1
        var part = 1
        var movie = false

        Regex("(?:season|s)\\s*(\\d{1,2})\\b").find(s)?.let { season = it.groupValues[1].toInt(); s = s.replace(it.value, " ") }
        Regex("(\\d{1,2})(?:st|nd|rd|th)\\s+season").find(s)?.let { season = it.groupValues[1].toInt(); s = s.replace(it.value, " ") }
        Regex("(?:الموسم|الجزء|موسم)\\s*(\\d{1,2})").find(s)?.let { season = it.groupValues[1].toInt(); s = s.replace(it.value, " ") }
        for ((w, n) in AR_ORDINALS) {
            val r = Regex("(?:الموسم|الجزء)\\s+${fold(w)}")
            r.find(s)?.let { season = n; s = s.replace(it.value, " ") }
        }
        Regex("\\bpart\\s*(\\d)\\b|\\bcour\\s*(\\d)\\b").find(s)?.let {
            part = (it.groupValues[1].ifEmpty { it.groupValues[2] }).toInt(); s = s.replace(it.value, " ")
        }
        Regex("\\b(ii|iii|iv|v|vi)\\s*$").find(s.trim())?.let { m ->
            season = ROMAN.getValue(m.groupValues[1]); s = s.trim().removeSuffix(m.value)
        }
        if (Regex("\\b(movie|film)\\b|فيلم").containsMatchIn(s)) {
            movie = true
            s = s.replace(Regex("\\b(movie|film)\\b|فيلم"), " ")
        }
        for (w in NOISE_AR) s = s.replace(fold(w), " ")
        s = s.replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        val tokens = s.split(' ').filter { it.isNotBlank() && it !in NOISE_EN }
        // «2» في آخر العنوان موسم («Kaiju No. 8» ليس موسمًا: رقم قبله كلمة no)
        val tail = tokens.lastOrNull()?.toIntOrNull()
        val finalTokens = if (tail != null && tail in 2..9 && season == 1 && tokens.size > 1 && tokens[tokens.size - 2] != "no") {
            season = tail; tokens.dropLast(1)
        } else tokens
        return TitleKey(finalTokens.joinToString(" "), season, part, movie, finalTokens.toSet())
    }
}

object WorkMatcher {

    enum class Match { SAME, DIFFERENT, UNSURE }

    fun compare(a: WorkSignals, b: WorkSignals): Match {
        if (a.malId != null && b.malId != null) return if (a.malId == b.malId) Match.SAME else Match.DIFFERENT
        if (a.anilistId != null && b.anilistId != null) return if (a.anilistId == b.anilistId) Match.SAME else Match.DIFFERENT
        if (a.isMovie != null && b.isMovie != null && a.isMovie != b.isMovie) return Match.DIFFERENT
        if (a.year != null && b.year != null && kotlin.math.abs(a.year - b.year) > 1) return Match.DIFFERENT

        val ka = a.titles.map(TitleNormalizer::key)
        val kb = b.titles.map(TitleNormalizer::key)
        var best = Match.DIFFERENT
        for (x in ka) for (y in kb) {
            if (x.season != y.season || x.part != y.part || x.movie != y.movie) continue
            if (x.base.isNotEmpty() && x.base == y.base) return Match.SAME
            val sim = jaccard(x.tokens, y.tokens)
            // «naruto» ⊂ «naruto shippuden»: الاحتواء وحده ليس تطابقًا
            if (sim >= 0.85) return Match.SAME
            if (sim >= 0.6) best = Match.UNSURE
        }
        // المتردد يُحسم بعدد الحلقات إن عُرف
        if (best == Match.UNSURE && a.episodes != null && b.episodes != null) {
            return if (kotlin.math.abs(a.episodes - b.episodes) <= 2) Match.SAME else Match.DIFFERENT
        }
        return best
    }

    fun jaccard(a: Set<String>, b: Set<String>): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        return a.intersect(b).size.toDouble() / a.union(b).size
    }

    /** مفتاح تجميع سريع قبل المقارنة الدقيقة (لكتالوج بعشرات الآلاف). */
    fun bucket(title: String): String {
        val k = TitleNormalizer.key(title)
        return "${k.tokens.sorted().take(2).joinToString("|")}#${k.season}#${if (k.movie) "m" else "s"}"
    }
}
