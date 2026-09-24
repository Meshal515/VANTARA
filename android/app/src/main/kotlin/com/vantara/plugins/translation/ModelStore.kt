package com.vantara.plugins.translation

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * ملفات الترجمة على الجهاز.
 *
 * ليست داخل الـAPK (نصف جيجابايت): تُنزَّل مرة حين يفعّل المستخدم الترجمة،
 * إلى `files/translation-models/`، وكل ملف يُتحقق ببصمة sha256 قبل أن يُعتمد.
 * السجل هنا هو نفسه سجل `services/translation-worker/vantara_worker/models.py`
 * (نفس الروابط والبصمات)، فالجوال والخادم يشغّلان الأوزان نفسها.
 *
 * `VERSION` يرتفع حين تتغير أي بصمة: الإعدادات تعرض «تحديث» حين يختلف عن
 * المكتوب في `version` المحفوظ مع الملفات.
 */
class ModelStore(context: Context) {

    data class Spec(val name: String, val url: String, val sha256: String, val file: String, val bytes: Long)

    companion object {
        const val VERSION = "2026.09.24"
        private const val HF = "https://huggingface.co"

        val SPECS: List<Spec> = listOf(
            Spec("rtdetr", "$HF/ogkalu/comic-text-and-bubble-detector/resolve/main/detector-v4-s_int8.onnx",
                "5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79", "rtdetr-v4-s_int8.onnx", 11_120_765),
            Spec("ctd", "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx",
                "1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f", "comictextdetector.onnx", 94_669_756),
            Spec("bubbleseg", "$HF/kitsumed/yolov8m_seg-speech-bubble/resolve/main/model_dynamic.onnx",
                "36c26bdefe150226acd9669772e9ff5a011fa0dd4622469b49d3d5e359f3251c", "yolov8m-seg-speech-bubble.onnx", 108_982_949),
            Spec("lama", "$HF/ogkalu/lama-manga-onnx-dynamic/resolve/main/lama-manga-dynamic.onnx",
                "de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9", "lama-manga-dynamic.onnx", 206_291_843),
            Spec("ppocr_en_rec", "$HF/ogkalu/ppocr-v5-onnx/resolve/main/en_PP-OCRv5_rec_mobile_infer.onnx",
                "c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8", "ppocrv5-en-rec.onnx", 7_872_351),
            Spec("ppocr_en_dict", "$HF/ogkalu/ppocr-v5-onnx/resolve/main/ppocrv5_en_dict.txt",
                "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6", "ppocrv5-en-dict.txt", 1_416),
        )
        val EXPECTED_BYTES: Long = SPECS.sumOf { it.bytes }

        fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }

    val dir: File = File(context.filesDir, "translation-models")
    private val versionFile = File(dir, "version")
    private val cancelled = AtomicBoolean(false)

    fun file(name: String): File = File(dir, SPECS.first { it.name == name }.file)

    fun isInstalled(): Boolean = SPECS.all { File(dir, it.file).let { f -> f.exists() && f.length() == it.bytes } }

    fun installedVersion(): String? = versionFile.takeIf { it.exists() }?.readText()?.trim()

    fun installedBytes(): Long = SPECS.sumOf { File(dir, it.file).takeIf { f -> f.exists() }?.length() ?: 0L }

    data class FileStatus(val name: String, val bytes: Long, val present: Boolean)

    fun files(): List<FileStatus> = SPECS.map { s ->
        val f = File(dir, s.file)
        FileStatus(s.file, s.bytes, f.exists() && f.length() == s.bytes)
    }

    fun cancel() = cancelled.set(true)

    /**
     * ينزّل ما ينقص ويتحقق. `onProgress(received, total, file)` على الخيط النادي.
     * ملف ببصمة مختلفة يُحذف ويُرمى خطأ: نموذج مبدَّل أسوأ من مفقود.
     */
    fun download(client: OkHttpClient, onProgress: (Long, Long, String) -> Unit) {
        cancelled.set(false)
        dir.mkdirs()
        val total = EXPECTED_BYTES
        var done = SPECS.filter { File(dir, it.file).let { f -> f.exists() && f.length() == it.bytes } }.sumOf { it.bytes }
        for (spec in SPECS) {
            val target = File(dir, spec.file)
            if (target.exists() && target.length() == spec.bytes) continue
            val tmp = File(dir, "${spec.file}.part")
            val digest = MessageDigest.getInstance("SHA-256")
            client.newCall(Request.Builder().url(spec.url).header("User-Agent", "vantara-android").build()).execute().use { res ->
                require(res.isSuccessful) { "download HTTP ${res.code} ← ${spec.file}" }
                var lastEmit = 0L
                tmp.outputStream().use { sink ->
                    res.body.byteStream().use { input ->
                        val buf = ByteArray(256 * 1024)
                        while (true) {
                            if (cancelled.get()) {
                                tmp.delete()
                                error("cancelled")
                            }
                            val n = input.read(buf)
                            if (n < 0) break
                            sink.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            done += n
                            val now = System.currentTimeMillis()
                            if (now - lastEmit > 300) {
                                lastEmit = now
                                onProgress(done, total, spec.file)
                            }
                        }
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != spec.sha256 || tmp.length() != spec.bytes) {
                tmp.delete()
                error("sha256 mismatch for ${spec.file}")
            }
            if (!tmp.renameTo(target)) {
                tmp.delete()
                error("cannot place ${spec.file}")
            }
            onProgress(done, total, spec.file)
        }
        versionFile.writeText(VERSION)
    }

    fun remove() {
        dir.listFiles()?.forEach { it.delete() }
        dir.delete()
    }

    /** يرمي إن غاب ملف: الخط لا يعمل بنصف نماذجه. */
    fun requireInstalled() {
        if (!isInstalled()) error("models_missing")
    }
}
