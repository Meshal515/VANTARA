package dev.vantara.spike

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * عقد الخدمة في الـmanifest، بلا جهاز.
 *
 * السؤال: هل تبدأ الخدمة أصلًا على أندرويد ١٤+، وهل يستطيع تطبيقٌ آخر أن
 * يبدأ زحفًا أو يوقفه؟ نقص صلاحية النوع لا يظهر إلا انهيارًا على الجهاز.
 */
class CatalogueCrawlManifestTest {

    private val android = "http://schemas.android.com/apk/res/android"

    private val manifest: Element by lazy {
        // Gradle يشغّل اختبارات الوحدة من مجلد الوحدة `app/`
        val file = File("src/main/AndroidManifest.xml")
        assertTrue("manifest not found from ${File(".").absolutePath}", file.isFile)
        DocumentBuilderFactory.newInstance()
            .apply { isNamespaceAware = true }
            .newDocumentBuilder()
            .parse(file)
            .documentElement
    }

    private fun elements(tag: String): List<Element> {
        val nodes = manifest.getElementsByTagName(tag)
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    private fun permissions(): Set<String> =
        elements("uses-permission").map { it.getAttributeNS(android, "name") }.toSet()

    private fun crawlService(): Element? =
        elements("service").firstOrNull { it.getAttributeNS(android, "name") == ".CatalogueCrawlService" }

    @Test
    fun `the crawl service is declared as a data sync foreground service`() {
        val service = crawlService()
        assertNotNull("CatalogueCrawlService is not declared", service)
        assertEquals("dataSync", service!!.getAttributeNS(android, "foregroundServiceType"))
    }

    @Test
    fun `no other app can start or stop the crawl`() {
        assertEquals("false", crawlService()!!.getAttributeNS(android, "exported"))
    }

    @Test
    fun `the foreground service permissions android 14 requires are present`() {
        val granted = permissions()
        assertTrue(granted.contains("android.permission.FOREGROUND_SERVICE"))
        assertTrue(granted.contains("android.permission.FOREGROUND_SERVICE_DATA_SYNC"))
    }

    @Test
    fun `the spike still asks for no package listing permission`() {
        // لا نمسح الحزم المثبّتة كما يفعل Mihon؛ نحمّل من ملفنا
        assertTrue("android.permission.QUERY_ALL_PACKAGES" !in permissions())
    }
}
