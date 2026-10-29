package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.loadExtractor
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Opt-in live probe (`VANTARA_LIVE_EXTRACTORS=<file with one embed URL per line>`): runs each URL through
 * loadExtractor against the real host and then requests the first bytes of every produced link, so a link
 * only counts when the host actually serves an HLS playlist or a video stream for it. Never runs in CI.
 */
class LiveExtractorProbeTest {
    @After fun reset(){NetworkBridge.reset();WorkerState.takeMissingExtractors();WorkerState.takeMissingSamples()}
    @Test fun probe() {
        val list=System.getenv("VANTARA_LIVE_EXTRACTORS")?.let(::File)
        assumeTrue("live probe is opt-in",list?.isFile==true)
        val client=OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).build()
        NetworkBridge.install{request,follow->client.newBuilder().followRedirects(follow).followSslRedirects(follow).build().newCall(request).execute()}
        for(url in list!!.readLines().map{it.trim()}.filter{it.startsWith("http")}) {
            val links=mutableListOf<ExtractorLink>()
            val handled=runCatching{runBlocking{loadExtractor(url,null,{},links::add)}}
            val verdicts=links.map{link->
                val request=Request.Builder().url(link.url).header("Range","bytes=0-2047").apply{
                    if(link.referer.isNotBlank())header("Referer",link.referer);link.headers.forEach{(k,v)->header(k,v)}
                }.build()
                runCatching{client.newCall(request).execute().use{r->
                    val head=r.body?.byteStream()?.readNBytes(16)?.toString(Charsets.ISO_8859_1).orEmpty()
                    val type=r.header("Content-Type").orEmpty()
                    val media=r.isSuccessful&&(head.startsWith("#EXTM3U")||type.startsWith("video/")||type.contains("mpegurl",true)||type=="application/octet-stream")
                    "${if(media)"MEDIA" else "NOT_MEDIA"} ${r.code} $type"
                }}.getOrElse{"ERROR ${it.javaClass.simpleName}: ${it.message?.take(80)}"}
            }
            println("PROBE ${java.net.URI(url).host} handled=${handled.getOrElse{"error:"+it.message}} links=${links.size} ${verdicts.joinToString(" | ")} missing=${WorkerState.takeMissingExtractors()}")
        }
    }
}
