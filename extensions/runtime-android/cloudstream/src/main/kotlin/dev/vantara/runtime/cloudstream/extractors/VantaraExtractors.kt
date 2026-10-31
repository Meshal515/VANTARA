package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink

/**
 * VANTARA's own media-host extractors. Each one is written from the host's observable page behaviour,
 * covered by a fixture test, and matched by host name only (never by a provider's display name).
 */
interface VantaraExtractor {
    val name:String
    /** Exact hosts and their subdomains. */
    val hosts:List<String>
    suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean
}
/**
 * Embed hosts verified live (Oct 2026) to hand their media to a JW Player/Video.js configuration that
 * [PlayerPage] reads: vidmoly, lulustream and its mirrors, the minochinos/morencius embeds, mp4upload, anafast and vidspeed.
 * Explicit host list only; a page on any other host is never parsed this way.
 */
object PlayerPageHosts:VantaraExtractor {
    override val name="PlayerPage"
    // mp4upload وanafast وvidspeed: أعادت فيديو فعليًا في تمريرة القارئ العام الحية (31 أكتوبر، تشغيل 41162877481)
    override val hosts=listOf("vidmoly.org","vidmoly.to","vidmoly.me","lulustream.com","luluvid.com","luluvdo.com","minochinos.com","morencius.com",
        "mp4upload.com","anafast.cyou","vidspeed.cyou")
    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit)=
        PlayerPage.extract(java.net.URI(url).host.substringBefore('.').replaceFirstChar{it.uppercase()},url,referer,subtitles,links)
}
object VantaraExtractors {
    private val all:List<VantaraExtractor> = listOf(Pixeldrain,Streamtape,Dood,PlayerPageHosts,OkRu,Mixdrop)
    private fun matches(host:String,known:String)=host.equals(known,true)||host.endsWith(".$known",true)
    fun find(host:String):VantaraExtractor?=all.firstOrNull{e->e.hosts.any{matches(host,it)}}
    /**
     * Hosts whose URLs are HTML sharing pages even when the path ends in `.mp4`. Without an extractor they
     * are reported missing; they must never reach the player as if they were the media file.
     */
    private val sharingPages=listOf("streamtape.com","streamtape.to","streamtape.net","dood.wf","dood.to","dood.so","dood.la","doodstream.com","d000d.com",
        "voe.sx","filemoon.sx","filemoon.to","streamwish.com","streamwish.to","vidmoly.to","vidmoly.me","mp4upload.com","uqload.com","uqload.to","mixdrop.co",
        "mixdrop.ag","ok.ru","vidhide.com","vidguard.to","upstream.to","yourupload.com","sendvid.com","vidbom.com","vidshar.com","lulustream.com","krakenfiles.com",
        "mega.nz","drive.google.com","dailymotion.com","youtube.com","youtu.be","pixeldrain.com")
    fun isSharingPage(host:String):Boolean=sharingPages.any{matches(host,it)}
}
