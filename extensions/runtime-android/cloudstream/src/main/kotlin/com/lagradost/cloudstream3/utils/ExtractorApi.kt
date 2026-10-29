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
/**
 * Resolves an embed/share page to media links, in this order: extractors the provider registered itself,
 * VANTARA's own extractors, then direct media URLs. Like the original contract it reports `false` instead of
 * throwing when nothing handles the host, so a provider's remaining servers still run.
 */
suspend fun loadExtractor(url:String,referer:String?,subtitleCallback:(SubtitleFile)->Unit,callback:(ExtractorLink)->Unit):Boolean {
    val parsed=runCatching{URI(url)}.getOrNull()?:return false
    if(!(parsed.scheme.equals("https",true)||parsed.scheme.equals("http",true))||parsed.rawUserInfo!=null||parsed.host==null)return false
    val host=parsed.host
    ExtractorRegistry.find(host)?.let { it.getUrl(url,referer,subtitleCallback,callback);return true }
    dev.vantara.runtime.cloudstream.extractors.VantaraExtractors.find(host)?.let { e->
        if(e.extract(url,referer,subtitleCallback,callback))return true
        dev.vantara.runtime.cloudstream.WorkerState.missingExtractor(host);return false
    }
    val path=parsed.path?.lowercase().orEmpty()
    if(!dev.vantara.runtime.cloudstream.extractors.VantaraExtractors.isSharingPage(host)&&(path.endsWith(".m3u8")||path.endsWith(".mp4")||path.endsWith(".mpd")||path.endsWith(".mkv")||path.endsWith(".webm"))){
        val type=if(path.endsWith(".m3u8"))ExtractorLinkType.M3U8 else if(path.endsWith(".mpd"))ExtractorLinkType.DASH else ExtractorLinkType.VIDEO
        callback(newExtractorLink(host,host,url,type){this.referer=referer.orEmpty()});return true
    }
    dev.vantara.runtime.cloudstream.WorkerState.missingExtractor(host)
    return false
}
val INFER_TYPE:ExtractorLinkType=ExtractorLinkType.INFERRED
val schemaStripRegex=Regex("""^(https:|)//(www\.|)""")
suspend fun loadExtractor(url:String,subtitleCallback:(SubtitleFile)->Unit,callback:(ExtractorLink)->Unit)=loadExtractor(url,null,subtitleCallback,callback)
object AppUtils {
    fun toJson(value:Any?):String=if(value is String)value else com.lagradost.cloudstream3.mapper.writeValueAsString(value)
    inline fun <reified T> parseJson(value:String):T=com.lagradost.cloudstream3.mapper.readValue(value,T::class.java)
    inline fun <reified T> tryParseJson(value:String?):T?=value?.let{runCatching{parseJson<T>(it)}.getOrNull()}
}
