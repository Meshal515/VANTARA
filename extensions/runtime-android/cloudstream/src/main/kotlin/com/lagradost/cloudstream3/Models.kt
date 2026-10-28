package com.lagradost.cloudstream3

/** Original DTO semantics implementing the observed interoperable profile. */
enum class TvType { Movie, TvSeries, Anime, AnimeMovie, OVA, Torrent, Documentary, AsianDrama, Live, Cartoon, Others }
enum class ShowStatus { Completed, Ongoing }
enum class DubStatus { Dubbed, Subbed, None }
enum class VPNStatus { None, MightBeNeeded, Torrent }
enum class ProviderType { DirectProvider, MetaProvider }
enum class SearchQuality { BlueRay, Cam, CamRip, DVD, FourK, HD, HDR, HQ, HdCam, SD, SDR, TeleSync, WEBRip, WorkPrint }
class Score private constructor(private val fraction:Double) {
    fun toInt(maxScore:Int=10)=kotlin.math.round(fraction*maxScore).toInt()
    fun toDouble(maxScore:Int=10)=fraction*maxScore
    fun toFloat(maxScore:Int=10)=toDouble(maxScore).toFloat()
    companion object {
        fun from10(value:Float?):Score?=value?.takeIf{it.isFinite()}?.let{Score((it/10.0).coerceIn(0.0,1.0))}
        fun from10(value:Double?):Score?=value?.takeIf{it.isFinite()}?.let{Score((it/10.0).coerceIn(0.0,1.0))}
        fun from10(value:Int?):Score?=value?.let{from10(it.toDouble())}
        fun from10(value:String?):Score?=value?.toDoubleOrNull()?.let{from10(it)}
    }
}
data class MainPageRequest(val name:String,val data:String,val horizontalImages:Boolean)
data class MainPageData(val name:String,val data:String,val horizontalImages:Boolean=false)
data class HomePageList(val name:String,var list:List<SearchResponse>,val isHorizontalImages:Boolean=false)
data class HomePageResponse(val items:List<HomePageList>,val hasNext:Boolean=false)
data class SearchResponseList(val items:List<SearchResponse>,val hasNext:Boolean=false)
interface SearchResponse {
    val name:String;val url:String;val apiName:String
    var type:TvType?;var posterUrl:String?;var posterHeaders:Map<String,String>?
    var id:Int?;var quality:SearchQuality?;var score:Score?
}
data class AnimeSearchResponse(override val name:String,override val url:String,override val apiName:String,
    override var type:TvType?=TvType.Anime,override var posterUrl:String?=null,var year:Int?=null,
    override var posterHeaders:Map<String,String>?=null,override var id:Int?=null,override var quality:SearchQuality?=null,
    override var score:Score?=null):SearchResponse

data class Episode(var data:String,var name:String?=null,var season:Int?=null,var episode:Int?=null,var posterUrl:String?=null)
interface LoadResponse {
    var name:String;var url:String;var apiName:String;var type:TvType
    var posterUrl:String?;var posterHeaders:Map<String,String>?;var year:Int?;var plot:String?
    var tags:List<String>?;var recommendations:List<SearchResponse>?;var score:Score?
}
interface EpisodeResponse
abstract class WorkResponse(override var name:String,override var url:String,override var apiName:String,override var type:TvType):LoadResponse {
    override var posterUrl:String?=null;override var posterHeaders:Map<String,String>?=null
    override var year:Int?=null;override var plot:String?=null;override var tags:List<String>?=null
    override var recommendations:List<SearchResponse>?=null;override var score:Score?=null
    var showStatus:ShowStatus?=null
}
class TvSeriesLoadResponse(name:String,url:String,apiName:String,type:TvType,var episodes:List<Episode>):WorkResponse(name,url,apiName,type),EpisodeResponse
class AnimeLoadResponse(name:String,url:String,apiName:String,type:TvType,var episodes:MutableMap<DubStatus,List<Episode>> = linkedMapOf()):WorkResponse(name,url,apiName,type),EpisodeResponse
/** Binary model only; it is not connected to VANTARA's existing subtitle system. */
data class SubtitleFile(val lang:String,val url:String)
class ErrorLoadingException(message:String):RuntimeException(message)
