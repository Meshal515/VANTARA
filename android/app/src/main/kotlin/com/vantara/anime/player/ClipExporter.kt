package com.vantara.anime.player

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.Clock
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultAssetLoaderFactory
import androidx.media3.transformer.DefaultDecoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import okhttp3.OkHttpClient
import java.io.File

/**
 * يصنع ملف MP4 من جزء الحلقة المختار فقط — عند «حفظ» أو «مشاركة» فقط.
 *
 * قصّ مباشر (remux) بلا إعادة ترميز: عينات الفيديو والصوت تُنقل كما هي من
 * حاوية المصدر (HLS/TS أو MP4) إلى MP4. البايتات تُقرأ من [MediaCache] — نفس
 * ما نزل أثناء المشاهدة — فالجزء الذي شاهدته لا يُنزَّل من جديد.
 *
 * القصّ بلا ترميز يبدأ من إطار مفتاحي:
 *  - HLS: كل مقطع يبدأ بإطار مفتاحي، فالبداية تُقرَّب لبداية المقطع الذي
 *    يحويها ([keyframeStartMs]) — قد يبدأ الملف قبل اختيارك بثوانٍ قليلة.
 *  - MP4: Transformer يقصّ مباشرة ويعيد ترميز أول مجموعة صور فقط حتى أول
 *    إطار مفتاحي (أقل من ثانيتين عادةً)، ثم نقل مباشر لكل الباقي.
 *
 * الناتج فيديو الحلقة وحده: لا واجهة المشغّل ولا ترجمات منفصلة (الترجمة
 * المحروقة في الصورة تبقى لأنها جزء منها).
 */
@OptIn(UnstableApi::class)
class ClipExporter(private val context: Context, private val client: OkHttpClient) {
    /** بداية الملف الفعلية بعد التقريب لإطار مفتاحي (للعرض). */
    var lastStartMs: Long? = null
        private set


    sealed interface Result {
        data class Done(val file: File) : Result
        data class Failed(val message: String, val unsupported: Boolean) : Result
    }

    private var transformer: Transformer? = null
    private val main = Handler(Looper.getMainLooper())
    private var poll: Runnable? = null

    /** آخر ملف صُنع ولأي مدى: «حفظ» ثم «مشاركة» لا يصنعان المقطع مرتين. */
    private var last: Pair<String, File>? = null

    val busy get() = transformer != null

    fun cached(c: Candidate, r: ClipRange): File? =
        last?.takeIf { it.first == key(c, r) && it.second.exists() }?.second

    private fun key(c: Candidate, r: ClipRange) = "${c.url}|${r.startMs}|${r.endMs}"

    /**
     * على الخيط الرئيسي (شرط Transformer). [onProgress] بين 0 و100.
     * [keyframeStartMs]: بداية مقطع HLS الذي يحوي بداية الاختيار (إن عُرفت).
     */
    fun export(c: Candidate, r: ClipRange, keyframeStartMs: Long?, onProgress: (Int) -> Unit, onResult: (Result) -> Unit) {
        cached(c, r)?.let { return onResult(Result.Done(it)) }
        if (c.url.startsWith("blob:") || !c.url.startsWith("http")) {
            return onResult(Result.Failed("هذا السيرفر لا يسمح بقصّ المقاطع", unsupported = true))
        }
        cancel()
        val dir = File(context.cacheDir, "clips").apply { mkdirs() }
        // مقطع واحد مؤقت يكفي: القديم يُحذف، والمحفوظ في المعرض نسخة مستقلة
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "vantara-clip-${System.currentTimeMillis()}.mp4")

        val hls = c.container == Container.HLS
        val startMs = if (hls && keyframeStartMs != null) keyframeStartMs.coerceIn(0, r.startMs) else r.startMs
        lastStartMs = startMs
        val http = MediaCache.factory(context, client, c.headers)
        val loader = DefaultAssetLoaderFactory(
            context,
            DefaultDecoderFactory(context),
            Clock.DEFAULT,
            DefaultMediaSourceFactory(http),
            DataSourceBitmapLoader(context),
        )
        val item = MediaItem.Builder()
            .setUri(c.url)
            .apply {
                when (c.container) {
                    Container.HLS -> setMimeType(MimeTypes.APPLICATION_M3U8)
                    Container.DASH -> setMimeType(MimeTypes.APPLICATION_MPD)
                    else -> Unit
                }
            }
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(startMs)
                    .setEndPositionMs(r.endMs)
                    // HLS: البداية بداية مقطع = إطار مفتاحي، فلا حاجة لأي ترميز
                    .setStartsAtKeyFrame(hls && keyframeStartMs != null)
                    .build(),
            )
            .build()
        // بلا تأثيرات ولا صيغة مفروضة: الترميز الأصلي يُنقل كما هو (remux)
        val edited = EditedMediaItem.Builder(item).build()

        val t = Transformer.Builder(context)
            .setAssetLoaderFactory(loader)
            // MP4: نقل مباشر، ويُرمَّز أول GOP فقط إن لم تبدأ البداية بإطار مفتاحي
            .experimentalSetTrimOptimizationEnabled(c.container == Container.MP4)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    stopPolling()
                    transformer = null
                    last = key(c, r) to out
                    onResult(Result.Done(out))
                }

                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    stopPolling()
                    transformer = null
                    out.delete()
                    onResult(describe(exportException))
                }
            })
            .build()
        transformer = t
        onProgress(0)
        t.start(edited, out.absolutePath)
        val holder = ProgressHolder()
        poll = object : Runnable {
            override fun run() {
                val tr = transformer ?: return
                if (tr.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress)
                main.postDelayed(this, 250)
            }
        }.also { main.postDelayed(it, 250) }
    }

    /** يحذف ملفات المقاطع المؤقتة (بعد الحفظ، وعند إغلاق المحرّر). */
    fun purge() {
        last = null
        MediaCache.purgeClips(context)
    }

    fun cancel() {
        stopPolling()
        transformer?.cancel()
        transformer = null
    }

    private fun stopPolling() {
        poll?.let(main::removeCallbacks)
        poll = null
    }

    private fun describe(e: ExportException): Result.Failed {
        val code = e.errorCode
        return when {
            code in 2000..2999 -> Result.Failed("تعذّر تحميل هذا الجزء من السيرفر — جرّب سيرفرًا آخر", unsupported = false)
            code in 3000..3999 || code == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
                Result.Failed("صيغة هذا السيرفر لا تدعم قصّ المقاطع", unsupported = true)
            code in 4000..4999 -> Result.Failed("جهازك لم يستطع ترميز المقطع", unsupported = true)
            else -> Result.Failed("تعذّر صنع المقطع (${e.errorCodeName})", unsupported = false)
        }
    }

    /** نسخة في المعرض: Movies/VANTARA. */
    fun saveToGallery(file: File, displayName: String): Uri? {
        val name = displayName.replace(Regex("[\\\\/:*?\"<>|]"), " ").take(80).trim().ifEmpty { "VANTARA" } + ".mp4"
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/VANTARA")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: return null
            runCatching {
                resolver.openOutputStream(uri)?.use { o -> file.inputStream().use { it.copyTo(o) } } ?: error("no stream")
                resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
                uri
            }.getOrElse {
                resolver.delete(uri, null, null)
                null
            }
        } else {
            // قبل أندرويد 10: مجلد التطبيق في الذاكرة الخارجية (لا يحتاج إذنًا)، والماسح يضيفه للمعرض
            val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "VANTARA").apply { mkdirs() }
            val dest = File(dir, name)
            runCatching {
                file.copyTo(dest, overwrite = true)
                MediaScannerConnection.scanFile(context, arrayOf(dest.absolutePath), arrayOf("video/mp4"), null)
                Uri.fromFile(dest)
            }.getOrNull()
        }
    }
}
