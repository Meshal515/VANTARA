package com.vantara.anime.bridge

import com.vantara.anime.adapters.*
import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AniyomiUpdateJourneyTest {
    private class Fixture(private val episodesPresent: Boolean = true) : AnimeAdapter {
        override val id = "candidate"
        override val name = "Authored update fixture"
        override suspend fun page(listing: Listing, page: Int, query: String) = SourcePage(listOf(SourceAnime(id,"/work","Fixture")),false)
        override suspend fun details(anime: SourceAnime) = anime
        override suspend fun seasons(anime: SourceAnime) = emptyList<SourceAnime>()
        override suspend fun episodes(anime: SourceAnime) = if(episodesPresent) listOf(SourceEpisode(id,"/episode","Episode",1f)) else emptyList()
        override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) = emptyList<Candidate>()
    }
    @Test fun catalogueAloneCannotApproveAnUpdateWithNoEpisodes() = runBlocking {
        var media = false
        try { AniyomiUpdateGate.verifyJourney(Fixture(false)) { media=true }; fail("Empty episode list admitted") }
        catch (expected: IllegalArgumentException) { assertEquals("ANIYOMI_UPDATE_EPISODES_EMPTY",expected.message) }
        assertFalse(media)
    }
    @Test fun catalogueAndEpisodesCannotApproveAnUpdateWithNoVideoCandidates() = runBlocking {
        var media = false
        try { AniyomiUpdateGate.verifyJourney(Fixture()) { media=true }; fail("Empty video list admitted") }
        catch (expected: IllegalArgumentException) { assertEquals("ANIYOMI_UPDATE_MEDIA_EMPTY",expected.message) }
        assertFalse(media)
    }
}
