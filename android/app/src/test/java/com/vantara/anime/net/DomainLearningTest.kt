package com.vantara.anime.net

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

/** DM1: إضافات المستخدم (بلا بصمة في البيان) تتبع انتقال موقعها الحقيقي، ولا تتبع صفحة مزيّفة بالاسم نفسه. */
class DomainLearningTest {
    private val plan = DomainPlan(current = "https://witanime.cyou")
    private val real = """<html><head><title>الحلقة 5 - WitAnime</title><meta property="og:site_name" content="WitAnime"></head></html>"""
    private val fake = """<html><head><title>WitAnime Free | Blogger</title><meta property="og:site_name" content="Watch Anime Blog"></head></html>"""

    @Test fun movedSiteWithTheLearnedIdentityIsAdopted() {
        val v = DomainPolicy.judge("https://witanime.cyou/e/5".toHttpUrl(), "https://witanime.pics/e/5".toHttpUrl(), plan, real, learned = DomainPolicy.identityOf(real))
        assertEquals(DomainPolicy.Verdict.LEARNED_OK, v)
    }
    @Test fun sameNameFakeOrUnknownIdentityStaysForeign() {
        assertEquals(DomainPolicy.Verdict.FOREIGN, DomainPolicy.judge("https://witanime.cyou/".toHttpUrl(), "https://witanime.net/".toHttpUrl(), plan, fake, learned = "WitAnime"))
        assertEquals(DomainPolicy.Verdict.FOREIGN, DomainPolicy.judge("https://witanime.cyou/".toHttpUrl(), "https://witanime.pics/".toHttpUrl(), plan, real, learned = null))
        assertEquals(DomainPolicy.Verdict.FOREIGN, DomainPolicy.judge("https://witanime.cyou/".toHttpUrl(), "https://ads.example/".toHttpUrl(), plan, real, learned = "WitAnime"))
    }
    @Test fun anAdoptedDomainSurvivesRestart() {
        val next = plan.adopt("https://witanime.pics")
        assertEquals("https://witanime.pics", next.current)
        assertEquals(setOf("https://witanime.cyou"), next.legacy)
        assertEquals(plan, plan.adopt(null))
        assertEquals(plan, plan.adopt("https://witanime.cyou"))
    }
}
