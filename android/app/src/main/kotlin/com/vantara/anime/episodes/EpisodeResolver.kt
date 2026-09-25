package com.vantara.anime.episodes

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.StreamRanker
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs

/**
 * الحلقة عبر المصادر.
 *
 * العمل في VANTARA له نسخ في عدة مصادر ([Copy]). طلب «الحلقة 12» يعني:
 *   1. رتّب النسخ بصحة مصادرها.
 *   2. من كل نسخة: قائمة حلقاتها (مخبّأة دقائق) ← الحلقة رقم 12.
 *   3. اجمع كل سيرفراتها. إذا جمعنا [minCandidates] طريقًا سليمًا توقفنا؛
 *      وإلا ننتقل للمصدر التالي. فمصدر ميت لا يُشعر به المستخدم.
 */
class EpisodeResolver(
    private val adapterOf: suspend (String) -> AnimeAdapter?,
    private val health: HealthStore,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    data class Copy(val sourceId: String, val anime: SourceAnime)

    private data class Cached(val at: Long, val episodes: List<SourceEpisode>)
    private val episodeCache = ConcurrentHashMap<String, Cached>()

    suspend fun episodes(copy: Copy): List<SourceEpisode> {
        val key = "${copy.sourceId}|${copy.anime.url}"
        episodeCache[key]?.takeIf { clock() - it.at < EPISODES_TTL_MS }?.let { return it.episodes }
        val adapter = adapterOf(copy.sourceId) ?: return emptyList()
        val list = adapter.episodes(copy.anime)
        episodeCache[key] = Cached(clock(), list)
        return list
    }

    /** نفس الحلقة في قائمة مصدر آخر: بالرقم، مع تسامح للترقيم العشري (12.5). */
    fun pick(episodes: List<SourceEpisode>, number: Float): SourceEpisode? =
        episodes.firstOrNull { abs(it.number - number) < 0.01f }
            ?: episodes.firstOrNull { Regex("(?<![\\d.])${number.toInt()}(?![\\d.])").containsMatchIn(it.name) && number % 1f == 0f }

    suspend fun candidates(
        copies: List<Copy>,
        number: Float,
        prefs: Preferences,
        minCandidates: Int = 3,
        perSourceTimeoutMs: Long = 25_000,
    ): List<Candidate> {
        val ordered = health.rank(copies) { HealthStore.sourceKey(it.sourceId) }
        val gathered = mutableListOf<Candidate>()
        // دفعات من مصدرين بالتوازي: الأول يبدأ فورًا، والثاني احتياطٌ جاهز
        for (batch in ordered.chunked(2)) {
            val found = coroutineScope {
                batch.map { copy ->
                    async {
                        withTimeoutOrNull(perSourceTimeoutMs) {
                            runCatching {
                                val ep = pick(episodes(copy), number) ?: return@runCatching emptyList()
                                adapterOf(copy.sourceId)?.candidates(ep).orEmpty()
                            }.onFailure { health.fail(HealthStore.sourceKey(copy.sourceId), it.message ?: it.javaClass.simpleName) }
                                .getOrDefault(emptyList())
                        }.orEmpty()
                    }
                }.awaitAll().flatten()
            }
            gathered += found
            val usable = gathered.count { !health.skip(HealthStore.hostKey(it.host)) }
            if (usable >= minCandidates) break
        }
        return StreamRanker.rank(gathered.distinctBy { it.url }, health, prefs, clock())
    }

    private companion object {
        const val EPISODES_TTL_MS = 10 * 60_000L
    }
}
