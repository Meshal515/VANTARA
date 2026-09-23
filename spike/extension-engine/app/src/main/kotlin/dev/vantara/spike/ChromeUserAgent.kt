package dev.vantara.spike

data class ChromeVersion(val major: String, val full: String)

/** Parses the Chrome token once so WebView UA text and Client Hints can agree. */
object ChromeUserAgent {
    private val pattern = Regex("Chrome/(\\d+)(\\.[\\d.]+)?")

    fun parse(userAgent: String): ChromeVersion? {
        val match = pattern.find(userAgent) ?: return null
        val major = match.groupValues[1]
        val suffix = match.groupValues[2].ifEmpty { ".0.0.0" }
        return ChromeVersion(major, major + suffix)
    }
}
