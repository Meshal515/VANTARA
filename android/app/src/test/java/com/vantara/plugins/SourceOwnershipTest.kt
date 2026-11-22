package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** SE1: تحديث الإضافة والرجوع يطردان الإصدار القديم من الذاكرة بأشكال المعرّف الثلاثة. */
class SourceOwnershipTest {
    @Test fun everyIdShapeOfAPackageIsEvicted() {
        val pkg = "eu.kanade.tachiyomi.extension.ar.teamx"
        assertTrue("المدمج سابقًا: المعرّف = الحزمة", ownedBy(pkg, pkg))
        assertTrue("لغة أخرى", ownedBy("$pkg@en", pkg))
        assertTrue("إضافة المستخدم", ownedBy("$pkg#123456", pkg))
        assertFalse("حزمة أخرى تبدأ بالاسم نفسه", ownedBy("${pkg}x", pkg))
        assertFalse(ownedBy("eu.kanade.tachiyomi.extension.ar.azora", pkg))
    }

    /** SE2: بعد تحديث الحزمة مفتاح كاش صفحاتها جديد، ولحزمة لم تُحدَّث يبقى الرابط نفسه (الكاش الحالي صالح). */
    @Test fun anUpdatedPackageGetsFreshPageCacheKeys() {
        val url = "https://img.example/ch1/01.jpg"
        assertEquals(url, pageCacheKeyOf(0L, url))
        assertNotEquals(pageCacheKeyOf(0L, url), pageCacheKeyOf(1_700_000_000_000L, url))
        assertNotEquals(pageCacheKeyOf(1L, url), pageCacheKeyOf(2L, url))
    }
}
