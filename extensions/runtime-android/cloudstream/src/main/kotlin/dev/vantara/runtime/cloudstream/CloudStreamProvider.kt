package dev.vantara.runtime.cloudstream

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.plugins.Plugin
import com.lagradost.cloudstream3.utils.*
import dev.vantara.runtime.api.*
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException

/** One published package per isolated generation. It never receives the host Activity or stores. */
class CloudStreamProvider(private val context:Context,private val loader:ClassLoader,private val entry:String):RuntimeProvider {
    private var sources:List<MainAPI>?=null
    private var plugin:Plugin?=null
    override fun initialize(access:RuntimeAccess) {
        check(sources==null){"PROFILE_ALREADY_INITIALIZED"}
        val http=access as? RuntimeHttpAccess?:throw IOException("FULL_HTTP_UNSUPPORTED")
        NetworkBridge.install{request,follow->
            val bytes=request.body?.let{body->val buffer=okio.Buffer();body.writeTo(buffer);if(buffer.size>1024*1024)throw IOException("REQUEST_BODY_LIMIT");buffer.readByteArray()}
            val answer=http.exchange(RuntimeHttpAccess.Request(request.url.toString(),request.method,request.headers.toMultimap(),bytes,follow))
            BrokerResponses.convert(request,answer)
        }
        try {
            val result=Registration.collect {
                val type=Class.forName(entry,false,loader)
                check(type.classLoader===loader&&Plugin::class.java.isAssignableFrom(type)){"ABI_MISMATCH"}
                val candidate=type.getDeclaredConstructor().newInstance() as Plugin
                val worker=WorkerContext(context,loader)
                WorkerState.install(worker)
                candidate.load(worker);plugin=candidate
            }
            check(result.sources.isNotEmpty()){"NO_REGISTERED_SOURCES"}
            result.extractors.forEach{ExtractorRegistry.add(it)}
            sources=result.sources
        }catch(failure:Throwable){NetworkBridge.reset();ExtractorRegistry.clear();WorkerState.reset();plugin=null;throw failure}
    }
    override fun invoke(operation:String,inputJson:String,access:RuntimeAccess):String {
        val all=checkNotNull(sources){"PROVIDER_NOT_READY"}
        if(operation=="capabilities") {
            kotlinx.serialization.json.Json.parseToJsonElement(inputJson)
            return SourceCapabilities.encode(all)
        }
        return runBlocking {
        val input=mapper.readTree(inputJson)
        val requested=input.path("source").asText("")
        val source=if(requested.isEmpty())all.singleOrNull()?:throw IllegalArgumentException("SOURCE_SELECTION_REQUIRED") else all.singleOrNull{it.name==requested}?:throw IllegalArgumentException("SOURCE_NOT_FOUND")
        val output:Any=when(operation) {
            "catalogue"->{
                SourceOperations.catalogue(source,input.path("page").asInt(1),input.path("section").asInt(0))
            }
            "search"->{val query=input.path("query").asText("");val page=input.path("page").asInt(1);require(query.isNotBlank()&&query.length<=500&&page>0);source.search(query,page)?:throw IOException("NO_SEARCH_RESULT")}
            "details","episodes"->{
                val url=input.path("url").asText("");require(url.isNotBlank());val detail=source.load(url)?:throw IOException("NO_DETAIL_RESULT")
                if(operation=="details")mapOf("item" to detail)
                else mapOf("items" to when(detail){
                    is TvSeriesLoadResponse->detail.episodes
                    is AnimeLoadResponse->detail.episodes.values.flatten()
                    // A movie or a live channel is one playable item: its data is what loadLinks expects.
                    is MovieLoadResponse->listOf(Episode(detail.dataUrl,detail.name))
                    is LiveStreamLoadResponse->listOf(Episode(detail.dataUrl,detail.name))
                    else->throw UnsupportedOperationException("episodes")
                })
            }
            "videoLinks"->{
                val data=input.path("data").asText("");require(data.isNotBlank());val links=mutableListOf<ExtractorLink>();val subtitles=mutableListOf<SubtitleFile>()
                WorkerState.takeMissingExtractors()
                // Subtitles travel with the links; the host decides whether its subtitle engine uses them.
                source.loadLinks(data,false,{file->if(subtitles.size<64)subtitles.add(file)},{link->check(links.size<128){"LINK_RESULT_LIMIT"};links.add(link)})
                val missing=WorkerState.takeMissingExtractors()
                // An empty answer still says which media hosts lacked an extractor; that is the actionable part.
                if(links.isEmpty()&&missing.isEmpty())throw IOException("NO_VIDEO_LINKS")
                mapOf("items" to links,"subtitles" to subtitles,"missingExtractors" to missing)
            }
            else->throw UnsupportedOperationException(operation)
        }
        mapper.writeValueAsString(output)
        }
    }
    private class WorkerContext(base:Context,private val providerLoader:ClassLoader):ContextWrapper(base) {
        override fun getApplicationContext():Context=this
        override fun getClassLoader():ClassLoader=providerLoader
        // Every name resolves to the provider's own scoped store; the host's preferences are unreachable.
        override fun getSharedPreferences(name:String,mode:Int):SharedPreferences=WorkerState.preferences
        override fun getSystemService(name:String):Any=throw UnsupportedOperationException("SYSTEM_SERVICE_UNSUPPORTED")
        override fun startActivity(intent:Intent)=throw UiCapabilityRequired()
        override fun startActivity(intent:Intent,options:Bundle?)=throw UiCapabilityRequired()
    }
}
