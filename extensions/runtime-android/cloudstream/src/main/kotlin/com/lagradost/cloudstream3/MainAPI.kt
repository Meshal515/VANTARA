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
suspend fun MainAPI.newTvSeriesLoadResponse(name:String,url:String,type:TvType,episodes:List<Episode>,initializer:suspend TvSeriesLoadResponse.()->Unit):TvSeriesLoadResponse {
    return TvSeriesLoadResponse(name,fixUrl(url),this.name,type,episodes).also {initializer(it)}
}
suspend fun MainAPI.newAnimeLoadResponse(name:String,url:String,type:TvType,fix:Boolean=true,initializer:suspend AnimeLoadResponse.()->Unit={}):AnimeLoadResponse {
    return AnimeLoadResponse(name,if(fix)fixUrl(url)else url,this.name,type).also {initializer(it)}
}
fun addEpisodes(response:AnimeLoadResponse,status:DubStatus,episodes:List<Episode>){response.episodes[status]=episodes.toList()}
