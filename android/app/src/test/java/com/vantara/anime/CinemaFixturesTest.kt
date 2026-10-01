package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.registry.*
import org.junit.Assert.*
import org.junit.Test

class CinemaFixturesTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResourceAsStream("cinema/$name.html")!!.bufferedReader().use { it.readText() }
    @Test fun actualRunnerPageKeepsTitleYearAndMovie() {
        val film = TuktukParser.details(fixture("tuktuk-main-movie"), "https://tuktukhd.com/runner/", SourceAnime("cinema-tuktuk", "/runner/", "Runner", mediaType = "movie"))
        assertEquals("Runner", film.title)
        assertEquals(2026, film.year)
        assertEquals("movie", film.mediaType)
    }
    @Test fun actualIrreplaceableRootAndMedusaSelectedSeasonParseCurrentSelectors() {
        val root = SourceAnime("cinema-tuktuk", "/series/irreplaceable/", "Irreplaceable", mediaType = "series")
        val seasons = TuktukParser.seasons(fixture("tuktuk-series-root"), "https://tuktukhd.com/series/irreplaceable/", root)
        assertEquals(listOf(1.0), seasons.map { it.seasonNumber })
        assertEquals(listOf(1f, 2f, 3f), TuktukParser.episodes(fixture("tuktuk-series-root"), "https://tuktukhd.com/series/irreplaceable/", seasons.single()).map { it.number })
        val medusa = root.copy(url = "/series/medusa/", title = "Medusa")
        val medusaSeasons = TuktukParser.seasons(fixture("tuktuk-medusa-root"), "https://tuktukhd.com/series/medusa/", medusa)
        assertEquals(listOf(1.0, 2.0), medusaSeasons.map { it.seasonNumber })
        val selected = medusaSeasons.last()
        val episodes = TuktukParser.episodes(fixture("tuktuk-medusa-s1"), "https://tuktukhd.com${selected.url}", selected)
        assertEquals((1..12).map { it.toFloat() }, episodes.map { it.number })
        assertTrue(episodes.all { it.url.contains("medusa") })
    }
    @Test fun actualEgyBreakingBadKeepsFiveSeparateSeasons() {
        val root = SourceAnime("cinema-egydead", "/serie/breaking-bad-2008/", "Breaking Bad", mediaType = "series", year = 2008)
        val seasons = EgyDeadParser.seasons(fixture("egydead-search-series-series"), "https://tv10.egydead.live${root.url}", root)
        assertEquals((1..5).map { it.toDouble() }, seasons.map { it.seasonNumber })
        assertEquals("/season/breaking-bad-s05/", seasons.last().url)
        assertEquals("Breaking Bad", EgyDeadParser.details(fixture("egydead-search-series-series"), "https://tv10.egydead.live${root.url}", root).title)
    }
    private fun entry(id: String, content: String) = SourceEntry(id, id, content = content, domains = Domains("https://example.com"))
    @Test fun updatingCinemaRetainsAnimeAndUpdatingAnimeRetainsCinema() {
        val anime = entry("anime-wit", "anime")
        val film = entry("cinema-tuktuk", "cinema")
        val merged = ManifestNamespaces.merge(Manifest(sources = listOf(anime)), Manifest(sources = listOf(film)), "cinema")
        assertEquals(listOf(anime, film), merged.sources)
        assertEquals(listOf(film, anime), ManifestNamespaces.merge(merged, Manifest(sources = listOf(anime)), "anime").sources)
    }
    @Test fun cinemaRejectsWrongNamespaceAndCollisionButLegacyAnimeManifestFiltersDisabledCinema() {
        val anime = entry("anime-wit", "anime")
        val cinema = entry("cinema-tuktuk", "cinema")
        assertTrue(ManifestNamespaces.validate(Manifest(sources = listOf(anime)), "cinema").any { it.contains("خارج قسم") })
        assertTrue(ManifestNamespaces.validate(Manifest(sources = listOf(cinema.copy(id = anime.id))), "cinema", Manifest(sources = listOf(anime))).any { it.contains("قسم آخر") })
        assertEquals(emptyList<String>(), ManifestNamespaces.validate(Manifest(sources = listOf(anime, cinema.copy(enabled = false))), "anime"))
    }
}
