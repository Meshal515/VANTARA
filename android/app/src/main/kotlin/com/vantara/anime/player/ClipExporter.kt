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
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.transformer.Codec
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.VideoEncoderSettings
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Effects
import androidx.media3.effect.Presentation
import android.media.MediaMetadataRetriever
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

/** Exports exactly the selected interval as a portable MP4. Only export is encoded;
 * playback retains its original quality. HLS segment boundaries never extend the range. */
@OptIn(UnstableApi::class)
class ClipExporter(private val context: Context, private val client: OkHttpClient) {
    /** بداية المدى المختار دون تقريب إلى مقطع سابق. */
    var lastStartMs: Long? = null
        private set


    sealed interface Result {
        data class Done(val file: File) : Result
        data class Failed(val message: String, val unsupported: Boolean) : Result
    }

    private val workDir = File(context.cacheDir, "clips/${java.util.UUID.randomUUID()}")
    private var activeFile: File? = null
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
    fun export(c: Candidate, r: ClipRange, @Suppress("UNUSED_PARAMETER") keyframeStartMs: Long?, onProgress: (Int) -> Unit, onResult: (Result) -> Unit) {
        cached(c, r)?.let { return onResult(Result.Done(it)) }
        if (!ClipExportBounds.supportsSource(c.url)) {
            return onResult(Result.Failed("هذا السيرفر لا يسمح بقصّ المقاطع", unsupported = true))
        }
        cancel()
        val dir = workDir.apply { mkdirs() }
        // مقطع واحد مؤقت يكفي: القديم يُحذف، والمحفوظ في المعرض نسخة مستقلة
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "vantara-clip-${System.currentTimeMillis()}.mp4").also { activeFile = it }

        val selection = ClipExportBounds.selection(r, keyframeStartMs)
        val startMs = selection.startMs
        lastStartMs = startMs
        val transport = if (c.sourceId.startsWith("addon|")) com.vantara.addons.nativeAddonMediaClient(client, c.url, c.headers) else client
        val delegate = DefaultDataSource.Factory(context, MediaCache.factory(context, transport, c.headers))
        val http = if (c.url.startsWith("vantara-torrent:")) com.vantara.addons.torrent.TorrentEngine.get(context).dataSourceFactory(delegate) else delegate
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
                    .setStartsAtKeyFrame(false)
                    .build(),
            )
            .build()
        val edited = EditedMediaItem.Builder(item)
            .setEffects(Effects(emptyList(), listOf(Presentation.createForHeight(720))))
            .build()
        val encoder = DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(1_200_000).build())
            .setRequestedAudioEncoderSettings(AudioEncoderSettings.Builder().setBitrate(96_000).build())
            .setEnableFallback(true).build()
        // Force decoding at the exact start for every container, even AVC/AAC inputs.
        val exactEncoder = object : Codec.EncoderFactory by encoder {
            override fun videoNeedsEncoding() = true
            override fun audioNeedsEncoding() = true
        }

        val t = Transformer.Builder(context)
            .setAssetLoaderFactory(loader)
            .experimentalSetTrimOptimizationEnabled(false)
            .setEncoderFactory(exactEncoder)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    stopPolling()
                    transformer = null
                    activeFile = null
                    if (!ClipExportBounds.accepts(r.durationMs, exportResult.durationMs, out.length())) {
                        out.delete()
                        onResult(Result.Failed("تعذّر صنع المدى المحدد بدقة — جرّب سيرفرًا آخر", unsupported = false))
                    } else {
                        last = key(c, r) to out
                        onResult(Result.Done(out))
                    }
                }

                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    stopPolling()
                    transformer = null
                    activeFile = null
                    out.delete()
                    onResult(describe(exportException))
                }
            })
            .build()
        transformer = t
        onProgress(0)
        try { t.start(edited, out.absolutePath) } catch (e: Exception) {
            transformer = null
            out.delete()
            onResult(Result.Failed("تعذّر بدء صنع المقطع", unsupported = false))
            return
        }
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
        workDir.deleteRecursively()
    }

    fun cancel() {
        stopPolling()
        transformer?.cancel()
        transformer = null
        activeFile?.delete()
        activeFile = null
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
                check(resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null) > 0)
                uri
            }.getOrElse {
                resolver.delete(uri, null, null)
                null
            }
        } else {
            // قبل أندرويد 10: مجلد التطبيق في الذاكرة الخارجية (لا يحتاج إذنًا)، والماسح يضيفه للمعرض
            val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "VANTARA").apply { mkdirs() }
            val dest = File(dir, "${System.currentTimeMillis()}-$name")
            runCatching {
                file.copyTo(dest, overwrite = true)
                MediaScannerConnection.scanFile(context, arrayOf(dest.absolutePath), arrayOf("video/mp4"), null)
                Uri.fromFile(dest)
            }.getOrNull()
        }
    }
}
