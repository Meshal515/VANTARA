package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink

/** pixeldrain.com/u/<id> share pages serve the file itself at /api/file/<id>. */
object Pixeldrain:VantaraExtractor {
    override val name="Pixeldrain"
    override val hosts=listOf("pixeldrain.com")
    private val share=Regex("/(?:u|api/file)/([A-Za-z0-9_-]{8})")
    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val parsed=java.net.URI(url)
        // Only the exact share/file forms: no query, fragment, extra path segment or non-default port.
        if(!parsed.scheme.equals("https",true)||parsed.port !in listOf(-1,443)||parsed.rawQuery!=null||parsed.rawFragment!=null)return false
        val id=share.matchEntire(parsed.rawPath.orEmpty())?.groupValues?.get(1)?:return false
        links(newExtractorLink(name,name,"https://pixeldrain.com/api/file/$id",ExtractorLinkType.VIDEO){this.referer=referer.orEmpty()})
        return true
    }
}
