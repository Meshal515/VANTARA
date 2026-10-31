package com.vantara.runtime

import android.app.Application
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.plugins.BuiltinSourceRefresh
import com.vantara.plugins.ExtensionFailure
import com.vantara.plugins.FILLER_PACKAGES
import com.vantara.plugins.RepoClient
import com.vantara.plugins.RepoIndex
import com.vantara.plugins.ensureEngineInjekt
import dev.vantara.spike.ContentWarning
import dev.vantara.spike.FileExtensionLoader
import dev.vantara.spike.ImagePayloadPolicy
import dev.vantara.spike.SPIKE_SOURCES
import dev.vantara.spike.SourceCompatRepairs
import dev.vantara.spike.SourceSpec
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.io.File
import java.security.MessageDigest

/**
 * رحلة حية لكل مصدر مانجا عبر مكوّنات التطبيق نفسها: تحميل الحزمة (المضمّنة بالبصمة، أو من مستودع
 * Keiyoushi بتوقيعه) ← الرائج ← التفاصيل والفصول ← صفحات أحدث فصل ← تنزيل أول صورة والتحقق أنها صورة
 * فعلًا (ImagePayloadPolicy كالقارئ). اختياري (`-e vantaraMangaSweep true`) لأنه يطرق المواقع الحقيقية؛
 * التقرير هو الدليل، وكل خطوة PASS/FAIL مع رمز ExtensionFailure ومالكه. لا إعادة محاولة ولا تصفية.
 */
class MangaLiveSweepTest {
    private suspend fun <T> step(out: JsonObjectBuilder,name: String,ms: Long,block: suspend ()->T): T? {
        val started=System.nanoTime()
        return try {
            val value=withTimeout(ms) { block() }
            out.put(name,buildJsonObject { put("result","PASS");put("ms",(System.nanoTime()-started)/1_000_000) })
            value
        } catch (error: Throwable) {
            val v=ExtensionFailure.classify(error)
            out.put(name,buildJsonObject {
                put("result","FAIL");put("code",v.code);put("owner",v.owner.name.lowercase())
                put("detail",(error.javaClass.simpleName+": "+(error.message ?: "")).replace(Regex("https?://\\S+"),"<url>").take(200))
                put("ms",(System.nanoTime()-started)/1_000_000)
            })
            null
        }
    }

    private fun sha256(bytes: ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test fun mangaJourneyReport() = runBlocking {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue("Manga live sweep is opt-in",args.getString("vantaraMangaSweep")=="true")
        val only=args.getString("vantaraOnly")?.split(',')?.map { it.trim().lowercase() }?.filter { it.isNotEmpty() }?.toSet()
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val network=Injekt.get<NetworkHelper>()
        val loader=FileExtensionLoader(context)
        val output=File(context.getExternalFilesDir(null),"manga-sweep").apply { mkdirs() }
        val reports=mutableListOf<JsonObject>()
        // نافذة أمامية كما عند القارئ: حل Cloudflare الصامت في عميل المانجا يحتاجها (MangaSwat وغيره)
        val window=androidx.test.core.app.ActivityScenario.launch(com.vantara.app.MainActivity::class.java)

        // المضمّنة (العربية والإنجليزية) ثم عربية Keiyoushi غير المضمّنة، كما يثبّتها المستخدم من المستودع
        val builtin=(SPIKE_SOURCES+FILLER_PACKAGES).distinctBy { it.pkg }
        val packages=mutableListOf<Triple<String,SourceSpec,suspend ()->ByteArray>>()
        for (spec in builtin) packages+=Triple("builtin",spec) {
            runCatching { context.assets.open("extensions/${spec.pkg}.apk").use { it.readBytes() } }.getOrNull()
                ?.takeIf { sha256(it).equals(spec.sha256,true) } ?: error("BUNDLED_MISSING_OR_STALE")
        }
        val repo=RepoClient(context,network.client)
        val index=runCatching { repo.read(BuiltinSourceRefresh.KEIYOUSHI_BASE) }
        index.exceptionOrNull()?.let { Log.i("VANTARA_MANGA",buildJsonObject { put("repository","FAIL");put("detail",it.toString().take(200)) }.toString()) }
        index.getOrNull()?.let { (meta,list) ->
            require(meta.fingerprint==BuiltinSourceRefresh.KEIYOUSHI_KEY) { "Keiyoushi signing key changed" }
            for (ext in list) {
                // المضمّنة: إن نشرت Keiyoushi إصدارًا غير المثبّت يُختبر الأحدث أيضًا، فيثبت هل التحديث يصلح عطلها
                builtin.firstOrNull { it.pkg==ext.pkg }?.let { pinned ->
                    if (!ext.anime && ext.version!=pinned.versionName) {
                        val spec=pinned.copy(apkUrl=ext.apkUrl,sha256="",versionName=ext.version,expectedLib=ext.lib)
                        packages+=Triple("keiyoushi-latest",spec) { repo.downloadSigned(ext.apkUrl,meta.fingerprint) }
                    }
                }
                if (ext.anime || ext.nsfw || ext.pkg in builtin.map { it.pkg } || ext.sources.none { it.lang.equals("ar",true) }) continue
                val visible=RepoIndex.visibleSources(ext)
                val spec=SourceSpec(label=ext.name,pkg=ext.pkg,expectedLib=ext.lib,apkUrl=ext.apkUrl,sha256="",versionName=ext.version,
                    warning=if (ext.nsfw) ContentWarning.MIXED else ContentWarning.SAFE,
                    arabicSourceIds=visible.map { it.id }.toSet(),arabicSourceNames=visible.map { it.name })
                packages+=Triple("keiyoushi",spec) { repo.downloadSigned(ext.apkUrl,meta.fingerprint) }
            }
        }

        try { for ((origin,base,fetch) in packages) {
            if (only!=null && base.label.lowercase() !in only) continue
            val report=buildJsonObject {
                put("extension",base.label);put("origin",origin);put("version",base.versionName)
                val bytes=step(this,"download",90_000) { fetch() } ?: return@buildJsonObject
                val spec=if (base.sha256.isEmpty()) base.copy(sha256=sha256(bytes)) else base
                val sources=step(this,"load",60_000) {
                    when (val r=loader.load(spec,bytes)) {
                        is FileExtensionLoader.Result.Fail -> error("${r.stage}: ${r.reason}")
                        is FileExtensionLoader.Result.Ok -> r.loaded.sources.filterIsInstance<CatalogueSource>()
                    }
                }.orEmpty()
                // المصادر التي يعرضها التطبيق: المعلنة في البيان، وإلا العربية، وإلا الأولى
                val shown=sources.filter { it.id.toString() in spec.arabicSourceIds }
                    .ifEmpty { sources.filter { it.lang=="ar" } }.ifEmpty { sources.take(1) }
                put("sources",JsonArray(shown.map { source -> buildJsonObject {
                    put("name",source.name);put("lang",source.lang);put("id",source.id.toString())
                    val page=step(this,"popular",45_000) { source.getPopularManga(1) }
                        ?: step(this,"latest",45_000) { source.getLatestUpdates(1) }
                    put("items",page?.mangas?.size ?: 0)
                    val manga=page?.mangas?.firstOrNull() ?: return@buildJsonObject
                    put("sampleTitle",manga.title.take(80))
                    val update=step(this,"series",60_000) {
                        try { SourceCompatRepairs.loadSeries(source,manga) }
                        catch (e: kotlinx.coroutines.CancellationException) { throw e }
                        catch (_: Throwable) { SMangaUpdate(manga,SourceCompatRepairs.loadChapters(source,manga)) }
                    }
                    put("chapters",update?.chapters?.size ?: 0)
                    val chapter=update?.chapters?.firstOrNull() ?: return@buildJsonObject
                    val pages=step(this,"pages",60_000) { SourceCompatRepairs.loadPages(source,chapter) }
                    put("pageCount",pages?.size ?: 0)
                    // فصل ثانٍ من منتصف القائمة: صفحتان أو أقل في الفصلين معًا = قراءة ناقصة لا فصل قصير
                    update.chapters.getOrNull(update.chapters.size/2)?.takeIf { update.chapters.size>2 }?.let { middle ->
                        put("pageCount2",runCatching { withTimeout(45_000) { SourceCompatRepairs.loadPages(source,middle).size } }.getOrDefault(-1))
                    }
                    val first=pages?.firstOrNull() ?: return@buildJsonObject
                    step(this,"image",60_000) {
                        val http=source as? HttpSource ?: error("NOT_HTTP_SOURCE")
                        first.imageUrl=first.imageUrl ?: http.getImageUrl(first)
                        http.getImage(first).use { res ->
                            val body=res.body.bytes()
                            require(body.size>1024) { "image too small: ${body.size}" }
                            val verdict=ImagePayloadPolicy.validate(res.header("content-type"),body)
                            require(verdict.accepted) { "not an image: ${verdict.reason}" }
                            put("imageBytes",body.size)
                        }
                    }
                } }))
            }
            reports+=report
            Log.i("VANTARA_MANGA",report.toString())
            File(output,"report.json").writeText(JsonArray(reports).toString())
        } } finally { window.close() }
    }
}
