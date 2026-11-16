package com.vantara.anime.bridge

/**
 * Aniyomi publisher updates cannot replace a working content-addressed APK based
 * only on signature, DexClassLoader, or factory registration. Every source in the candidate runs a bounded
 * catalogue/details/episode/media journey; [com.vantara.plugins.UpdatePreflight] decides. On failure the old
 * source IDs, user library and APK pointer remain.
 */
internal object AniyomiUpdateGate {
    suspend fun verify(
        previousSha: String?,
        candidateSha: String,
        sourceIds: List<String>,
        probe: suspend (String) -> Boolean,
    ) {
        if (previousSha == null || previousSha.equals(candidateSha, ignoreCase = true)) return
        require(sourceIds.isNotEmpty() && sourceIds.toSet().size == sourceIds.size) {
            "ANIYOMI_UPDATE_SOURCE_ID_INVALID"
        }
        // AU1: كل مصدر يُفحص، والقاعدة المشتركة (UpdatePreflight) تحكم: عدم توافق الكود يرفض، ومصدر ناجح واحد أو
        // إخفاقات بسبب البيئة فقط (حجب، Cloudflare، HLS مشفّر، magnet، مهلة) تقبل. كان أي مصدر لا يُفحص يرفض للأبد.
        val outcomes = sourceIds.map { id ->
            try {
                if (probe(id)) com.vantara.plugins.UpdatePreflight.Outcome.Passed
                else com.vantara.plugins.UpdatePreflight.Outcome.Failed(IllegalStateException("candidate source $id is not usable"))
            } catch (timedOut: kotlinx.coroutines.TimeoutCancellationException) {
                com.vantara.plugins.UpdatePreflight.Outcome.Failed(timedOut)
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                com.vantara.plugins.UpdatePreflight.Outcome.Failed(failure)
            }
        }
        val verdict = com.vantara.plugins.UpdatePreflight.decide(outcomes)
        require(verdict.accept) { "ANIYOMI_UPDATE_PREFLIGHT_FAILED: ${verdict.code}" }
    }

    /** The adapter is the real candidate APK, before any active metadata changes. */
    suspend fun verifyJourney(adapter: com.vantara.anime.adapters.AnimeAdapter,
        media: suspend (List<com.vantara.anime.stream.Candidate>) -> Unit) {
        val work = adapter.page(com.vantara.anime.adapters.Listing.POPULAR, 1).items.firstOrNull()
        require(work != null) { "ANIYOMI_UPDATE_CATALOGUE_EMPTY" }
        var detail = adapter.details(work)
        if (detail.hasSeasons) {
            val season = adapter.seasons(detail).firstOrNull()
            require(season != null) { "ANIYOMI_UPDATE_SEASONS_EMPTY" }
            detail = adapter.details(season)
        }
        val episode = adapter.episodes(detail).firstOrNull()
        require(episode != null) { "ANIYOMI_UPDATE_EPISODES_EMPTY" }
        val links = adapter.candidates(episode)
        require(links.isNotEmpty()) { "ANIYOMI_UPDATE_MEDIA_EMPTY" }
        media(links)
    }
}
