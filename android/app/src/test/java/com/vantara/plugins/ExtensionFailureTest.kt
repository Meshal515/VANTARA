package com.vantara.plugins

import com.vantara.plugins.ExtensionFailure.Owner
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.interceptor.HostCoolingException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** كل عطل يُنسب لواحد من أربعة بسبب عربي؛ لا رسالة خام بالإنجليزية تصل للمستخدم. */
class ExtensionFailureTest {
    private val latin = Regex("[A-Za-z]{4,}")
    private fun arabicOnly(message: String) = assertFalse(message, latin.containsMatchIn(message.replace("VANTARA", "").replace("Cloudflare", "").replace("VPN", "")))

    @Test fun http403IsSiteWithArabicReason() {
        // انحدار: Comic Growl كان يعرض "HttpException: HTTP error 403"
        val v = ExtensionFailure.classify(RuntimeException("wrapped", HttpException(403)))
        assertEquals(Owner.SITE, v.owner); assertEquals("SITE_HTTP_403", v.code); arabicOnly(v.message)
    }

    @Test fun httpTextWithoutTypeIsStillSite() {
        assertEquals("SITE_HTTP_503", ExtensionFailure.classify(IOException("HTTP error 503")).code)
    }

    @Test fun networkFailuresAreSite() {
        assertEquals("SITE_DNS", ExtensionFailure.classify(UnknownHostException("x.example")).code)
        assertEquals("SITE_TIMEOUT", ExtensionFailure.classify(SocketTimeoutException()).code)
        assertEquals("SITE_NETWORK", ExtensionFailure.classify(IOException("reset")).code)
    }

    @Test fun coolingKeepsItsCode() {
        val v = ExtensionFailure.classify(HostCoolingException("x.example", 30_000))
        assertEquals(Owner.SITE, v.owner); assertEquals("HOST_COOLING", v.code)
    }

    @Test fun missingHostApiIsOurs() {
        val v = ExtensionFailure.classify(NoSuchMethodError("newEpisode"))
        assertEquals(Owner.VANTARA, v.owner); arabicOnly(v.message)
    }

    @Test fun unsupportedCapability() {
        assertEquals(Owner.UNSUPPORTED, ExtensionFailure.classify(UnsupportedOperationException("Not used")).owner)
    }

    @Test fun parserCrashBelongsToExtension() {
        val v = ExtensionFailure.classify(NullPointerException("selectFirst(...) must not be null"))
        assertEquals(Owner.EXTENSION, v.owner); assertEquals("EXTENSION_PARSE", v.code); arabicOnly(v.message)
    }

    @Test fun arabicMessageKeptAndOwnedByThrower() {
        val ext = IllegalStateException("لا توجد نتائج").apply { stackTrace = arrayOf(StackTraceElement("eu.kanade.tachiyomi.extension.ar.x.X", "f", null, 1)) }
        val ours = IllegalStateException("أضف المستودع أولًا").apply { stackTrace = arrayOf(StackTraceElement("com.vantara.plugins.ExtensionEnginePlugin", "f", null, 1)) }
        assertEquals(Owner.EXTENSION, ExtensionFailure.classify(ext).owner)
        assertEquals(Owner.VANTARA, ExtensionFailure.classify(ours).owner)
        assertEquals("لا توجد نتائج", ExtensionFailure.classify(ext).message)
    }
}
