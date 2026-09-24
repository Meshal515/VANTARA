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

    /**
     * `legacy`: ملف أقدم يؤدي العمل نفسه بالناتج نفسه (اسمه وحجمه). يكفي إلى أن
     * يصل الجديد، فلا تتوقف الترجمة عند تحديث الملفات، ويُحذف بعد وصوله.
     */
    data class Legacy(val file: String, val bytes: Long, val sha256: String)

    data class Spec(val name: String, val url: String, val sha256: String, val file: String, val bytes: Long, val legacy: Legacy? = null)

    companion object {
        const val VERSION = "2026.09.25"
        private const val HF = "https://huggingface.co"

        val SPECS: List<Spec> = listOf(
            Spec("rtdetr", "$HF/ogkalu/comic-text-and-bubble-detector/resolve/main/detector-v4-s_int8.onnx",
                "5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79", "rtdetr-v4-s_int8.onnx", 11_120_765),
            // comic-text-detector برأس قناع الحروف وحده (tools/ctd_seg_only.py، سير «ملفات الترجمة»):
            // نفس العقد والأوزان، خرج seg مطابق بتًّا بتًّا، وأسرع ~40% لأن رأسي blk/det لا يُحسبان
            Spec("ctd", "https://github.com/Meshal515/VANTARA/releases/download/models-ctd-seg-1/comictextdetector-seg.onnx",
                "143f5aedd9d2f1362449852bf5d58718836ff16b87f3681b52ebd0bc7c8464d4", "comictextdetector-seg.onnx", 65_568_440,
                legacy = Legacy("comictextdetector.onnx", 94_669_756, "1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f")),
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

    // ── التحقق: البصمة لا الحجم ──
    // كل ملف يُحسب sha256 له مرة، ويُحفظ «تحقّقتُ منه» مع حجمه ووقت تعديله في `verified`.
    // ملف تغيّر بعدها (حجمًا أو وقتًا) يُعاد التحقق منه؛ وبصمة مختلفة = غير مثبّت.
    private val verifiedFile = File(dir, "verified")
    private val verified = HashMap<String, String>() // اسم الملف → "حجم:وقت:بصمة"
    private var verifiedLoaded = false

    @Synchronized
    private fun loadVerified() {
        if (verifiedLoaded) return
        verifiedLoaded = true
        verifiedFile.takeIf { it.exists() }?.readLines()?.forEach { line ->
            val parts = line.split(" ")
            if (parts.size == 2) verified[parts[0]] = parts[1]
        }
    }

    @Synchronized
    private fun saveVerified() {
        dir.mkdirs()
        verifiedFile.writeText(verified.entries.joinToString("\n") { "${it.key} ${it.value}" })
    }

    private fun stamp(f: File) = "${f.length()}:${f.lastModified()}"

    /** بصمة الملف مطابقة؟ (تُحسب مرة لكل نسخة من الملف.) `hashNow=false`: لا حساب، المعروف فقط. */
    @Synchronized
    private fun matches(f: File, bytes: Long, sha: String, hashNow: Boolean): Boolean {
        if (!f.exists() || f.length() != bytes) return false
        loadVerified()
        val known = verified[f.name]
        if (known != null && known.startsWith(stamp(f) + ":")) return known.endsWith(":$sha")
        if (!hashNow) return false
        val actual = sha256File(f)
        verified[f.name] = "${stamp(f)}:$actual"
        saveVerified()
        return actual == sha
    }

    private fun sha256File(f: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(1024 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun present(spec: Spec, hashNow: Boolean = false): Boolean = matches(File(dir, spec.file), spec.bytes, spec.sha256, hashNow)

    private fun legacyFile(spec: Spec, hashNow: Boolean = false): File? =
        spec.legacy?.let { l -> File(dir, l.file).takeIf { matches(it, l.bytes, l.sha256, hashNow) } }

    /** ملف بالحجم الصحيح لم تُحسب بصمته بعد (نزل قبل هذا التحقق). */
    private fun unchecked(spec: Spec): Boolean {
        val f = File(dir, spec.file)
        return f.exists() && f.length() == spec.bytes && !present(spec) ||
            spec.legacy?.let { l -> File(dir, l.file).let { it.exists() && it.length() == l.bytes && legacyFile(spec) == null } } == true
    }

    /** الملف الحالي، أو الأقدم المكافئ له إن لم يصل الجديد بعد. */
    fun file(name: String): File {
        val spec = SPECS.first { it.name == name }
        if (present(spec)) return File(dir, spec.file)
        return legacyFile(spec) ?: File(dir, spec.file)
    }

    /** المعروف فقط (سريع، لا يحسب بصمات): للإعدادات. ما لم يُتحقق منه بعد يُحسب مثبّتًا حتى يُفحص. */
    fun isInstalled(): Boolean = SPECS.all { present(it) || legacyFile(it) != null || unchecked(it) }

    fun installedVersion(): String? = versionFile.takeIf { it.exists() }?.readText()?.trim()

    fun installedBytes(): Long = SPECS.sumOf { s ->
        (File(dir, s.file).takeIf { f -> f.exists() }?.length() ?: 0L) + (s.legacy?.let { File(dir, it.file).takeIf { f -> f.exists() }?.length() } ?: 0L)
    }

    data class FileStatus(val name: String, val bytes: Long, val present: Boolean)

    fun files(): List<FileStatus> = SPECS.map { s ->
        val f = File(dir, s.file)
        FileStatus(s.file, s.bytes, f.exists() && f.length() == s.bytes)
    }

    /**
     * قبل أي استعمال: كل ملف ببصمته الصحيحة (يُحسب مرة لكل ملف جديد). ملف تالف
     * أو مبدَّل يُحذف فيطلب التطبيق تنزيله من جديد.
     */
    @Synchronized
    fun verifyAll(): Boolean {
        var ok = true
        for (spec in SPECS) {
            if (present(spec, hashNow = true) || legacyFile(spec, hashNow = true) != null) continue
            File(dir, spec.file).takeIf { it.exists() }?.delete()
            spec.legacy?.let { File(dir, it.file).takeIf { f -> f.exists() }?.delete() }
            ok = false
        }
        return ok
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
        // الموجود يُتحقق ببصمته قبل تخطّيه: ملف بالحجم نفسه ومحتوى مختلف يُنزَّل من جديد
        var done = SPECS.filter { present(it, hashNow = true) }.sumOf { it.bytes }
        for (spec in SPECS) {
            val target = File(dir, spec.file)
            if (present(spec, hashNow = true)) continue
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
            synchronized(this) {
                loadVerified()
                verified[target.name] = "${stamp(target)}:$actual"
                saveVerified()
            }
            // وصل الجديد: الأقدم المكافئ لم يعد لازمًا
            spec.legacy?.let { File(dir, it.file).delete() }
            onProgress(done, total, spec.file)
        }
        versionFile.writeText(VERSION)
    }

    fun remove() {
        dir.listFiles()?.forEach { it.delete() }
        dir.delete()
        synchronized(this) { verified.clear() }
    }

    /**
     * يرمي إن غاب ملف أو اختلفت بصمته: الخط لا يعمل بنصف نماذجه ولا بنموذج مبدَّل.
     * البصمة تُحسب مرة لكل ملف (ثم تُحفظ)، فلا كلفة بعد أول صفحة.
     */
    fun requireInstalled() {
        if (!verifyAll()) error("models_missing")
    }
}
