package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.JsUnpacker
import com.lagradost.cloudstream3.utils.newExtractorLink
import java.net.URI

/**
 * Embed pages that hand a JW Player / Video.js / Plyr configuration to the browser, either in plain script or
 * inside a P.A.C.K.E.R. `eval(function(p,a,c,k,e,d)…)` block. The media address is read from the player's own
 * configuration keys (`file`, `src`, `hls…`, `sources`), never from arbitrary URLs on the page, so advert and
 * thumbnail files are not mistaken for the episode.
 */
internal object PlayerPage {
    private val packedStart=Regex("""eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,""")
    private val keyed=Regex("""(?:["']?(?:file|src|hls\d*|source|videoUrl|video_url)["']?)\s*[:=]\s*["']((?:https?:)?//[^"'\s]+?\.(?:m3u8|mp4)(?:\?[^"'\s]*)?)["']""",RegexOption.IGNORE_CASE)
    private val tracks=Regex("""\{[^{}]*?["']?file["']?\s*:\s*["']((?:https?:)?//[^"'\s]+?\.(?:vtt|srt))["'][^{}]*?["']?label["']?\s*:\s*["']([^"']{1,60})["'][^{}]*?\}""",RegexOption.IGNORE_CASE)

    /** The page's script text with every packed block replaced by its unpacked source. */
    fun scripts(html:String):String {
        val out=StringBuilder(html)
        // Each packed block runs to the end of its <script>; the unpacker reads exactly one block.
        for(start in packedStart.findAll(html).take(8)) {
            val end=html.indexOf("</script>",start.range.first).let{if(it<0)html.length else it}
            JsUnpacker(html.substring(start.range.first,end)).unpack()?.let{out.append('\n').append(it)}
        }
        return out.toString()
    }
    fun mediaUrls(text:String,base:String):List<String> =keyed.findAll(text).map{absolute(it.groupValues[1].replace("\\/","/"),base)}.distinct().toList()
    fun subtitleTracks(text:String,base:String):List<Pair<String,String>> =tracks.findAll(text).map{absolute(it.groupValues[1].replace("\\/","/"),base) to it.groupValues[2]}.distinct().toList()
    private fun absolute(url:String,base:String)=if(url.startsWith("//"))URI(base).scheme+":"+url else url

    suspend fun extract(name:String,url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val page=app.get(url,referer=referer ?: url)
        if(!page.isSuccessful)return false
        val pageUrl=page.url
        val text=scripts(page.text)
        val origin=URI(pageUrl).let{"${it.scheme}://${it.host}"}
        var found=false
        for(media in mediaUrls(text,pageUrl)) {
            val hls=media.substringBefore('?').endsWith(".m3u8",true)
            links(newExtractorLink(name,name,media,if(hls)ExtractorLinkType.M3U8 else ExtractorLinkType.VIDEO){this.referer="$origin/"})
            found=true
        }
        if(found)for((file,label) in subtitleTracks(text,pageUrl))subtitles(SubtitleFile(label,file))
        return found
    }
}
