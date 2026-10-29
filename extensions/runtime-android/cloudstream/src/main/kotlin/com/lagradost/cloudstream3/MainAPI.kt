package com.lagradost.cloudstream3

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.json.JsonMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import com.lagradost.cloudstream3.utils.ExtractorLink
import kotlinx.serialization.json.Json
import java.net.URI

open class MainAPI {
    open var name=""
    open var mainUrl=""
    open var lang="en"
    open val hasMainPage=false
    open val hasQuickSearch=false
    open val supportedTypes:Set<TvType> = emptySet()
    open val mainPage:List<MainPageData> = emptyList()
    open val vpnStatus=VPNStatus.None
    var sourcePlugin:String?=null
    open suspend fun search(query:String):List<SearchResponse>? = throw UnsupportedOperationException("search")
    open suspend fun search(query:String,page:Int):SearchResponseList? {
        if(page!=1)throw UnsupportedOperationException("search pagination")
        return search(query)?.let{SearchResponseList(it,false)}
    }
    open suspend fun getMainPage(page:Int,request:MainPageRequest):HomePageResponse? = throw UnsupportedOperationException("catalogue")
    open suspend fun load(url:String):LoadResponse? = throw UnsupportedOperationException("details")
    open suspend fun loadLinks(data:String,isCasting:Boolean,subtitleCallback:(SubtitleFile)->Unit,callback:(ExtractorLink)->Unit):Boolean = throw UnsupportedOperationException("videoLinks")
}
val mapper:JsonMapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,false).build()
val json:Json=Json {ignoreUnknownKeys=true;isLenient=false}
fun MainAPI.fixUrl(url:String):String {
    val base=URI(mainUrl.trimEnd('/')+"/")
    val resolved=base.resolve(url)
    require(resolved.scheme=="https"||resolved.scheme=="http") {"Unsupported content URL"}
    require(resolved.rawUserInfo==null) {"Credentials in content URL"}
    return resolved.toASCIIString()
}
fun MainAPI.newAnimeSearchResponse(name:String,url:String,type:TvType=TvType.Anime,fix:Boolean=true,initializer:AnimeSearchResponse.()->Unit={}):AnimeSearchResponse {
    return AnimeSearchResponse(name,if(fix)fixUrl(url)else url,this.name,type).apply(initializer)
}
fun MainAPI.newEpisode(data:Any,initializer:Episode.()->Unit):Episode {
    val opaque=if(data is String)data else mapper.writeValueAsString(data)
    return Episode(opaque).apply(initializer)
}
fun newHomePageResponse(name:String,list:List<SearchResponse>,hasNext:Boolean?=null):HomePageResponse=HomePageResponse(listOf(HomePageList(name,list)),hasNext?:false)
fun newHomePageResponse(list:List<HomePageList>,hasNext:Boolean?=null):HomePageResponse=HomePageResponse(list,hasNext?:false)
fun newSearchResponseList(list:List<SearchResponse>,hasNext:Boolean?=null):SearchResponseList=SearchResponseList(list,hasNext?:false)
suspend fun MainAPI.newTvSeriesLoadResponse(name:String,url:String,type:TvType,episodes:List<Episode>,initializer:suspend TvSeriesLoadResponse.()->Unit={}):TvSeriesLoadResponse {
    return TvSeriesLoadResponse(name,fixUrl(url),this.name,type,episodes).also {initializer(it)}
}
suspend fun MainAPI.newAnimeLoadResponse(name:String,url:String,type:TvType,fix:Boolean=true,initializer:suspend AnimeLoadResponse.()->Unit={}):AnimeLoadResponse {
    return AnimeLoadResponse(name,if(fix)fixUrl(url)else url,this.name,type).also {initializer(it)}
}
fun addEpisodes(response:AnimeLoadResponse,status:DubStatus,episodes:List<Episode>){response.episodes[status]=episodes.toList()}

/** `null` stays null; anything else resolves like [fixUrl]. */
fun MainAPI.fixUrlNull(url:String?):String?=if(url.isNullOrBlank())null else fixUrl(url)
fun mainPageOf(vararg elements:Pair<String,String>):List<MainPageData> =elements.map{(data,name)->MainPageData(name,data)}
fun MainAPI.newEpisode(url:String,initializer:Episode.()->Unit={},fix:Boolean=true):Episode=Episode(if(fix)fixUrl(url)else url).apply(initializer)
fun newHomePageResponse(list:HomePageList,hasNext:Boolean?=null):HomePageResponse=HomePageResponse(listOf(list),hasNext?:false)
fun newHomePageResponse(data:MainPageRequest,list:List<SearchResponse>,hasNext:Boolean?=null):HomePageResponse=
    HomePageResponse(listOf(HomePageList(data.name,list,data.horizontalImages)),hasNext?:false)
fun MainAPI.newMovieSearchResponse(name:String,url:String,type:TvType=TvType.Movie,fix:Boolean=true,initializer:MovieSearchResponse.()->Unit={}):MovieSearchResponse=
    MovieSearchResponse(name,if(fix)fixUrl(url)else url,this.name,type).apply(initializer)
fun MainAPI.newTvSeriesSearchResponse(name:String,url:String,type:TvType=TvType.TvSeries,fix:Boolean=true,initializer:TvSeriesSearchResponse.()->Unit={}):TvSeriesSearchResponse=
    TvSeriesSearchResponse(name,if(fix)fixUrl(url)else url,this.name,type).apply(initializer)
fun MainAPI.newLiveSearchResponse(name:String,url:String,type:TvType=TvType.Live,fix:Boolean=true,initializer:LiveSearchResponse.()->Unit={}):LiveSearchResponse=
    LiveSearchResponse(name,if(fix)fixUrl(url)else url,this.name,type).apply(initializer)
suspend fun MainAPI.newMovieLoadResponse(name:String,url:String,type:TvType,dataUrl:String,initializer:suspend MovieLoadResponse.()->Unit={}):MovieLoadResponse=
    MovieLoadResponse(name,fixUrl(url),this.name,type,dataUrl).also{initializer(it)}
suspend fun MainAPI.newLiveStreamLoadResponse(name:String,url:String,dataUrl:String,initializer:suspend LiveStreamLoadResponse.()->Unit={}):LiveStreamLoadResponse=
    LiveStreamLoadResponse(name,fixUrl(url),this.name,dataUrl).also{initializer(it)}
suspend fun newSubtitleFile(lang:String,url:String,initializer:suspend SubtitleFile.()->Unit={}):SubtitleFile=SubtitleFile(lang,url).also{initializer(it)}
fun SearchResponse.addPoster(url:String?,headers:Map<String,String>?=null){posterUrl=url;posterHeaders=headers}
fun AnimeSearchResponse.addDubStatus(isDub:Boolean,episodes:Int?=null) {
    val status=if(isDub)DubStatus.Dubbed else DubStatus.Subbed
    dubStatus=(dubStatus?:java.util.EnumSet.noneOf(DubStatus::class.java)).also{it.add(status)}
    if(episodes!=null&&episodes>0)this.episodes[status]=episodes
}
