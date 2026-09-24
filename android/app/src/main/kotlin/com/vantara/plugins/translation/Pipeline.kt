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
 *   analyze(page)  → كشف + حروف + فقاعات + OCR → مناطق بمعرّفات ثابتة
 *   render(page, {id → عربي}) → تخطيط → مسح آمن → رسم → ملف WebP
 *
 * لا عمل مكرر:
 *   - الصفحة تُفك مرة (ذاكرة آخر ثلاث صور)، والمصغّرة لـLuna من البكسلات نفسها،
 *     ولا مصغّرة أصلًا لصفحة لا شيء فيها يُسأل عنه.
 *   - التحليل يُحفظ مضغوطًا (الأقنعة بمستطيلاتها)، فالرسم وإكمال الفقاعات
 *     الناقصة لا يعيدان الكشف وOCR. وكل رسم يأخذ مناطق جديدة منه: حالة رسمٍ
 *     سابق (فقاعة بقيت بلا عربي) لا تمنع رسمها حين يصل عربيّها.
 *   - النماذج تُحمَّل حين تلزم: الكاشف أولًا؛ الحروف والفقاعات وOCR إن وُجد نص؛
 *     LaMa إن احتاجته فقاعة. وتبقى في الذاكرة ما دام التطبيق حيًّا.
 *
 * كل مرحلة تُقاس (`Perf`) وتعود مع النتيجة. القاعدة الصلبة نفسها: بلا عربي لا
 * مسح، وبلا مسح لا عربي؛ المؤثرات لا تُمس.
 */
class Pipeline(private val context: Context, private val store: ModelStore) {
    private var detector: Detector? = null
    private var glyphs: GlyphSegmenter? = null
    private var bubbles: BubbleSegmenter? = null
    private var inpainter: Inpainter? = null
    private var ocr: LatinOcr? = null
    private val typeface: Typeface by lazy { Typeface.createFromAsset(context.assets, "fonts/BalooBhaijaan2.ttf") }
    private val layout by lazy { ArabicLayout(typeface) }
    private val analyses = lru<Analysis>(24)
    private val images = lru<Decoded>(3)
    private val detections = lru<List<Detection>>(12)

    /** منطقة كما خرجت من التحليل، والأقنعة مضغوطة. */
    class Snapshot(
        val id: String,
        val box: Box,
        val score: Float,
        val kind: String,
        val bubble: Int, // فهرس في `Analysis.bubbles`، أو -1
        val bubbleBox: Box?,
        val glyph: PackedMask,
        val glyphPixels: Int,
        val inkLight: Boolean,
        val ocr: OcrResult?,
        val source: String,
        val status: String,
    )

    class BubbleSnapshot(val box: Box, val score: Float, val mask: PackedMask)

    class Analysis(val pageHash: String, val width: Int, val height: Int, val regions: List<Snapshot>, val bubbles: List<BubbleSnapshot>)

    /** الصورة مفكوكة. `exact`: بكسلاتها هي بكسلات الملف (لم تُصغَّر ولا شفافية). */
    private class Decoded(val img: RgbImage, val exact: Boolean)

    private fun <T> lru(max: Int) = object : LinkedHashMap<String, T>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, T>?) = size > max
    }

    // ── النماذج، كلٌّ حين يلزم ──

    private inline fun <T> load(perf: Perf, name: String, make: () -> T): T {
        val t = System.nanoTime()
        val m = make()
        perf.add("load", System.nanoTime() - t)
        perf.count("load:$name")
        return m
    }

    private fun detector(perf: Perf) = detector ?: load(perf, "rtdetr") { Detector(store.file("rtdetr")) }.also { detector = it }
    private fun glyphs(perf: Perf) = glyphs ?: load(perf, "ctd") { GlyphSegmenter(store.file("ctd")) }.also { glyphs = it }
    private fun bubbles(perf: Perf) = bubbles ?: load(perf, "bubbleseg") { BubbleSegmenter(store.file("bubbleseg")) }.also { bubbles = it }
    private val lamaLock = Any()
    private fun inpainter(perf: Perf) = synchronized(lamaLock) { inpainter ?: load(perf, "lama") { Inpainter(store.file("lama")) }.also { inpainter = it } }
    private fun ocr(perf: Perf) = ocr ?: load(perf, "ppocr") { LatinOcr(store.file("ppocr_en_rec"), store.file("ppocr_en_dict")) }.also { ocr = it }

    /** ملف قناع الحروف المستعمل: `seg` (الرأس وحده) أو `full` (الأصل، إلى أن يصل تحديث الملفات). */
    fun ctdVariant(): String = if (store.file("ctd").name.contains("-seg")) "seg" else "full"

    @Synchronized
    fun unload() {
        detector?.close(); glyphs?.close(); bubbles?.close(); ocr?.close()
        synchronized(lamaLock) { inpainter?.close(); inpainter = null }
        detector = null; glyphs = null; bubbles = null; ocr = null
        detections.clear()
        analyses.clear()
        images.clear()
    }

    // ── الصورة: قراءة وبصمة ثم فكّ مرة ──

    private fun read(file: File, perf: Perf): Pair<ByteArray, String> {
        val bytes = perf.time("read") { file.readBytes() }
        val hash = perf.time("hash") { ModelStore.sha256Hex(bytes) }
        return bytes to hash
    }

    private fun decode(bytes: ByteArray, perf: Perf): Decoded = perf.time("decode") {
        val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: error("not an image")
        val opaque = !bmp.hasAlpha()
        val maxEdge = 4096
        var scaled = false
        if (maxOf(bmp.width, bmp.height) > maxEdge) {
            val s = maxEdge.toFloat() / maxOf(bmp.width, bmp.height)
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true)
            scaled = true
        }
        Decoded(ArabicLayout.rgbOf(bmp), opaque && !scaled)
    }

    private fun image(bytes: ByteArray, hash: String, perf: Perf, useCache: Boolean): Decoded {
        if (useCache) images[hash]?.let { perf.count("imageReused"); return it }
        val d = decode(bytes, perf)
        if (useCache) images[hash] = d
        return d
    }

    // ── التحليل ──

    /** الهندسة وOCR. يُحفظ التحليل ليستعمله `render` وأي إكمال لاحق بنفس المعرّفات. */
    @Synchronized
    fun analyze(file: File, perf: Perf = Perf()): Analysis = analyzeImpl(file, perf, useCache = true)

    /** نموذج التبييض يُحمَّل مسبقًا (أثناء انتظار Luna) خارج قفل الصفحات: لا يوقف أحدًا. */
    fun warmInpainter(perf: Perf) {
        if (store.isInstalled()) inpainter(perf)
    }

    fun inpainterReady(): Boolean = synchronized(lamaLock) { inpainter != null }

    private fun analyzeImpl(file: File, perf: Perf, useCache: Boolean): Analysis {
        store.requireInstalled()
        val (bytes, hash) = read(file, perf)
        if (useCache) analyses[hash]?.let { perf.count("analysisReused"); return it }
        val img = image(bytes, hash, perf, useCache).img
        val dets = detect(img, perf)
        textless(hash, img, dets, perf, useCache)?.let { return it }
        return finish(hash, img, dets, perf, useCache)
    }

    private fun detect(img: RgbImage, perf: Perf): List<Detection> {
        val det = detector(perf)
        val dets = perf.time("detect") { det.detect(img) }
        perf.count("detectTiles", det.tiles)
        return dets
    }

    /**
     * بوابة «هل في الصفحة نص؟»: كل منطقة تبدأ من صندوق نص بثقة ≥ MIN_SCORE، فبلا صندوق
     * كهذا لا منطقة مهما قالت بقية النماذج. صفحة بلا نص تتخطى الحروف والفقاعات وOCR
     * وتحميل نماذجها، والنتيجة نفسها تمامًا (لا تخمين: أي صندوق نص يكمل المعالجة).
     */
    private fun textless(hash: String, img: RgbImage, dets: List<Detection>, perf: Perf, useCache: Boolean): Analysis? {
        if (dets.any { it.label.startsWith("text") && it.score >= Regions.MIN_SCORE }) return null
        perf.count("textless")
        return Analysis(hash, img.width, img.height, emptyList(), emptyList()).also { if (useCache) analyses[hash] = it }
    }

    /** المرحلة الخفيفة وحدها (قراءة، فك، كشف): صفحة بلا نص تنتهي هنا. */
    @Synchronized
    fun detectStage(file: File, perf: Perf): Analysis? {
        store.requireInstalled()
        val (bytes, hash) = read(file, perf)
        analyses[hash]?.let { perf.count("analysisReused"); return it }
        val img = image(bytes, hash, perf, true).img
        val dets = detect(img, perf)
        textless(hash, img, dets, perf, true)?.let { return it }
        detections[hash] = dets
        return null
    }

    /** المرحلة الثقيلة بعد [detectStage] (الحروف، الفقاعات، OCR) ومصغّرة Luna بالقفل نفسه. */
    @Synchronized
    fun finishForLuna(file: File, perf: Perf): Pair<Analysis, String> {
        val (bytes, hash) = read(file, perf)
        val a = analyses[hash] ?: run {
            val img = image(bytes, hash, perf, true).img
            val dets = detections.remove(hash) ?: detect(img, perf)
            textless(hash, img, dets, perf, true) ?: finish(hash, img, dets, perf, true)
        }
        val asks = a.regions.any { it.status == "pending" && it.source.isNotEmpty() }
        return a to (if (asks) perf.time("thumbnail") { thumbnail(file, a.pageHash) } else "")
    }

    private fun finish(hash: String, img: RgbImage, dets: List<Detection>, perf: Perf, useCache: Boolean): Analysis {
        val gray = perf.time("gray") { img.gray() }
        // القطع التي فيها نص وحدها: الحروف حول كل صندوق (بهامش المناطق)، والفقاعات بعرض
        // الصفحة فوق الصندوق وتحته (فقاعة تحيط بالنص كاملة مع ما ينافسها في الدمج)
        val texts = dets.filter { it.label.startsWith("text") }
        val glyphRows = texts.map { (it.box.y1 - Regions.GLYPH_MARGIN)..(it.box.y2 + Regions.GLYPH_MARGIN) }
        val bubbleRows = texts.map { (it.box.y1 - img.width)..(it.box.y2 + img.width) }
        val gs = glyphs(perf)
        val prob = perf.time("glyphs") { gs.probabilities(img, glyphRows) }
        perf.count("glyphTiles", gs.tiles)
        val glyphFull = perf.time("glyphMask") {
            val m = ByteMask(img.width, img.height)
            for (i in prob.indices) if (prob[i] > 0.3f) m.data[i] = 1
            m
        }
        val bs = bubbles(perf)
        val bubbleList = perf.time("bubbles") { bs.segment(img, bubbleRows) }
        perf.count("bubbleTiles", bs.tiles)
        perf.count("bubbles", bubbleList.size)
        val regions = perf.time("regions") { Regions.assemble(img, gray, hash, dets, bubbleList, glyphFull) }
        perf.count("regions", regions.size)
        // كل منطقة تُقرأ، ومنها «نص حر بثقة منخفضة» (تلميح sfx): قد يكون سردًا فوق الرسم،
        // وLuna ترى الصفحة وتقرر؛ المؤثر الحقيقي يعود منها sfx فلا يُرسم
        val reader = if (regions.isNotEmpty()) ocr(perf) else null
        perf.time("ocr") {
            for (r in regions) {
                val res = reader!!.read(img, r.glyph, r.box)
                perf.count("ocrLines", res.lines.size)
                r.ocr = res
                r.source = res.text
                if (res.text.isEmpty() || res.confidence < Regions.MIN_OCR_CONF) r.status = "skipped:unreadable"
            }
        }
        val analysis = perf.time("pack") { freeze(hash, img.width, img.height, regions) }
        if (useCache) analyses[hash] = analysis
        return analysis
    }

    private fun freeze(hash: String, width: Int, height: Int, regions: List<Region>): Analysis {
        // فقاعة واحدة قد تحمل منطقتين: تُحفظ مرة وتبقى مشتركة (siblings تعتمد هويتها)
        val seen = ArrayList<Bubble>()
        val packed = ArrayList<BubbleSnapshot>()
        val snaps = regions.map { r ->
            val bi = r.bubble?.let { b ->
                val i = seen.indexOfFirst { it === b }
                if (i >= 0) i else {
                    seen.add(b)
                    packed.add(BubbleSnapshot(b.box, b.score, PackedMask.of(b.mask)))
                    seen.size - 1
                }
            } ?: -1
            Snapshot(r.id, r.box, r.score, r.kind, bi, r.bubbleBox, PackedMask.of(r.glyph), r.glyphPixels, r.inkLight, r.ocr, r.source, r.status)
        }
        return Analysis(hash, width, height, snaps, packed)
    }

    /** مناطق جديدة من التحليل المحفوظ، بحالتها كما خرجت من التحليل. */
    private fun thaw(a: Analysis): List<Region> {
        val bs = a.bubbles.map { Bubble(it.box, it.score, it.mask.unpack()) }
        return a.regions.map { s ->
            Region(s.id, s.box, s.score, s.kind, if (s.bubble >= 0) bs[s.bubble] else null, s.bubbleBox, s.glyph.unpack(), s.glyphPixels, s.inkLight).also {
                it.ocr = s.ocr
                it.source = s.source
                it.status = s.status
            }
        }
    }

    /**
     * مصغّرة JPEG base64 للسياق عند Luna (عرض ≤ 1400). من البكسلات المفكوكة إن
     * كانت هي بكسلات الملف نفسها، وإلا من الملف كما كانت.
     */
    fun thumbnail(file: File, pageHash: String?, maxWidth: Int = 1400): String {
        val cached = pageHash?.let { synchronized(this) { images[it] } }?.takeIf { it.exact }
        val bmp = if (cached != null) ArabicLayout.bitmapOf(cached.img) else BitmapFactory.decodeFile(file.absolutePath) ?: return ""
        val scaled = if (bmp.width > maxWidth) Bitmap.createScaledBitmap(bmp, maxWidth, bmp.height * maxWidth / bmp.width, true) else bmp
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 86, out)
        return Base64.getEncoder().encodeToString(out.toByteArray())
    }

    // ── الرسم ──

    /**
     * التبييض والرسم. `arabicById`: ما ردّت به Luna (المعرّف → العربي). يرجع ملف WebP.
     * منطقة بلا عربي تبقى كما هي؛ عربي لا يدخل بحجم مقروء لا يُمسح أصله.
     */
    @Synchronized
    fun render(file: File, arabicById: Map<String, String>, outDir: File, perf: Perf = Perf(), leave: Set<String> = emptySet()): Pair<File, Int> {
        val (encoded, hash, translated) = renderImpl(file, arabicById, perf, useCache = true, leave)
        val out = perf.time("write") { publish(outDir, hash, encoded) }
        return out to translated
    }

    /**
     * نشر الصورة المترجمة: اسم جديد لكل محتوى (`<بصمة الصفحة>-<بصمة الناتج>.webp`)
     * فالقارئ يرى الإكمال فورًا (الرابط تغيّر) ولا يُكتب فوق ملف معروض. والكتابة
     * ذرّية: ملف مؤقت يُكتب ويُزامَن ثم يُعاد تسميته؛ انقطاع في المنتصف لا يترك
     * ملفًا نهائيًّا ناقصًا أبدًا. النسخ الأقدم للصفحة نفسها تُحذف بعده.
     */
    private fun publish(outDir: File, hash: String, encoded: ByteArray): File {
        outDir.mkdirs()
        val name = "$hash-${ModelStore.sha256Hex(encoded).substring(0, 12)}.webp"
        val out = File(outDir, name)
        if (!(out.exists() && out.length() == encoded.size.toLong())) {
            val tmp = File(outDir, "$name.part")
            java.io.FileOutputStream(tmp).use { s ->
                s.write(encoded)
                s.fd.sync()
            }
            if (!tmp.renameTo(out)) {
                tmp.delete()
                error("cannot publish translated page")
            }
        }
        outDir.listFiles()?.forEach { f ->
            if (f.name != name && f.name.startsWith(hash) && (f.name.endsWith(".webp") || f.name.endsWith(".part"))) f.delete()
        }
        return out
    }

    /** يرجع (WebP، بصمة الصفحة، عدد المرسوم). */
    private fun renderImpl(file: File, arabicById: Map<String, String>, perf: Perf, useCache: Boolean, leave: Set<String> = emptySet()): Triple<ByteArray, String, Int> {
        store.requireInstalled()
        val (bytes, hash) = read(file, perf)
        val analysis = (if (useCache) analyses[hash] else null) ?: analyzeImpl(file, perf, useCache)
        val regions = perf.time("unpack") { thaw(analysis) }
        // الصورة المحفوظة تبقى نظيفة: المسح على نسخة
        val img = image(bytes, hash, perf, useCache).img.let { src -> perf.time("copy") { src.copy() } }
        val sibs = Regions.siblings(regions)
        for (r in regions) {
            val ar = arabicById[r.id]?.trim()
            if (r.status != "pending" && r.status != "translated") continue
            if (ar.isNullOrEmpty()) { r.status = "skipped:untranslated"; continue }
            r.arabic = ar
            r.status = "translated"
        }
        // ١. التخطيط أولًا: ما لا يدخل لا يُمسح
        perf.time("layout") {
            for (r in regions) {
                if (r.status != "translated") continue
                val l = layout.layoutRegion(img, r, r.arabic!!, sibs[r.id])
                if (l == null) { r.status = "skipped:no_fit"; perf.count("noFit"); continue }
                r.layout = l
            }
        }
        // ١ب. الفقاعة كلها أو لا شيء: جملة فيها بلا عربي (أو لم تدخل) تُبقي الفقاعة كلها
        // على أصلها — لا عربي فوق فقاعة وبجانبه إنجليزي. الإكمال يأتي بالناقص لاحقًا.
        // ما قالت Luna إنه مؤثر أو حقوق أو لافتة (`leave`) ليس نقصًا
        keepWholeBubbles(regions, sibs, leave, perf)
        // ٢. المسح
        perf.time("plan") { for (r in regions) if (r.status == "translated") Cleaner.planErase(img, r, sibs[r.id]) }
        val original = perf.time("copy") { img.copy() }
        val lama = if (Cleaner.needsInpaint(regions)) inpainter(perf) else null
        perf.count("fill", regions.count { it.status == "translated" && it.cleanMode == "fill" })
        perf.count("inpaint", regions.count { it.status == "translated" && it.cleanMode != "fill" && it.eraseMask?.any() == true })
        perf.time("erase") { Cleaner.applyErase(img, regions, lama) }
        // ٣. الرسم: بلون الحبر الأصلي، إلا إن كان سيختفي في خلفيته بعد المسح
        val bmp = perf.time("draw") {
            val b = ArabicLayout.bitmapOf(img)
            val canvas = Canvas(b)
            for (r in regions) {
                if (r.status != "translated") continue
                val l = r.layout!!
                val light = Visibility.inkLight(img, l, r.inkLight)
                if (light != r.inkLight) perf.count("inkFlipped")
                layout.draw(canvas, l, light, r.bubble == null && r.bubbleBox == null)
            }
            b
        }
        // ٣ب. لا مسح بلا عربي ظاهر: منطقة لم يظهر عربيّها فعلًا (خط بلا حروف، لون مطابق)
        // تعود لأصلها بالكامل بدل فقاعة مبيّضة فارغة
        val drawn = perf.time("visible") { ArabicLayout.rgbOf(bmp) }
        perf.time("visible") {
            for (r in regions) {
                if (r.status != "translated") continue
                if (!Visibility.textShows(img, drawn, r.layout!!)) {
                    r.status = "skipped:invisible"
                    perf.count("invisible")
                }
            }
            // وشقيقاتها في الفقاعة نفسها تعود لأصلها معها
            keepWholeBubbles(regions, sibs, leave, perf)
        }
        // ٤. التحقق: لا بكسل خارج (قناع المسح ∪ حدود العربي) يتغير
        val final = perf.time("verify") {
            val allowed = ByteMask(img.width, img.height)
            for (r in regions) {
                if (r.status != "translated") continue
                r.eraseMask?.let { m ->
                    val w = m.scanWindow()
                    if (w != null) for (y in w[1] until w[3]) for (x in w[0] until w[2]) {
                        val i = y * img.width + x
                        if (m.data[i].toInt() != 0) allowed.data[i] = 1
                    }
                }
                r.layout?.let { l -> val p = (l.size / 2).toInt(); allowed.fillRect(l.bounds.x1 - p, l.bounds.y1 - p, l.bounds.x2 + p, l.bounds.y2 + p) }
            }
            val f = drawn
            for (i in allowed.data.indices) if (allowed.data[i].toInt() == 0) {
                f.data[i * 3] = original.data[i * 3]; f.data[i * 3 + 1] = original.data[i * 3 + 1]; f.data[i * 3 + 2] = original.data[i * 3 + 2]
            }
            f
        }
        // بلا فقد: ما خارج المسح والعربي يبقى بكسلات الأصل نفسها في الملف المحفوظ
        val encoded = perf.time("encode") {
            val out = ByteArrayOutputStream()
            val format = if (android.os.Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSLESS else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
            // WEBP_LOSSLESS: الرقم جهد الضغط (أسرع بحجم أكبر قليلًا)؛ WEBP القديم: 100 = بلا فقد
            ArabicLayout.bitmapOf(final).compress(format, if (android.os.Build.VERSION.SDK_INT >= 30) 10 else 100, out)
            out.toByteArray()
        }
        val translated = regions.count { it.status == "translated" }
        perf.count("translated", translated)
        lastPixels = final.data
        return Triple(encoded, hash, translated)
    }

    /** منطقة مقروءة بقيت بلا عربي ظاهر في فقاعة فيها عربي: الفقاعة كلها تبقى أصلها. */
    private fun keepWholeBubbles(regions: List<Region>, sibs: Map<String, List<Region>>, leave: Set<String>, perf: Perf) {
        val missing = setOf("skipped:untranslated", "skipped:no_fit", "skipped:invisible")
        for (r in regions) {
            if (r.status != "translated") continue
            val gap = sibs[r.id]?.any { it.status in missing && it.id !in leave } == true
            if (gap) {
                r.status = "skipped:sibling"
                perf.count("bubbleKept")
            }
        }
    }

    /** بكسلات آخر صفحة رُسمت (لمقارنة القديم بالجديد وحدها). */
    private var lastPixels: ByteArray? = null

    // ── القديم مقابل الجديد، على الجوال نفسه ──

    class Benchmark(val legacy: Perf, val current: Perf, val identical: Boolean)

    class EngineResult(val name: String, val loadMs: Long, val glyphsMs: Long, val bubblesMs: Long, val glyphDiff: Int, val glyphPixels: Int, val bubblesSame: Boolean, val bubbles: Int)

    /**
     * قناع الحروف والفقاعات على صفحة واحدة بكل إعداد للمحرك: زمن كلٍّ منهما، وكم بكسلًا
     * يختلف قناع الحروف عن الإعداد الحالي، وهل الفقاعات هي نفسها. الحالي أولًا وآخرًا
     * (يكشف تسخّن الجوال أثناء القياس). الإعدادات الأخرى تُفتح وتُغلق هنا.
     */
    @Synchronized
    fun engineBenchmark(file: File): List<EngineResult> {
        store.requireInstalled()
        val (bytes, hash) = read(file, Perf())
        val img = image(bytes, hash, Perf(), false).img
        val texts = detect(img, Perf()).filter { it.label.startsWith("text") }
        val glyphRows = texts.map { (it.box.y1 - Regions.GLYPH_MARGIN)..(it.box.y2 + Regions.GLYPH_MARGIN) }
        val bubbleRows = texts.map { (it.box.y1 - img.width)..(it.box.y2 + img.width) }
        val cores = Runtime.getRuntime().availableProcessors()
        val wide = maxOf(4, minOf(6, cores - 2))
        val engines = listOf(
            Ort.CURRENT,
            Ort.Engine("split", 1, 4, spin = false),
            Ort.Engine("split-$wide", 1, wide, spin = false),
            Ort.Engine("cpu-4", 4, 0, spin = false),
            Ort.Engine("cpu-$wide", wide, 0, spin = false),
            Ort.CURRENT.copy(name = "current-again"),
        )
        var baseMask: ByteArray? = null
        var baseBubbles: List<Bubble>? = null
        val out = ArrayList<EngineResult>()
        for (e in engines) {
            val t0 = System.nanoTime()
            val gs = GlyphSegmenter(store.file("ctd"), e)
            val bs = BubbleSegmenter(store.file("bubbleseg"), e)
            val t1 = System.nanoTime()
            try {
                val prob = gs.probabilities(img, glyphRows)
                val t2 = System.nanoTime()
                val bl = bs.segment(img, bubbleRows)
                val t3 = System.nanoTime()
                val mask = ByteArray(prob.size) { if (prob[it] > 0.3f) 1 else 0 }
                val ref = baseMask ?: mask.also { baseMask = it }
                val refB = baseBubbles ?: bl.also { baseBubbles = it }
                var diff = 0
                for (i in mask.indices) if (mask[i] != ref[i]) diff++
                val same = bl.size == refB.size && bl.zip(refB).all { (a, b) -> a.box == b.box && a.mask.data.contentEquals(b.mask.data) }
                out.add(EngineResult(e.name, (t1 - t0) / 1_000_000, (t2 - t1) / 1_000_000, (t3 - t2) / 1_000_000, diff, mask.count { it.toInt() != 0 }, same, bl.size))
            } finally {
                gs.close(); bs.close()
            }
        }
        return out
    }

    /**
     * يعالج الصفحة نفسها مرتين من الصفر، بلا أي ذاكرة محفوظة: بالطريق القديم
     * (أقنعة على الصفحة كلها، فكّ الصورة لكل مرحلة، مصغّرة دائمًا) ثم الجديد،
     * ويقارن بكسلات الناتج. النماذج نفسها في الحالتين (محمّلة مسبقًا).
     */
    @Synchronized
    fun benchmark(file: File, arabicById: Map<String, String>): Benchmark {
        val warm = Perf()
        detector(warm); glyphs(warm); bubbles(warm); ocr(warm); inpainter(warm)
        val before = ByteMask.windowed
        try {
            val legacy = Perf()
            ByteMask.windowed = false
            analyzeImpl(file, legacy, useCache = false)
            legacy.time("thumbnail") { thumbnail(file, null) }
            renderImpl(file, arabicById, legacy, useCache = false)
            val a = lastPixels
            val current = Perf()
            ByteMask.windowed = true
            val analysis = analyzeImpl(file, current, useCache = false)
            if (analysis.regions.any { it.status == "pending" && it.source.isNotEmpty() }) {
                current.time("thumbnail") { thumbnail(file, null) }
            }
            renderImpl(file, arabicById, current, useCache = false)
            val b = lastPixels
            return Benchmark(legacy, current, a != null && b != null && a.contentEquals(b))
        } finally {
            ByteMask.windowed = before
            lastPixels = null
        }
    }

    companion object {
        fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
