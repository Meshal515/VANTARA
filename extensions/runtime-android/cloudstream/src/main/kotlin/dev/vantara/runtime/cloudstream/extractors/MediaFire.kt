package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink
import java.net.URI

/**
 * MediaFire's file page carries the file itself on its download button: `<a href="https://downloadNNNN.mediafire.com/…/name.mp4"
 * id="downloadButton">` (live page, 14 Nov 2026). Newer pages scramble it into `data-scrambled-url` (Base64). Only that
 * button is read, and only a mediafire.com download host is accepted, so a removed file (error page) yields nothing.
 */
object MediaFire:VantaraExtractor {
    override val name="MediaFire"
    override val hosts=listOf("mediafire.com")
    private val button=Regex("""<a\b[^>]*\bid\s*=\s*["']downloadButton["'][^>]*>""",RegexOption.IGNORE_CASE)
    private val href=Regex("""\bhref\s*=\s*["']([^"']+)["']""",RegexOption.IGNORE_CASE)
    private val scrambled=Regex("""\bdata-scrambled-url\s*=\s*["']([A-Za-z0-9+/=]+)["']""",RegexOption.IGNORE_CASE)

    fun fileAddress(html:String):String? {
        val tag=button.find(html)?.value ?: return null
        val raw=href.find(tag)?.groupValues?.get(1)?.takeIf { it.startsWith("http") }
            ?: scrambled.find(tag)?.groupValues?.get(1)?.let { runCatching { String(java.util.Base64.getDecoder().decode(it)) }.getOrNull() }
            ?: return null
        val url=raw.replace("&amp;","&")
        val host=runCatching { URI(url).host }.getOrNull() ?: return null
        return url.takeIf { URI(it).scheme=="https" && host.endsWith(".mediafire.com") && host.startsWith("download") }
    }

    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val page=app.get(url,referer=referer)
        if(!page.isSuccessful)return false
        val file=fileAddress(page.text) ?: return false
        links(newExtractorLink(name,name,file,ExtractorLinkType.VIDEO){this.referer="https://www.mediafire.com/"})
        return true
    }
}
