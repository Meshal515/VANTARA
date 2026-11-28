package com.vantara.verification

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * تجربة توافق Mihon (Debug) على خادم محلي فقط: لا موقع حقيقي. الخادم يتحدّى هوية WebView المشتقة (Build/ بلا wv)
 * ويقبل هوية Chrome المختصرة كما يفعل Mihon، فتُظهر المصفوفة الفرق دون أي محاولة تجاوز.
 */
class MihonParityProbeTest {
    private lateinit var server: MockWebServer
    private val ours = "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36"

    @Before fun start() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val ua = request.getHeader("User-Agent").orEmpty()
                return if ("Build/" in ua) MockResponse().setResponseCode(403).addHeader("Server", "cloudflare")
                    .addHeader("cf-mitigated", "challenge").setBody("<title>Just a moment...</title>")
                else MockResponse().setResponseCode(200).addHeader("Server", "cloudflare").setBody("<title>Site</title>")
            }
        }
        server.start()
    }

    @After fun stop() { server.shutdown() }

    @Test fun mihonUserAgentIsTheReducedChromeShapeWithTheDeviceMajor() {
        val mihon = VerificationAcceptance.mihonUserAgent(ours)
        assertEquals("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", mihon)
        assertFalse("Build/" in mihon)
        assertTrue(VerificationAcceptance.mihonUserAgent("no chrome here").contains("Chrome/149.0.0.0"))
    }

    @Test fun probeReportsTheVerdictCodeAndMitigationWithoutBody() {
        val url = server.url("/manga").toString()
        val challenged = VerificationAcceptance.probe(OkHttpClient(), url, ours)
        assertTrue(challenged, challenged.startsWith("CHALLENGED code=403 mitigated=challenge server=cloudflare"))
        assertFalse(challenged.contains("Just a moment"))
        val accepted = VerificationAcceptance.probe(OkHttpClient(), url, VerificationAcceptance.mihonUserAgent(ours))
        assertTrue(accepted, accepted.startsWith("ACCEPTED code=200"))
    }

    @Test fun matrixSeparatesTheRequestPathFromTheIdentityAndSendsNoCookies() {
        val lines = VerificationAcceptance.matrix(OkHttpClient(), server.url("/").toString(), ours)
        assertEquals(4, lines.size)
        assertTrue(lines[0], lines[0].startsWith("engine+ourUA: CHALLENGED"))
        assertTrue(lines[1], lines[1].startsWith("engine+mihonUA: ACCEPTED"))
        assertTrue(lines[2], lines[2].startsWith("bare+ourUA: CHALLENGED"))
        assertTrue(lines[3], lines[3].startsWith("bare+mihonUA: ACCEPTED"))
        repeat(4) { assertEquals(null, server.takeRequest().getHeader("Cookie")) }
        // أربعة طلبات فقط: لا إعادة عند الرفض
        assertEquals(4, server.requestCount)
    }

    @Test fun describeNamesCountsAndFlagsOnlyNeverValues() {
        val text = DebugVerificationLog.describe("a=1; cf_clearance=SECRETVALUE; b=2", "SECRETVALUE")
        assertEquals("names=[a,cf_clearance,b] clearances=1 firstIsNew=true newPresent=true", text)
        assertFalse(text.contains("SECRETVALUE"))
    }
}
