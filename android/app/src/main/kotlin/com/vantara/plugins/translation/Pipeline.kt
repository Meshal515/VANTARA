package com.vantara.plugins.translation

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Typeface
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.Base64

/**
 * الخط على الجهاز، مرحلتان يفصل بينهما نداء Luna من JavaScript:
 *
 *   analyze(page)  → كشف + حروف + فقاعات + OCR → مناطق بمعرّفات ثابتة (+ مصغّرة للسياق)
 *   render(page, {id → عربي}) → تخطيط → مسح آمن → رسم → ملف WebP
 *
 * النماذج تُحمَّل عند أول استعمال وتبقى في الذاكرة ما دام التطبيق حيًّا.
 * القاعدة الصلبة نفسها: بلا عربي لا مسح، وبلا مسح لا عربي؛ المؤثرات لا تُمس.
 */
class Pipeline(private val context: Context, private val store: ModelStore) {
    private var detector: Detector? = null
    private var glyphs: GlyphSegmenter? = null
    private var bubbles: BubbleSegmenter? = null
    private var inpainter: Inpainter? = null
    private var ocr: LatinOcr? = null
    private val typeface: Typeface by lazy { Typeface.createFromAsset(context.assets, "fonts/BalooBhaijaan2.ttf") }
    private val layout by lazy { ArabicLayout(typeface) }
    private val analyses = HashMap<String, Analysis>()

    class Analysis(val pageHash: String, val width: Int, val height: Int, val regions: List<Region>)

    @Synchronized
    private fun load() {
        store.requireInstalled()
        if (detector == null) detector = Detector(store.file("rtdetr"))
        if (glyphs == null) glyphs = GlyphSegmenter(store.file("ctd"))
        if (bubbles == null) bubbles = BubbleSegmenter(store.file("bubbleseg"))
        if (inpainter == null) inpainter = Inpainter(store.file("lama"))
        if (ocr == null) ocr = LatinOcr(store.file("ppocr_en_rec"), store.file("ppocr_en_dict"))
    }

    @Synchronized
    fun unload() {
        detector?.close(); glyphs?.close(); bubbles?.close(); inpainter?.close(); ocr?.close()
        detector = null; glyphs = null; bubbles = null; inpainter = null; ocr = null
        analyses.clear()
    }

    private fun decode(file: File): Pair<RgbImage, String> {
        val bytes = file.readBytes()
        val hash = ModelStore.sha256Hex(bytes)
        val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: error("not an image")
        val maxEdge = 4096
        if (maxOf(bmp.width, bmp.height) > maxEdge) {
            val s = maxEdge.toFloat() / maxOf(bmp.width, bmp.height)
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true)
        }
        return ArabicLayout.rgbOf(bmp) to hash
    }

    /** الهندسة وOCR. يحتفظ بالتحليل ليستعمله `render` لاحقًا بنفس المعرّفات. */
    @Synchronized
    fun analyze(file: File): Analysis {
        load()
        val (img, hash) = decode(file)
        val gray = img.gray()
        val dets = detector!!.detect(img)
        val prob = glyphs!!.probabilities(img)
        val glyphFull = ByteMask(img.width, img.height)
        for (i in prob.indices) if (prob[i] > 0.3f) glyphFull.data[i] = 1
        val bubbleList = bubbles!!.segment(img)
        val regions = Regions.assemble(img, gray, hash, dets, bubbleList, glyphFull)
        for (r in regions) {
            if (r.kind == "sfx") { r.status = "skipped:sfx"; continue }
            val res = ocr!!.read(img, r.glyph, r.box)
            r.ocr = res
            r.source = res.text
            if (res.text.isEmpty() || res.confidence < Regions.MIN_OCR_CONF) r.status = "skipped:unreadable"
        }
        val analysis = Analysis(hash, img.width, img.height, regions)
        analyses[hash] = analysis
        if (analyses.size > 12) analyses.remove(analyses.keys.first())
        return analysis
    }

    /** مصغّرة JPEG base64 للسياق عند Luna (عرض ≤ 1400). */
    fun thumbnail(file: File, maxWidth: Int = 1400): String {
        val bmp = BitmapFactory.decodeFile(file.absolutePath) ?: return ""
        val scaled = if (bmp.width > maxWidth) Bitmap.createScaledBitmap(bmp, maxWidth, bmp.height * maxWidth / bmp.width, true) else bmp
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 86, out)
        return Base64.getEncoder().encodeToString(out.toByteArray())
    }

    /**
     * التبييض والرسم. `arabicById`: ما ردّت به Luna (المعرّف → العربي). يرجع ملف WebP.
     * منطقة بلا عربي تبقى كما هي؛ عربي لا يدخل بحجم مقروء لا يُمسح أصله.
     */
    @Synchronized
    fun render(file: File, arabicById: Map<String, String>, outDir: File): Pair<File, Int> {
        load()
        val (img, hash) = decode(file)
        val analysis = analyses[hash] ?: analyze(file)
        val regions = analysis.regions
        val sibs = Regions.siblings(regions)
        for (r in regions) {
            val ar = arabicById[r.id]?.trim()
            if (r.status != "pending" && r.status != "translated") continue
            if (ar.isNullOrEmpty()) { r.status = "skipped:untranslated"; continue }
            r.arabic = ar
            r.status = "translated"
        }
        // ١. التخطيط أولًا: ما لا يدخل لا يُمسح
        for (r in regions) {
            if (r.status != "translated") continue
            val l = layout.layoutRegion(img, r, r.arabic!!, sibs[r.id])
            if (l == null) { r.status = "skipped:no_fit"; continue }
            r.layout = l
        }
        // ٢. المسح
        for (r in regions) if (r.status == "translated") Cleaner.planErase(img, r, sibs[r.id])
        val original = img.copy()
        Cleaner.applyErase(img, regions, inpainter!!)
        // ٣. الرسم
        val bmp = ArabicLayout.bitmapOf(img)
        val canvas = Canvas(bmp)
        for (r in regions) {
            if (r.status != "translated") continue
            layout.draw(canvas, r.layout!!, r.inkLight, r.bubble == null && r.bubbleBox == null)
        }
        // ٤. التحقق: لا بكسل خارج (قناع المسح ∪ حدود العربي) يتغير
        val allowed = ByteMask(img.width, img.height)
        for (r in regions) {
            if (r.status != "translated") continue
            r.eraseMask?.let { allowed.data.indices.forEach { i -> if (it.data[i].toInt() != 0) allowed.data[i] = 1 } }
            r.layout?.let { l -> val p = (l.size / 2).toInt(); allowed.fillRect(l.bounds.x1 - p, l.bounds.y1 - p, l.bounds.x2 + p, l.bounds.y2 + p) }
        }
        val final = ArabicLayout.rgbOf(bmp)
        for (i in allowed.data.indices) if (allowed.data[i].toInt() == 0) {
            final.data[i * 3] = original.data[i * 3]; final.data[i * 3 + 1] = original.data[i * 3 + 1]; final.data[i * 3 + 2] = original.data[i * 3 + 2]
        }
        val outBmp = ArabicLayout.bitmapOf(final)
        outDir.mkdirs()
        val out = File(outDir, "$hash.webp")
        out.outputStream().use { outBmp.compress(Bitmap.CompressFormat.WEBP, 90, it) }
        return out to regions.count { it.status == "translated" }
    }

    companion object {
        fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
