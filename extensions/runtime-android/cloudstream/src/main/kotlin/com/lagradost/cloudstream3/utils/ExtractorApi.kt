package com.lagradost.cloudstream3.utils

import com.lagradost.cloudstream3.SubtitleFile
import java.net.URI

enum class ExtractorLinkType { VIDEO, M3U8, DASH, INFERRED }
enum class Qualities(val value:Int){Unknown(-1),P144(144),P240(240),P360(360),P480(480),P720(720),P1080(1080),P1440(1440),P2160(2160)}
class ExtractorLink(val source:String,val name:String,val url:String,var type:ExtractorLinkType=ExtractorLinkType.INFERRED) {
    var referer:String=""
    var quality:Int=Qualities.Unknown.value
    var headers:Map<String,String> = emptyMap()
    val isM3u8:Boolean get()=type==ExtractorLinkType.M3U8
}
open class ExtractorApi {
    open val name=""
    open val mainUrl=""
    open val requiresReferer=false
    open suspend fun getUrl(url:String,referer:String?):List<ExtractorLink>?=throw UnsupportedOperationException("extractor:$name")
    open suspend fun getUrl(url:String,referer:String?,subtitleCallback:(SubtitleFile)->Unit,callback:(ExtractorLink)->Unit){getUrl(url,referer)?.forEach(callback)}
}
class UnsupportedExtractor(val host:String):UnsupportedOperationException("Unsupported extractor: $host")
object ExtractorRegistry {
    private val providers=mutableListOf<ExtractorApi>()
    @Synchronized fun add(api:ExtractorApi){require(providers.size<64);providers.add(api)}
    @Synchronized fun clear(){providers.clear()}
    @Synchronized fun find(host:String):ExtractorApi?=providers.firstOrNull{runCatching{val registered=URI(it.mainUrl).host;host.equals(registered,true)||host.endsWith(".$registered",true)}.getOrDefault(false)}
}
fun getQualityFromName(value:String?):Int {
    if(value==null)return Qualities.Unknown.value
    val normalized=value.lowercase()
    if("4k" in normalized)return 2160
    if("2k" in normalized)return 1440
    return Regex("(?:2160|1440|1080|720|480|360|240|144)(?=p|\\b)").find(normalized)?.value?.toIntOrNull()?:Qualities.Unknown.value
}
suspend fun newExtractorLink(source:String,name:String,url:String,type:ExtractorLinkType=ExtractorLinkType.INFERRED,initializer:suspend ExtractorLink.()->Unit={}):ExtractorLink {
    val parsed=URI(url);require(parsed.scheme=="https"||parsed.scheme=="http");require(parsed.rawUserInfo==null)
    return ExtractorLink(source,name,url,type).also{initializer(it)}
}
suspend fun loadExtractor(url:String,referer:String?,subtitleCallback:(SubtitleFile)->Unit,callback:(ExtractorLink)->Unit) {
    val parsed=URI(url);require(parsed.scheme=="https"||parsed.scheme=="http");require(parsed.rawUserInfo==null)
    // A provider's extractor owns its sharing-page paths, including filenames
    // ending in .mp4. Such a suffix alone cannot override the host's contract.
    ExtractorRegistry.find(parsed.host)?.let { it.getUrl(url,referer,subtitleCallback,callback);return }
    if(parsed.host.equals("pixeldrain.com",true)) {
        val path=parsed.rawPath.orEmpty()
        if(parsed.scheme=="https" && parsed.port in listOf(-1,443) && parsed.rawQuery==null && parsed.rawFragment==null &&
            path.matches(Regex("/(?:u|api/file)/[A-Za-z0-9_-]{8}"))) {
            val id=path.substringAfterLast('/')
            callback(newExtractorLink("Pixeldrain","Pixeldrain","https://pixeldrain.com/api/file/$id",ExtractorLinkType.VIDEO){this.referer=referer.orEmpty()});return
        }
        throw UnsupportedExtractor(parsed.host)
    }
    if(parsed.host.equals("streamtape.com",true) || parsed.host.endsWith(".streamtape.com",true))throw UnsupportedExtractor(parsed.host)
    val path=parsed.path?.lowercase().orEmpty()
    if(path.endsWith(".m3u8")||path.endsWith(".mp4")||path.endsWith(".mpd")){
        val type=if(path.endsWith(".m3u8"))ExtractorLinkType.M3U8 else if(path.endsWith(".mpd"))ExtractorLinkType.DASH else ExtractorLinkType.VIDEO
        callback(newExtractorLink(parsed.host,parsed.host,url,type){this.referer=referer.orEmpty()});return
    }
    val extractor=ExtractorRegistry.find(parsed.host)?:throw UnsupportedExtractor(parsed.host)
    extractor.getUrl(url,referer,subtitleCallback,callback)
}
/** Marker for inlined provider helper receivers; no extraction success is inferred from its presence. */
object AppUtils
