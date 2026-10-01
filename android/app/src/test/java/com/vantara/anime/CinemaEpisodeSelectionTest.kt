package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CinemaEpisodeSelectionTest {
    private class Source : AnimeAdapter {
        override val id = "source"
        override val name = "source"
        override suspend fun page(listing: Listing, page: Int, query: String) = SourcePage(emptyList(), false)
        override suspend fun details(anime: SourceAnime) = anime
        override suspend fun seasons(anime: SourceAnime) = emptyList<SourceAnime>()
        override suspend fun episodes(anime: SourceAnime) = listOf(SourceEpisode(id, "/wrong/", "الحلقة 2", 1f))
        override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) = listOf(Candidate("candidate", id, name, "server", "media.test", "https://media.test/movie.m3u8", resolvedAt = now, expiresAt = now + 60_000))
    }
    @Test fun cinemaNeverUsesLabelToOverrideExplicitEpisodeNumber() = runBlocking {
        val source = Source()
        val resolver = EpisodeResolver({ source }, HealthStore(null))
        val cinema = SourceAnime(source.id, "/season-two/", "Title", mediaType = "series", seasonNumber = 2.0)
        assertTrue(resolver.candidates(listOf(EpisodeResolver.Copy(source.id, cinema)), 2f, Preferences()).isEmpty())
        assertEquals(1, resolver.candidates(listOf(EpisodeResolver.Copy(source.id, cinema.copy(mediaType = null))), 2f, Preferences()).size)
    }
}
