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
        // كالمضيف في التطبيق (RuntimeHost يضع User-Agent المتصفح لكل طلب بلا UA): بدونه يرسل OkHttp «okhttp/x»
        // فتعيد مواقع مثل Mixdrop صفحة أخرى، فيبدو المستخرج معطوبًا في الفحص وحده
        NetworkBridge.install{request,follow->
            val outgoing=if(request.header("User-Agent")==null)request.newBuilder().header("User-Agent","Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36").build() else request
            client.newBuilder().followRedirects(follow).followSslRedirects(follow).build().newCall(outgoing).execute()
        }
        for(url in list!!.readLines().map{it.trim()}.filter{it.startsWith("http")}) {
            val links=mutableListOf<ExtractorLink>()
            // VANTARA_LIVE_GENERIC=1 runs the shared player-page engine on every URL, to learn which hosts it reads.
            val handled=runCatching{runBlocking{
                if(System.getenv("VANTARA_LIVE_GENERIC")=="1")dev.vantara.runtime.cloudstream.extractors.PlayerPage.extract("probe",url,null,{},links::add)
                else loadExtractor(url,null,{},links::add)
            }}
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
            // مستخرج مسجّل أعاد false: سبب الفشل الفعلي (loadExtractor يبتلعه عمدًا)، وحالة الصفحة كما رآها هذا الجهاز
            val why=if(handled.getOrNull()==true)"" else dev.vantara.runtime.cloudstream.extractors.VantaraExtractors.find(java.net.URI(url).host)?.let{e->
                val page=runCatching{client.newCall(Request.Builder().url(url).header("User-Agent","Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36").build()).execute().use{r->
                    val html=r.body?.string().orEmpty()
                    // بنية الصفحة الحية: كتل P.A.C.K.E.R. وما فُكّ منها، ومفاتيح المشغّل قبل الفك وبعده
                    val packed=Regex("""eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,""").findAll(html).count()
                    val scripts=dev.vantara.runtime.cloudstream.extractors.PlayerPage.scripts(html)
                    val keys=listOf("wurl","file:","sources","m3u8",".mp4").filter{k->k in scripts}.joinToString(",")
                    // مقتطف حول مفتاح الرابط في الصفحة الحية، والقيم الطويلة مقنّعة: يكشف صيغة الإسناد الفعلية
                    val at=scripts.indexOf("wurl").takeIf{it>=0}
                    val excerpt=at?.let{scripts.substring(maxOf(0,it-60),minOf(scripts.length,it+120)).replace(Regex("[A-Za-z0-9]{8,}"),"X").replace('\n',' ')}.orEmpty()
                    "page=${r.code} final=${r.request.url.host} bytes=${html.length} packed=$packed unpackedChars=${scripts.length-html.length} keys=[$keys] near=«$excerpt»"
                }}.getOrElse{"page=ERR ${it.javaClass.simpleName}"}
                val thrown=runCatching{runBlocking{e.extract(url,null,{},{})}}.fold({"returned=$it"},{"threw=${it.javaClass.simpleName}: ${it.message?.take(120)}"})
                " why[${e.name}: $page $thrown]"
            }.orEmpty()
            val line="PROBE ${java.net.URI(url).host} handled=${handled.getOrElse{"error:"+it.javaClass.simpleName}} links=${links.size} ${links.zip(verdicts).joinToString(" | "){(l,v)->"${l.quality}p $v"}} missing=${WorkerState.takeMissingExtractors()}$why"
            println(line)
            // VANTARA_LIVE_OUT: التقرير في ملف يقرؤه CI (مخرجات الاختبار لا تظهر في سجل Gradle)
            System.getenv("VANTARA_LIVE_OUT")?.let{File(it).appendText(line+"\n")}
        }
    }
}
