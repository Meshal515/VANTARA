package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.loadExtractor
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** VANTARA's measurement compares server by server with the original engine: each link must name its server page. */
class LinkEmbedsTest {
    @Test fun everyExtractedLinkRemembersTheServerItCameFrom() {
        WorkerState.takeLinkEmbeds()
        val links = runBlocking { mutableListOf<ExtractorLink>().also { loadExtractor("https://cdn.example/media/episode.m3u8", "https://site.example/", {}, it::add) } }
        assertEquals(1, links.size)
        assertEquals(mapOf(links.single().url to "https://cdn.example/media/episode.m3u8"), WorkerState.takeLinkEmbeds())
        assertTrue("taken once per operation", WorkerState.takeLinkEmbeds().isEmpty())
        WorkerState.takeMissingExtractors(); WorkerState.takeMissingSamples(); WorkerState.takeMissingEmbeds()
    }
}
