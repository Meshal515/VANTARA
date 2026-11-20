package eu.kanade.tachiyomi.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** DNS1: مضيفات مصادر المانجا المحمّلة ونطاقاتها الفرعية تأخذ DoH أولًا كمصادر الأنمي؛ غيرها يبقى على النظام. */
class SourceHostDnsTest {
    @Test fun `a loaded source host and its image subdomains prefer DoH`() {
        HostRouting.noteSourceHost("https://www.manga-site.example/")
        assertTrue(HostRouting.isSourceHost("manga-site.example"))
        assertTrue(HostRouting.isSourceHost("www.manga-site.example"))
        assertTrue(HostRouting.isSourceHost("s2.manga-site.example"))
        assertTrue(HostRouting.isSourceHost("CDN.IMG.Manga-Site.example"))
    }

    @Test fun `unrelated hosts and bare suffixes are not caught`() {
        HostRouting.noteSourceHost("https://other-source.example")
        assertFalse(HostRouting.isSourceHost("example"))
        assertFalse(HostRouting.isSourceHost("evil-other-source.example"))
        assertFalse(HostRouting.isSourceHost("google.com"))
        HostRouting.noteSourceHost("not a url")
        HostRouting.noteSourceHost(null)
        assertFalse(HostRouting.isSourceHost("not"))
    }
}
