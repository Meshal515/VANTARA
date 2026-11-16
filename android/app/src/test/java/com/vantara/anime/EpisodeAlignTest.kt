package com.vantara.anime

import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.episodes.EpisodeAlign
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** بلاغ المالك (Tatsuki Fujimoto 17-26): سيرفرات «الحلقة 3» من مصدرين بترتيبين مختلفين كانت تشغّل حلقتين مختلفتين. */
class EpisodeAlignTest {
    private fun ep(n: Int, name: String) = SourceEpisode(sourceId = "s", url = "u$n", name = name, number = n.toFloat())
    private val title = "Tatsuki Fujimoto 17-26"
    // مصدر ثانٍ بترتيب آخر للقصص نفسها
    private val other = listOf(
        ep(1, "Tatsuki Fujimoto 17-26 Episode 1 - A Couple Clucking Chickens"),
        ep(2, "Tatsuki Fujimoto 17-26 Episode 2 - Woke-Up-as-a-Girl Syndrome"),
        ep(3, "Tatsuki Fujimoto 17-26 Episode 3 - Sasaki Stopped a Bullet"),
        ep(4, "Tatsuki Fujimoto 17-26 Episode 4 - Love Is Blind"),
    )

    @Test fun `a reordered source gives the episode with the same story, not the same number`() {
        val r = EpisodeAlign.align("Episode 3: Love Is Blind", other[2], other, title)
        assertTrue(r is EpisodeAlign.Result.Use)
        r as EpisodeAlign.Result.Use
        assertEquals(4f, r.episode.number)
        assertTrue(r.realigned)
    }

    @Test fun `same story keeps its number`() {
        val r = EpisodeAlign.align("Sasaki Stopped a Bullet", other[2], other, title) as EpisodeAlign.Result.Use
        assertSame(other[2], r.episode)
    }

    @Test fun `a different story with no match is not mixed into the list`() {
        assertEquals(EpisodeAlign.Result.Skip, EpisodeAlign.align("Mermaid Rhapsody", other[2], other, title))
    }

    @Test fun `generic names and different scripts are no evidence, so the number stands`() {
        val generic = listOf(ep(3, "الحلقة 3"), ep(4, "الحلقة 4"))
        assertSame(generic[0], (EpisodeAlign.align("Love Is Blind", generic[0], generic, title) as EpisodeAlign.Result.Use).episode)
        val arabic = listOf(ep(3, "ساساكي أوقف رصاصة"))
        assertSame(arabic[0], (EpisodeAlign.align("Love Is Blind", arabic[0], arabic, title) as EpisodeAlign.Result.Use).episode)
        // بلا مرجع بعد: أول مصدر يأخذ حلقته بالرقم
        assertSame(other[2], (EpisodeAlign.align(null, other[2], other, title) as EpisodeAlign.Result.Use).episode)
        // اسم العمل وحده ليس هوية حلقة
        assertEquals(false, EpisodeAlign.identifies("Tatsuki Fujimoto 17-26 Episode 3", title))
    }
}
