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
    override var score:Score?=null):SearchResponse {
    var dubStatus:java.util.EnumSet<DubStatus>?=null
    var episodes:MutableMap<DubStatus,Int> = linkedMapOf()
}
data class MovieSearchResponse(override val name:String,override val url:String,override val apiName:String,
    override var type:TvType?=TvType.Movie,override var posterUrl:String?=null,var year:Int?=null,
    override var posterHeaders:Map<String,String>?=null,override var id:Int?=null,override var quality:SearchQuality?=null,
    override var score:Score?=null):SearchResponse
data class TvSeriesSearchResponse(override val name:String,override val url:String,override val apiName:String,
    override var type:TvType?=TvType.TvSeries,override var posterUrl:String?=null,var year:Int?=null,var episodes:Int?=null,
    override var posterHeaders:Map<String,String>?=null,override var id:Int?=null,override var quality:SearchQuality?=null,
    override var score:Score?=null):SearchResponse
data class LiveSearchResponse(override val name:String,override val url:String,override val apiName:String,
    override var type:TvType?=TvType.Live,override var posterUrl:String?=null,var lang:String?=null,
    override var posterHeaders:Map<String,String>?=null,override var id:Int?=null,override var quality:SearchQuality?=null,
    override var score:Score?=null):SearchResponse

data class Episode(var data:String,var name:String?=null,var season:Int?=null,var episode:Int?=null,var posterUrl:String?=null) {
    var description:String?=null
    var runTime:Int?=null
    var date:Long?=null
    var score:Score?=null
}
enum class ActorRole { Main, Supporting, Background }
data class Actor(val name:String,val image:String?=null)
data class ActorData(val actor:Actor,val role:ActorRole?=null,val roleString:String?=null,val voiceActor:Actor?=null)
data class TrailerData(val extractorUrl:String,val referer:String?,val raw:Boolean)
interface LoadResponse {
    var name:String;var url:String;var apiName:String;var type:TvType
    var posterUrl:String?;var posterHeaders:Map<String,String>?;var year:Int?;var plot:String?
    var tags:List<String>?;var recommendations:List<SearchResponse>?;var score:Score?
    var actors:List<ActorData>?;var backgroundPosterUrl:String?;var contentRating:String?;var duration:Int?
    var trailers:MutableList<TrailerData>
    companion object {
        fun LoadResponse.addActors(actors:List<Pair<Actor,String?>>?){this.actors=actors?.map{(actor,role)->ActorData(actor,roleString=role)}}
        @JvmName("addActorsOnly")
        fun LoadResponse.addActors(actors:List<Actor>?){this.actors=actors?.map{ActorData(it)}}
        @Suppress("UNUSED_PARAMETER")
        suspend fun LoadResponse.addTrailer(trailerUrl:String?,referer:String?=null,addRaw:Boolean=false) {
            if(trailerUrl.isNullOrBlank())return
            trailers.add(TrailerData(trailerUrl,referer,addRaw))
        }
    }
}
interface EpisodeResponse
abstract class WorkResponse(override var name:String,override var url:String,override var apiName:String,override var type:TvType):LoadResponse {
    override var posterUrl:String?=null;override var posterHeaders:Map<String,String>?=null
    override var year:Int?=null;override var plot:String?=null;override var tags:List<String>?=null
    override var recommendations:List<SearchResponse>?=null;override var score:Score?=null
    override var actors:List<ActorData>?=null;override var backgroundPosterUrl:String?=null
    override var contentRating:String?=null;override var duration:Int?=null
    override var trailers:MutableList<TrailerData> = mutableListOf()
    var showStatus:ShowStatus?=null
}
class TvSeriesLoadResponse(name:String,url:String,apiName:String,type:TvType,var episodes:List<Episode>):WorkResponse(name,url,apiName,type),EpisodeResponse
class AnimeLoadResponse(name:String,url:String,apiName:String,type:TvType,var episodes:MutableMap<DubStatus,List<Episode>> = linkedMapOf()):WorkResponse(name,url,apiName,type),EpisodeResponse
/** A single playable item: its links come from `loadLinks(dataUrl)`. */
class MovieLoadResponse(name:String,url:String,apiName:String,type:TvType,var dataUrl:String):WorkResponse(name,url,apiName,type)
class LiveStreamLoadResponse(name:String,url:String,apiName:String,var dataUrl:String):WorkResponse(name,url,apiName,TvType.Live)
data class SubtitleFile(val lang:String,val url:String) {
    var headers:Map<String,String>?=null
}
class ErrorLoadingException(message:String?=null):RuntimeException(message)
