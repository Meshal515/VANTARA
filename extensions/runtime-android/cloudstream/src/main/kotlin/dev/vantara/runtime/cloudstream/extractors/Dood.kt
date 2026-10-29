package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink
import java.net.URI

/**
 * DoodStream and its mirrors: the embed page names a `/pass_md5/<id>/<token>` endpoint whose body is the media
 * prefix; the player appends ten random characters, `?token=<token>` and the current time.
 */
object Dood:VantaraExtractor {
    override val name="DoodStream"
    override val hosts=listOf("doodstream.com","dood.wf","dood.to","dood.so","dood.la","dood.pm","dood.re","dood.yt","dood.li","d000d.com","d0000d.com",
        "ds2play.com","ds2video.com","dooood.com","playmogo.com","dsvplay.com","vidply.com","do7go.com")
    private val pass=Regex("""['"](/pass_md5/[^'"]+)['"]""")
    private const val alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val embed=url.replace("/d/","/e/")
        val page=app.get(embed,referer=referer)
        if(!page.isSuccessful)return false
        val path=pass.find(page.text)?.groupValues?.get(1)?:return false
        val origin=URI(page.url).let{"${it.scheme}://${it.host}"}
        val prefix=app.get(origin+path,referer=page.url).text.trim()
        if(!prefix.startsWith("http"))return false
        val random=(1..10).map{alphabet.random()}.joinToString("")
        val media="$prefix$random?token=${path.substringAfterLast('/')}&expiry=${System.currentTimeMillis()}"
        links(newExtractorLink(name,name,media,ExtractorLinkType.VIDEO){this.referer="$origin/"})
        return true
    }
}
