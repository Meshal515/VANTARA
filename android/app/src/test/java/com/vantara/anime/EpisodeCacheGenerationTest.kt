package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class EpisodeCacheGenerationTest {
    private class Adapter(private val revision: String) : AnimeAdapter {
        override val id = "user-legacy"
        override val name = "Example"
        override suspend fun page(listing: Listing, page: Int, query: String) = SourcePage(emptyList(), false)
        override suspend fun details(anime: SourceAnime) = anime
        override suspend fun seasons(anime: SourceAnime) = emptyList<SourceAnime>()
        override suspend fun episodes(anime: SourceAnime) = listOf(SourceEpisode(id, "/$revision/1", "Episode 1", 1f))
        override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) = emptyList<Candidate>()
    }

    @Test fun `replacing a legacy adapter cannot reuse its old episode URLs`() = runBlocking {
        var current: AnimeAdapter? = Adapter("old")
        val resolver = EpisodeResolver({ current }, HealthStore(Files.createTempDirectory("episode-cache").resolve("health.json").toFile()))
        val copy = EpisodeResolver.Copy("user-legacy", SourceAnime("user-legacy", "/work", "Work"))
        assertEquals("/old/1", resolver.episodes(copy).single().url)
        current = Adapter("new")
        assertEquals("/new/1", resolver.episodes(copy).single().url)
        current = null
        assertTrue(resolver.episodes(copy).isEmpty())
    }
}
