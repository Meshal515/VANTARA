package dev.vantara.runtime.cloudstream

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.plugins.Plugin
import com.lagradost.cloudstream3.plugins.BasePlugin
import com.lagradost.cloudstream3.utils.*
import dev.vantara.runtime.api.*
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException

/** One published package per isolated generation. It never receives the host Activity or stores. */
/** Worker-side budget for collecting video links; the host allows the operation 30 s in total. */
private const val LINKS_BUDGET_MS=26_000L
/** Servers that finish within this of each other arrive in one stage. */
private const val STAGE_COALESCE_MS=300L

class CloudStreamProvider(private val context:Context,private val loader:ClassLoader,private val entry:String):RuntimeProvider {
    private var sources:List<MainAPI>?=null
    private var plugin:BasePlugin?=null
    /** One staged videoLinks per worker: the host asks for the next stage until it is no longer pending. */
    private class Staged(val token:String,val live:LinkCollector.Live) { var reported=0 }
    @Volatile private var staged:Staged?=null
    /**
     * The next stage of a staged videoLinks: links that arrived since the last one, and the server pages no extractor
     * here handles (the host starts VANTARA's resolver on those right away instead of after the slowest extractor).
     * An end with nothing at all fails exactly as the one-shot operation does.
     */
    private fun stage(run:Staged):Map<String,Any?> {
        val stage=run.live.next(STAGE_COALESCE_MS){ WorkerState.hasMissingEmbeds() }
        val missing=WorkerState.takeMissingExtractors()
        val embeds=WorkerState.takeMissingEmbeds()
        run.reported+=missing.size+embeds.size
        if(stage.ended) {
            if(staged===run)staged=null
            if(stage.total==0&&run.reported==0)throw stage.failure ?: IOException(if(stage.complete)"NO_VIDEO_LINKS" else "OPERATION_TIMEOUT")
        }
        return mapOf("items" to stage.links,"subtitles" to stage.subtitles,"missingExtractors" to missing,"missingSamples" to WorkerState.takeMissingSamples(),
            "missingEmbeds" to embeds,"linkEmbeds" to WorkerState.takeLinkEmbeds(),"complete" to stage.complete,"pending" to (if(stage.ended) null else run.token))
    }
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
                val candidate=PluginAdmission.instantiate(type,loader)
                val worker=WorkerContext(context,loader)
                WorkerState.install(worker)
                PluginAdmission.initialize(candidate,worker);plugin=candidate
            }
            check(result.sources.isNotEmpty()){"NO_REGISTERED_SOURCES"}
            result.extractors.forEach{ExtractorRegistry.add(it)}
            sources=result.sources
            // After WorkerState.install: the world reads this generation's context and broker
            LibraryWorld.attach(http)
        }catch(failure:Throwable){NetworkBridge.reset();ExtractorRegistry.clear();WorkerState.reset();LibraryWorld.reset();plugin=null;throw failure}
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
                // قسم محدد عند طلبه صراحة، وإلا الصفحة الرئيسية بأقسامها كما في CloudStream
                if(input.has("section"))SourceOperations.catalogue(source,input.path("page").asInt(1),input.path("section").asInt(0))
                else SourceOperations.home(source,input.path("page").asInt(1))
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
                val data=input.path("data").asText("");require(data.isNotBlank())
                if(input.path("stage").asBoolean(false)) {
                    staged?.live?.cancel();staged=null
                    WorkerState.takeMissingExtractors();WorkerState.takeMissingSamples();WorkerState.takeMissingEmbeds();WorkerState.takeLinkEmbeds()
                    val live=LinkCollector.start(LINKS_BUDGET_MS){sub,cb->source.loadLinks(data,false,sub,cb)} ?: throw IOException("VIDEO_LINK_WORKER_BUSY")
                    val run=Staged(java.util.UUID.randomUUID().toString(),live)
                    staged=run
                    return@runBlocking mapper.writeValueAsString(stage(run))
                }
                WorkerState.takeMissingExtractors();WorkerState.takeMissingSamples();WorkerState.takeMissingEmbeds();WorkerState.takeLinkEmbeds()
                val collected=LinkCollector.collect(LINKS_BUDGET_MS){sub,cb->source.loadLinks(data,false,sub,cb)}
                val missing=WorkerState.takeMissingExtractors()
                // An empty answer still says which media hosts lacked an extractor; that is the actionable part.
                if(collected.links.isEmpty()&&missing.isEmpty())throw collected.failure ?: IOException(if(collected.complete)"NO_VIDEO_LINKS" else "OPERATION_TIMEOUT")
                mapOf("items" to collected.links,"subtitles" to collected.subtitles,"missingExtractors" to missing,"missingSamples" to WorkerState.takeMissingSamples(),"missingEmbeds" to WorkerState.takeMissingEmbeds(),"linkEmbeds" to WorkerState.takeLinkEmbeds(),"complete" to collected.complete)
            }
            "videoLinksMore"->{
                val run=staged?.takeIf { it.token==input.path("token").asText("") } ?: throw IOException("NO_PENDING_LINKS")
                stage(run)
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
