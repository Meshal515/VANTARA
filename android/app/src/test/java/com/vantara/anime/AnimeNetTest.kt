package com.vantara.anime

import com.vantara.anime.health.HealthStore
import com.vantara.anime.net.AnimeDns
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.net.DomainPlan
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.UnknownHostException

class AnimeNetTest {

    private fun ip(s: String) = InetAddress.getByName(s)

    // ── الموجّه: إلغاؤنا ليس عطل المصدر ──

    private fun clientThatFails(cancelFirst: Boolean, error: IOException): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain ->
                if (cancelFirst) chain.call().cancel()
                throw error
            }
            .build()

    @Test fun `a call we cancelled is not recorded against the source`() {
        val h = HealthStore(null)
        AnimeHostRouter.health = h
        AnimeHostRouter.register("cancel-src", DomainPlan("https://cancel.test"))
        val call = clientThatFails(cancelFirst = true, IOException("Canceled")).newCall(Request.Builder().url("https://cancel.test/").build())
        runCatching { call.execute() }
        assertNull(h.get(HealthStore.sourceKey("cancel-src")))
    }

    @Test fun `a real network failure is recorded with a readable reason`() {
        val h = HealthStore(null)
        AnimeHostRouter.health = h
        AnimeHostRouter.register("dns-src", DomainPlan("https://blocked.test"))
        val call = clientThatFails(cancelFirst = false, UnknownHostException("blocked.test")).newCall(Request.Builder().url("https://blocked.test/").build())
        runCatching { call.execute() }
        val r = h.get(HealthStore.sourceKey("dns-src"))!!
        assertEquals(1, r.fail)
        assertTrue(r.lastError!!, r.lastError!!.startsWith("الدومين لا يُحلّ"))
    }

    // ── الصحة: تنظيف سجلات الإلغاء القديمة ──

    @Test fun `stored records whose only failure was our cancellation are dropped on load`() {
        val f = File.createTempFile("health", ".json")
        f.writeText(
            """[{"key":"source:okanime","fail":4,"streak":4,"lastError":"IOException: Canceled"},
               {"key":"source:witanime","ok":2,"fail":1,"lastError":"IOException: Canceled"},
               {"key":"host:dood.to","fail":1,"lastError":"HTTP 403"}]""",
        )
        val h = HealthStore(f)
        assertNull(h.get("source:okanime"))
        assertEquals(2, h.get("source:witanime")!!.ok)
        assertEquals(1, h.get("host:dood.to")!!.fail)
        f.delete()
    }

    // ── DNS ──

    @Test fun `sinkhole answers are recognised as blocking`() {
        assertTrue(AnimeDns.isSinkhole(listOf(ip("0.0.0.0"))))
        assertTrue(AnimeDns.isSinkhole(listOf(ip("127.0.0.1"))))
        assertTrue(AnimeDns.isSinkhole(listOf(ip("10.10.34.34"))))
        assertFalse(AnimeDns.isSinkhole(listOf(ip("104.21.3.4"))))
        assertFalse(AnimeDns.isSinkhole(emptyList()))
    }

    @Test fun `ordinary hosts use the system resolver untouched`() {
        var asked = 0
        val system = Dns { asked++; listOf(ip("93.184.216.34")) }
        val dns = AnimeDns(isSourceHost = { false }, system = system)
        assertEquals(listOf(ip("93.184.216.34")), dns.lookup("example.org"))
        assertEquals(1, asked)
    }
}
