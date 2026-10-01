package com.vantara.anime
import com.vantara.anime.registry.*
import org.junit.Assert.*
import org.junit.Test

class CinemaManifestFallbackTest {
    @Test fun `search uses actual query field and encodes query once`() {
        val hint = SearchPage("/find/?word={query}&offset={page}", CardSelectors("div.item__contents", "a.movie__block", titleAttr = "title", imageAttr = "data-src"))
        assertEquals("https://source.test/find/?word=Shameless%20%D8%A7%D9%84%D8%A3%D9%88%D9%84&offset=2", hint.url("https://source.test", 2, "Shameless الأول"))
        val rows = hint.cards.extract("<div class='item__contents'><a class='movie__block' href='/s10e12/' title='مسلسل Shameless الموسم العاشر الحلقة 12'><img data-src='/poster.jpg'><span>Comedy</span></a></div><a href='/ad/'>غير متعلق</a>", "https://source.test/find/")
        assertEquals(1, rows.size)
        assertEquals("مسلسل Shameless الموسم العاشر الحلقة 12", rows.single().title)
        assertEquals("https://source.test/poster.jpg", rows.single().image)
    }
    @Test fun `episode fallback excludes related shows and preserves selected season paths`() {
        val html = "<ul class='episodes__list'><li><a href='/shameless-s10e12/'><div class='epi__num'>الحلقة<b>12</b></div></a></li><li><a href='/shameless-s10e1/'>الحلقة 1</a></li></ul><a class='episode__item' href='/leanne-s1e12/'>الحلقة 12</a>"
        val rows = PageEpisodes("ul.episodes__list a").extract(html, "https://source.test/shameless-s10e12/")
        assertEquals(listOf(1f,12f), rows.map { it.number })
        assertTrue(rows.all { it.path.contains("shameless-s10") })
    }
    @Test fun `movie fallback is one playable watch URL only when selector exists`() {
        val rule = PageEpisodes("ul.episodes__list a", singleSelector = "a.watch__btn", singleNumber = 0f)
        assertEquals(0f, rule.extract("<a class='watch__btn' href='/movie/watch/'>مشاهدة</a>", "https://source.test/movie/").single().number)
        assertTrue(rule.extract("<h1>No content</h1>", "https://source.test/movie/").isEmpty())
    }
    @Test fun `relative mirrors resolve only when manifest opts in`() {
        val html = "<li data-link='/vids.php?t=abc'>Vids</li><li data-link='//mixdrop.co/e/id'>Mixdrop</li><li data-link='javascript:evil()'>bad</li>"
        val existing = PageEmbeds("li[data-link]", "data-link")
        assertTrue(existing.extract(html, "https://source.test/movie/watch/").isEmpty())
        val opted = PageEmbeds("li[data-link]", "data-link", resolveRelative = true)
        assertEquals(listOf("https://source.test/vids.php?t=abc", "https://mixdrop.co/e/id"), opted.extract(html, "https://source.test/movie/watch/").map { it.url })
    }
    @Test fun `details selectors read the changed page without inventing identity`() {
        val data = PageDetails(title = "h1.post__name", description = ".post__story").extract("<h1 class='post__name'>Shameless</h1><div class='post__story'>Story</div>", "https://source.test/episode/")
        assertEquals("Shameless", data.title); assertEquals("Story", data.description)
    }
    @Test fun `migration hints reject broad hosts and require a source fingerprint`() {
        val broad = SourceEntry("cinema", "Cinema", domains = Domains("https://source.test", strictRedirects = true, migrationCandidates = listOf("https://*.candidate.test")))
        assertTrue(ManifestParser.validate(Manifest(sources = listOf(broad))).isNotEmpty())
        val exact = broad.copy(domains = broad.domains.copy(migrationCandidates = listOf("https://candidate.test")))
        assertTrue(ManifestParser.validate(Manifest(sources = listOf(exact))).isNotEmpty())
        assertTrue(ManifestParser.validate(Manifest(sources = listOf(exact.copy(domains = exact.domains.copy(fingerprint = "source-theme"))))).isEmpty())
    }
    @Test fun `search fallback cannot move the request to another site`() {
        val source = SourceEntry("cinema", "Cinema", domains = Domains("https://source.test"), search = SearchPage("https://unknown.test/?q={query}", CardSelectors("a")))
        assertTrue(ManifestParser.validate(Manifest(sources = listOf(source))).isNotEmpty())
    }

    @Test fun `captured MySeed DOM returns own season episodes rather than related works`() {
        val html = requireNotNull(javaClass.getResourceAsStream("/cinema/myseed-shameless.html")).bufferedReader().use { it.readText() }
        val cards = CardSelectors("div.item__contents", "a.movie__block", titleAttr = "title", imageAttr = "data-src").extract(html, "https://m.myseed.pics/find/")
        assertEquals(2, cards.size)
        assertTrue(cards.all { it.title.contains("Shameless", ignoreCase = true) })
        val episodes = PageEpisodes("ul.episodes__list a").extract(html, "https://m.myseed.pics/")
        assertEquals((1..12).map { it.toFloat() }, episodes.map { it.number })
        assertTrue(episodes.all { java.net.URLDecoder.decode(it.path, "UTF-8").contains("shameless", ignoreCase = true) })
        assertTrue(PageDetails(title = "h1.post__name", description = ".post__story").extract(html, "https://m.myseed.pics/").title!!.contains("Shameless", ignoreCase = true))
    }

}
