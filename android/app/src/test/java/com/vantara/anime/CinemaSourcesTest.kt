package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.player.PlaybackIdentity
import org.junit.Assert.*
import org.junit.Test

class CinemaSourcesTest {
    @Test fun titlesRetainYearAndDisambiguateWordsAndType() {
        val html = """<div class='Block--Item'><a title='فيلم Runner 2026 مترجم اون لاين' href='/runner/'><img src='/no.png' data-src='/runner.jpg'></a></div>
            <div class='Block--Item'><a title='فيلم The Runner 2026 مترجم اون لاين' href='/the-runner/'></a></div>
            <div class='Block--Item'><a title='مسلسل Lovely Runner الحلقة 12 مترجم اون لاين' href='/lovely-e12/'></a></div>"""
        val cards = TuktukParser.cards(html, "https://tuktukhd.com/", "cinema-tuktuk")
        assertEquals(listOf("Runner", "The Runner", "Lovely Runner"), cards.map { it.title })
        assertEquals(2026, cards.first().year)
        assertEquals("movie", cards.first().mediaType)
        assertEquals("series", cards.last().mediaType)
        assertEquals("https://tuktukhd.com/runner.jpg", cards.first().thumbnail)
        assertFalse(CinemaTitles.same(cards[0], cards[1]))
        assertFalse(CinemaTitles.same(cards[0], cards[0].copy(year = 2025)))
        assertFalse(CinemaTitles.same(cards[0], cards[0].copy(mediaType = "series")))
    }
    @Test fun selectedSeasonsKeepOwnUrlAndSortEpisodesNumerically() {
        val root = SourceAnime("cinema-tuktuk", "/series/medusa/", "Medusa", mediaType = "series", year = 2026)
        val html = """<section class='SeriesSeasons'><div class='Block--Item'><a href='/series/medusa-s2/' title='الموسم 2 مسلسل Medusa مترجم'>2</a></div><div class='Block--Item'><a href='/series/medusa-s1/' title='الموسم 1 مسلسل Medusa مترجم'>1</a></div></section>"""
        val seasons = TuktukParser.seasons(html, "https://tuktukhd.com/series/medusa/", root)
        assertEquals(listOf(1.0, 2.0), seasons.map { it.seasonNumber })
        assertEquals("/series/medusa-s2/", seasons.last().url)
        val episodes = TuktukParser.episodes("""<section class='SeriesEpisodes'><a class='SeriesEpisodeCard' href='/s2e12/'><div class='SeriesEpisodeNumber'><strong>12</strong></div></a><a class='SeriesEpisodeCard' href='/s2e1/'><div class='SeriesEpisodeNumber'><strong>1</strong></div></a></section>""", "https://tuktukhd.com/series/medusa-s2/", seasons.last())
        assertEquals(listOf(1f, 12f), episodes.map { it.number })
        assertTrue(episodes.all { it.url.startsWith("/s2") })
    }
    @Test fun movieIsOneEpisodeAndEncryptedIframeDecodesFresh() {
        val movie = SourceAnime("cinema-tuktuk", "/runner/", "Runner", mediaType = "movie", year = 2026)
        val episode = TuktukParser.episodes("", "https://tuktukhd.com/runner/", movie).single()
        assertEquals(1f, episode.number)
        assertEquals("/runner/", episode.url)
        val embed = "https://megatuktuk.store/iframe/test"
        val crypt = java.util.Base64.getEncoder().encodeToString(embed.toByteArray())
        assertEquals(listOf(embed), TuktukParser.embeds("<iframe id='main-video-frame' data-crypt='$crypt'></iframe>", "https://tuktukhd.com/runner/"))
        val link = java.util.Base64.getEncoder().encodeToString(embed.toByteArray()).reversed() + "0REL0Yignored"
        assertEquals(listOf(embed), TuktukParser.embeds("<li class='server--item' data-link='$link'></li>", "https://tuktukhd.com/runner/"))
        assertEquals(emptyList<String>(), TuktukParser.embeds("<iframe id='main-video-frame' data-crypt='invalid'></iframe>", "https://tuktukhd.com/runner/"))
    }
    @Test fun seriesEpisodeBreadcrumbCanonicalizesToRoot() {
        assertEquals("/series/medusa/", TuktukParser.seriesRoot("""<div id='mpbreadcrumbs'><a href='/series/medusa-s2/'>الموسم 2</a><a href='/series/medusa/'>مسلسل Medusa مترجم</a></div>""", "https://tuktukhd.com/medusa-e1/"))
    }
    @Test fun arabicSeasonWordsAndCollectionPrefixDoNotPolluteWorkTitle() {
        assertEquals("Breaking Bad", CinemaTitles.canonical("جميع مواسم مسلسل Breaking Bad 2008 مترجم كامل"))
        assertEquals("Breaking Bad", CinemaTitles.canonical("مسلسل Breaking Bad الموسم الاول الحلقة 1 مترجمة"))
    }
    @Test fun desktopAndMobileEgyServersBothDecode() {
        val links = EgyDeadParser.embeds("""<ul class='serversList'><li data-link='https://morencius.com/v/abc'>HD</li></ul><div class='mob-servers'><li data-link='https://hgcloud.to/e/def'>HG</li></div>""", "https://tv10.egydead.live/movie/")
        assertEquals(listOf("https://morencius.com/v/abc", "https://hgcloud.to/e/def"), links)
    }
    @Test fun identitiesSeparateMovieSeriesSeasonAndAnimeAndPreserveLegacyAnimeKey() {
        assertEquals("coverage:u:42:1.0", PlaybackIdentity("anime", "42").coverageKey("u", 1f))
        val movie = PlaybackIdentity("cinema", "tt42", "movie")
        val season1 = PlaybackIdentity("cinema", "tt42", "series", 1)
        val season2 = PlaybackIdentity("cinema", "tt42", "series", 2)
        assertEquals("cinema:tt42:movie", movie.unit(1f))
        assertEquals("cinema:tt42:s2:e1", season2.unit(1f))
        assertNotEquals(season1.coverageKey("u", 1f), season2.coverageKey("u", 1f))
        assertNotEquals(movie.coverageKey("u", 1f), season1.coverageKey("u", 1f))
    }
}
