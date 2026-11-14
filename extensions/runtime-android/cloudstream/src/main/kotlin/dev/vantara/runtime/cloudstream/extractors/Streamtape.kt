package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink
import java.net.URI

/**
 * Streamtape builds its `get_video` address in script: `innerHTML = '//host/get_video?…' + ('xyz…').substring(n)…`.
 * Several decoy elements use the same shape; the player reads `robotlink`, so only that one is used.
 */
object Streamtape:VantaraExtractor {
    override val name="Streamtape"
    override val hosts=listOf("streamtape.com","streamtape.to","streamtape.net","streamtape.cc","streamtape.xyz","strtape.cloud","tapecontent.net")
    private val robot=Regex("""getElementById\(\s*['"]robotlink['"]\s*\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?\s*['"]([^'"]+)['"]\s*\)?((?:\.substring\(\s*\d+\s*\))*)""")
    private val cut=Regex("""\.substring\(\s*(\d+)\s*\)""")
    fun videoAddress(html:String):String? {
        val m=robot.findAll(html).lastOrNull()?:return null
        var tail=m.groupValues[2]
        for(c in cut.findAll(m.groupValues[3]))tail=tail.drop(c.groupValues[1].toInt())
        val joined=m.groupValues[1]+tail
        return (if(joined.startsWith("//"))"https:$joined" else joined).takeIf{"get_video" in it}
    }
    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val page=app.get(url.replace("/v/","/e/"),referer=referer)
        if(!page.isSuccessful)return false
        val video=videoAddress(page.text)?:return false
        val origin=URI(page.url).let{"${it.scheme}://${it.host}/"}
        links(newExtractorLink(name,name,"$video&stream=1",ExtractorLinkType.VIDEO){this.referer=origin})
        return true
    }
}
