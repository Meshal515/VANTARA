package com.vantara.anime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * جهاز المالك (15 نوفمبر): «نسخ بلا أي سيرفر في الورقة: WitAnime» بلا سبب. مصدر انتهى بلا سيرفر يقول لماذا،
 * بكلام مفهوم ومن رمز الخطأ وحده (لا رابط ولا نص صفحة).
 */
class SilentSourceReasonTest {
    @Test fun eachKnownFailureReadsAsItsCause() {
        assertEquals("لم يُرجع المصدر روابط لهذه الحلقة", silentSourceReason(IllegalStateException("NO_VIDEO_LINKS")))
        assertEquals("يحتاج تحقق Cloudflare (من صفحة الإضافات)", silentSourceReason(RuntimeException("x", java.io.IOException("VERIFICATION_REQUIRED"))))
        assertEquals("اسم موقع المصدر لا يُحل (نطاق ميت أو محجوب)", silentSourceReason(java.net.UnknownHostException("witanime.xyz")))
        assertEquals("العمل مقسّم مواسم: افتحه من صفحة المصدر", silentSourceReason(IllegalArgumentException("SEASON_SELECTION_REQUIRED")))
    }

    @Test fun anUnknownFailureNamesItsCodeNeverTheRawMessage() {
        val reason = silentSourceReason(IllegalStateException("PROVIDER_FAILED at https://secret.example/watch?token=abc"))
        assertEquals("تعذّر جلب السيرفرات (PROVIDER_FAILED)", reason)
        assertFalse(reason.contains("secret.example"))
    }
}
