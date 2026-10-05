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
private const val OUT_CAP = 2_500L * 1024 * 1024
private const val OUT_KEEP = 2_000L * 1024 * 1024
private const val THUMB_PIXELS = 3_200_000.0
/** أطول ضلع للتحليل (النماذج والأقنعة). الرسم النهائي بمقاس الملف دائمًا. */
private const val MAX_EDGE = 4096

class Pipeline(private val context: Context, private val store: ModelStore, private val ocrWork:InferenceWork=InferenceWork.HEAVY, private val renderOnly:Boolean=false) {
    private val fonts = FontCatalog(context.assets)
    private var detector: Detector? = null
    private var glyphs: GlyphSegmenter? = null
    private var bubbles: BubbleSegmenter? = null
    private var inpainter: Inpainter? = null
    private var ocr: LatinOcr? = null
    private val typeface: Typeface by lazy { Typeface.createFromAsset(context.assets, "fonts/BalooBhaijaan2.ttf") }
    private val layout by lazy { ArabicLayout(typeface) }
    private val analyses = lru<Analysis>(24)
    private val images = PixelCache<Decoded>(2,16L*1024*1024) {it.img.data.size.toLong()}
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

    class Analysis(val pageHash: String, val width: Int, val height: Int, val regions: List<Snapshot>, val bubbles: List<BubbleSnapshot>, val rescue:List<Box> = emptyList(),val revision:Int=0)

    /** صورة بعد التبييض وقبل العربي، من المحرك المحلي نفسه. */
    class CleaningProbe(
        val file: File,
        val width: Int,
        val height: Int,
        val fullWidth: Int,
        val fullHeight: Int,
        val cleanedRegions: Int,
    )

    /**
     * الصورة مفكوكة. `exact`: بكسلاتها هي بكسلات الملف (لم تُصغَّر ولا شفافية).
     * `fullW`/`fullH`: مقاس الملف نفسه؛ صفحة أطول من [MAX_EDGE] تُحلَّل مصغّرة وتُرسم بمقاسها.
     */
    private class Decoded(val img: RgbImage, val exact: Boolean, val fullW: Int, val fullH: Int)

    private fun <T> lru(max: Int) = object : LinkedHashMap<String, T>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, T>?) = size > max
    }

    // ── النماذج، كلٌّ حين يلزم ──

    private inline fun <T> load(perf: Perf, name: String, make: () -> T): T {
        val t = System.nanoTime()
        try {
            return make()
        } finally {
            val elapsed = System.nanoTime() - t
            perf.add("load", elapsed)
            perf.add("load:$name", elapsed)
            perf.count("load:$name")
        }
    }

    private fun detector(perf: Perf) = detector ?: load(perf, "rtdetr") { Detector(store.file("rtdetr")) }.also { detector = it }
    private fun glyphs(perf: Perf) = glyphs ?: load(perf, "ctd") { GlyphSegmenter(store.file("ctd")) }.also { glyphs = it }
    private fun bubbles(perf: Perf) = bubbles ?: load(perf, "bubbleseg") { BubbleSegmenter(store.file("bubbleseg")) }.also { bubbles = it }
    private val lamaLock = Any()
    private fun inpainter(perf: Perf): Inpainter {
        val waiting = System.nanoTime()
        return synchronized(lamaLock) {
            perf.add("lamaLockWait", System.nanoTime() - waiting)
            inpainter ?: load(perf, "lama") { Inpainter(store.file("lama")) {
                val info = android.app.ActivityManager.MemoryInfo()
                (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).getMemoryInfo(info)
                val thermal = if (android.os.Build.VERSION.SDK_INT >= 29) (context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).currentThermalStatus else 0
                InpaintPolicy.maxEdge(info.availMem,info.lowMemory,thermal,Runtime.getRuntime().maxMemory())
            } }.also { inpainter = it }
        }
    }
    private fun ocr(perf: Perf) = ocr ?: load(perf, "ppocr") { LatinOcr(store.file("ppocr_en_rec"), store.file("ppocr_en_dict"),ocrWork) }.also { ocr = it }

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
        val fullW = bmp.width
        val fullH = bmp.height
        var scaled = false
        if (maxOf(bmp.width, bmp.height) > MAX_EDGE) {
            val s = MAX_EDGE.toFloat() / maxOf(bmp.width, bmp.height)
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true)
            scaled = true
        }
        Decoded(ArabicLayout.rgbOf(bmp), opaque && !scaled, fullW, fullH)
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

    /** كاشف النص صغير (~11MB): نسخة ثانية مستقلة تستعملها الصفحة الحالية إن كان المسار الثقيل مشغولًا. */
    fun warmDetector(perf: Perf) {
        if (store.isInstalled()) detector(perf)
    }

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

    data class Routed(val pageHash:String,val width:Int,val height:Int,val detections:List<Detection>) {
        val textless get()=detections.none {it.label.startsWith("text") && it.score>=Regions.MIN_SCORE}
    }
    @Synchronized
    fun route(file:File,perf:Perf):Routed {
        store.requireInstalled()
        val (bytes,hash)=read(file,perf)
        // Probe pixels are transient; only bounded detection metadata survives this stage.
        val img=image(bytes,hash,perf,false).img
        val dets=detections[hash] ?: run {
            val detected=detect(img,perf)
            val candidates=perf.time("missingSweep") {MissingTextSweep.candidates(img,detected)}
            perf.count("missingCandidates",candidates.size)
            val extra=ArrayList<Detection>()
            if(candidates.isNotEmpty()) {
                val reader=ocr(perf)
                perf.time("missingOcr") {for(b in candidates) {
                    val (text,confidence)=reader.recognize(img.crop(b.x1,b.y1,b.x2,b.y2))
                    if(MissingTextSweep.confirmed(text,confidence)) {extra.add(Detection(b,confidence,"text_free"));perf.count("missingConfirmed")}
                }}
            }
            (detected+extra).also {detections[hash]=it}
        }
        return Routed(hash,img.width,img.height,dets)
    }
    @Synchronized
    fun acceptAnalysis(a:Analysis) { if((analyses[a.pageHash]?.revision ?: -1)<=a.revision) analyses[a.pageHash]=a }
    @Synchronized
    fun analysisSnapshot(hash:String):Analysis? = analyses[hash]

    /** المرحلة الخفيفة وحدها (قراءة، فك، كشف): صفحة بلا نص تنتهي هنا. */
    @Synchronized
    fun detectStage(file: File, perf: Perf): Analysis? {
        store.requireInstalled()
        val (bytes, hash) = read(file, perf)
        analyses[hash]?.let {
            perf.count("analysisReused")
            // تحليل محفوظ لصفحة فيها نص ليس «انتهى»: نحتاج المرور بـ finishForLuna
            // ليُعاد إنشاء المصغّرة عند إعادة المحاولة. قبل هذا الإصلاح كان الاستدعاء
            // الثاني يعيد التحليل مع thumbnail فارغة، فيطلب الخادم need_image إلى الأبد.
            if (!needsLuna(it)) return it
            return null
        }
        val img = image(bytes, hash, perf, true).img
        val dets = detect(img, perf)
        textless(hash, img, dets, perf, true)?.let { return it }
        detections[hash] = dets
        return null
    }

    /** المرحلة الثقيلة بعد [detectStage] (الحروف، الفقاعات، OCR) ومصغّرة Luna بالقفل نفسه. */
    @Synchronized
    fun finishForLuna(file: File, perf: Perf, routed:Routed?=null): Pair<Analysis, String> {
        val (bytes, hash) = read(file, perf)
        val cached=analyses[hash]
        val a = if(cached!=null && cached.rescue.isNotEmpty()) {
            val img=image(bytes,hash,perf,true).img
            val repaired = thaw(cached).toMutableList()
            val unresolved = ArrayList<Box>()
            for (box in cached.rescue.distinct()) {
                // A rescue box is the visible holder (whole balloon) when one exists.
                // Rebuild every snapshot owned by that holder so a missed second line
                // cannot survive beside a freshly re-analysed first line.
                val targets=cached.regions.filter { (it.bubbleBox ?: it.box)==box }
                val promoted=if(targets.isNotEmpty()) {
                    finish(hash,img,ResidualRescue.detections(targets),perf,false,forceHeavy=true)
                } else null
                if (promoted!=null && promoted.regions.isNotEmpty()) {
                    val ids=targets.map {it.id}.toSet()
                    repaired.removeAll {it.id in ids}
                    repaired.addAll(thaw(promoted))
                    perf.count("residualPromoted")
                } else {unresolved.add(box);perf.count("residualRescueFailed")}
            }
            val updated=freeze(hash,img.width,img.height,repaired.distinctBy {it.id})
            Analysis(hash,updated.width,updated.height,updated.regions,updated.bubbles,rescue=unresolved,revision=cached.revision+1).also {analyses[hash]=it}
        } else cached ?: run {
            val img = image(bytes, hash, perf, true).img
            val dets = routed?.takeIf {it.pageHash==hash}?.detections ?: detections.remove(hash) ?: detect(img, perf)
            textless(hash, img, dets, perf, true) ?: finish(hash, img, dets, perf, true)
        }
        val asks = needsLuna(a)
        return a to (if (asks) perf.time("thumbnail") { thumbnail(file, a.pageHash) } else "")
    }

    private fun finish(hash: String, img: RgbImage, dets: List<Detection>, perf: Perf, useCache: Boolean, forceHeavy:Boolean=false): Analysis {
        val gray = perf.time("gray") { img.gray() }

        // Independent fast regions survive heavy neighbours and failed OCR.
        val plan = perf.time("fastFlat") { if(forceHeavy) Regions.FastFlatPlan(emptyList(),dets.filter {it.label.startsWith("text") && it.score>=Regions.MIN_SCORE},emptyMap()) else Regions.fastFlatPlan(img, gray, hash, dets,allowFlatFree=true) }
        val fast = ArrayList<Region>()
        val texts = ArrayList(plan.heavy)
        if (plan.fast.isNotEmpty()) {
            val reader = ocr(perf)
            perf.time("fastOcr") {
                for (r in plan.fast) {
                    val res = reader.read(img, r.glyph, r.box)
                    perf.count("ocrLines", res.lines.size)
                    r.ocr = res; r.source = res.text
                    if (res.text.isEmpty() || res.confidence < maxOf(Regions.MIN_OCR_CONF, 0.62f)) {
                        texts.addAll(plan.sources.getValue(r.id))
                        perf.count("fastFlatOcrFallback")
                    } else fast.add(r)
                }
            }
        }
        perf.count("fastFlatRegions", fast.size)
        perf.count("heavyRegions", texts.size)
        if (fast.isNotEmpty()) perf.count("fastFlatHit")
        if (texts.isEmpty()) {
            perf.count("regions", fast.size)
            val analysis = perf.time("pack") { freeze(hash, img.width, img.height, fast) }
            if (useCache) analyses[hash] = analysis
            return analysis
        }
        // No production full-width fallback in this independent experiment.
        val holders=dets.filter {it.label=="bubble"}
        val crops=HeavyRoi.plan(img.width,img.height,texts,holders)
        perf.count("heavyRoiCrops",crops.size)
        perf.count("heavyRoiPixels",crops.sumOf {it.area})
        val gs=glyphs(perf)
        val prob=perf.time("glyphs") {gs.probabilitiesRoi(img,crops)}
        perf.count("glyphTiles",gs.tiles)
        val glyphFull=perf.time("glyphMask") {
            val m=ByteMask(img.width,img.height)
            for(i in prob.indices) if(prob[i]>.3f) m.data[i]=1
            m
        }
        val trusted=perf.time("localBubbles") {Regions.trustedHolderMasks(img,texts,holders)}
        val uncertain=HeavyRoi.bubbleNeeded(texts,trusted)
        val bubbleList=if(uncertain.isEmpty()) {
            perf.count("bubbleModelSkipped")
            trusted
        } else {
            val bs=bubbles(perf)
            val neural=perf.time("bubbles") {bs.segmentRoi(img,HeavyRoi.plan(img.width,img.height,uncertain,holders))}
            perf.count("bubbleTiles",bs.tiles)
            trusted+neural.filter {b->trusted.none {it.box.iou(b.box)>.5f}}
        }
        perf.count("bubbles",bubbleList.size)
        val heavyBubbles = perf.time("ownership") { Regions.excludeFastOwnership(fast,glyphFull,bubbleList) }
        val regions = perf.time("regions") { Regions.assemble(img, gray, hash, texts + dets.filter { it.label == "bubble" }, heavyBubbles, glyphFull) }
        perf.count("regions", regions.size + fast.size)
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
        val analysis = perf.time("pack") { freeze(hash, img.width, img.height, (fast + regions).distinctBy { it.id }.sortedWith(compareBy({ it.box.y1 / 60 }, { -it.box.x1 }))) }
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
     * مصغّرة JPEG base64 للسياق عند Luna (عرض ≤ 1080، ≤ 3.2 مليون بكسل). من البكسلات المفكوكة إن
     * كانت هي بكسلات الملف نفسها، وإلا من الملف كما كانت.
     */
    fun thumbnail(file: File, pageHash: String?, maxWidth: Int = 1080): String {
        val cached = pageHash?.let { synchronized(this) { images[it] } }?.takeIf { it.exact }
        val bmp = if (cached != null) ArabicLayout.bitmapOf(cached.img) else BitmapFactory.decodeFile(file.absolutePath) ?: return ""
        // سياق لـLuna (من يتكلم، النبرة) والنص نفسه يصلها مقروءًا: عرض ≤ 1080 وبكسلات ≤ 3.2 مليون
        // تكفي، والرفع على نت ضعيف أصغر بكثير (وأرخص عند Luna)
        val s = minOf(1.0, maxWidth.toDouble() / bmp.width, Math.sqrt(THUMB_PIXELS / (bmp.width.toDouble() * bmp.height)))
        val scaled = if (s < 1.0) Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * s).toInt()), maxOf(1, (bmp.height * s).toInt()), true) else bmp
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 78, out)
        return Base64.getEncoder().encodeToString(out.toByteArray())
    }

    // ── الرسم ──

    /**
     * التبييض والرسم. `arabicById`: ما ردّت به Luna (المعرّف → العربي). يرجع ملف WebP.
     * منطقة بلا عربي تبقى كما هي؛ عربي لا يدخل بحجم مقروء لا يُمسح أصله.
     */
    @Synchronized
    fun render(file: File, arabicById: Map<String, String>, outDir: File, perf: Perf = Perf(), leave: Set<String> = emptySet(), refinement: Boolean = false, lettering: Map<String, LetteringStyle> = emptyMap()): Pair<File, Int> {
        val (encoded, hash, translated) = renderImpl(file, arabicById, perf, useCache = true, leave, refinement, lettering)
        val out = perf.time("write") { publish(outDir, hash, encoded) }
        return out to translated
    }

    private fun recordErase(perf: Perf, s: Cleaner.EraseStats) {
        perf.count("eraseMaskPixels", s.maskPixels)
        perf.count("eraseChangedPixels", s.changedPixels)
        perf.count("fillMaskPixels", s.fillMaskPixels)
        perf.count("fillChangedPixels", s.fillChangedPixels)
        perf.count("inpaintMaskPixels", s.inpaintMaskPixels)
        perf.count("inpaintChangedPixels", s.inpaintChangedPixels)
        perf.count("eraseNoOpRegions", s.noOpRegions)
        perf.count("inpaintScaledRegions", s.scaledInpaintRegions)
    }

    /**
     * فحص تبييض حقيقي على الجهاز: نفس النماذج والتخطيط وCleaner وLaMa،
     * لكنه يتوقف قبل رسم العربي ويحفظ صورة تشخيصية خارج كاش القراءة.
     */
    @Synchronized
    fun diagnoseCleaning(
        file: File,
        arabicById: Map<String, String>,
        outDir: File,
        perf: Perf = Perf(),
        leave: Set<String> = emptySet(),
    ): CleaningProbe {
        store.requireInstalled()
        val analysis = analyzeImpl(file, perf, useCache = false)
        val (bytes, hash) = read(file, perf)
        val decoded = image(bytes, hash, perf, useCache = false)
        val img = decoded.img.copy()
        val regions = thaw(analysis)
        val sibs = Regions.siblings(regions)

        for (r in regions) {
            val ar = arabicById[r.id]?.trim()
            if (r.status != "pending" && r.status != "translated") continue
            if (ar.isNullOrEmpty()) { r.status = "skipped:untranslated"; continue }
            r.arabic = ar
            r.status = "translated"
        }
        perf.time("layout") {
            for (r in regions) {
                if (r.status != "translated") continue
                val fitted = layout.layoutRegion(img, r, r.arabic!!, sibs[r.id])
                if (fitted == null) { r.status = "skipped:no_fit"; perf.count("noFit"); continue }
                r.layout = fitted
            }
        }
        keepWholeBubbles(regions, sibs, leave, perf)
        perf.time("plan") { for (r in regions) if (r.status == "translated") Cleaner.planErase(img, r, sibs[r.id]) }
        perf.count("fill", regions.count { it.status == "translated" && it.cleanMode == "fill" })
        perf.count("inpaint", regions.count { it.status == "translated" && it.cleanMode != "fill" && it.eraseMask?.any() == true })
        val lama = if (Cleaner.needsInpaint(regions)) inpainter(perf) else null
        val eraseStats = perf.time("erase") { Cleaner.applyErase(img, regions, lama) }
        recordErase(perf, eraseStats)

        val encoded = perf.time("encode") {
            val bitmap = ArabicLayout.bitmapOf(img)
            val buf = ByteArrayOutputStream()
            val format = if (android.os.Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSLESS else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
            bitmap.compress(format, if (android.os.Build.VERSION.SDK_INT >= 30) 10 else 100, buf)
            bitmap.recycle()
            buf.toByteArray()
        }
        outDir.mkdirs()
        val prefix = "$hash-clean-"
        val name = "$prefix${ModelStore.sha256Hex(encoded).substring(0, 12)}.webp"
        val out = File(outDir, name)
        val tmp = File(outDir, "$name.part")
        perf.time("write") {
            if (!(out.exists() && out.length() == encoded.size.toLong())) {
                java.io.FileOutputStream(tmp).use { stream ->
                    stream.write(encoded)
                    stream.fd.sync()
                }
                if (!tmp.renameTo(out)) {
                    tmp.delete()
                    error("cannot publish cleaning probe")
                }
            }
            outDir.listFiles()?.forEach { old ->
                if (old.name != name && old.name.startsWith(prefix)) old.delete()
            }
        }
        return CleaningProbe(
            out,
            analysis.width,
            analysis.height,
            decoded.fullW,
            decoded.fullH,
            regions.count { it.status == "translated" && it.eraseMask?.any() == true },
        )
    }

    /** Immutable candidate publication; acceptance happens later in the reader. */
    private fun publish(outDir: File, hash: String, encoded: ByteArray): File {
        val out=PagePublisher.publish(outDir,hash,encoded)
        if (++published % 25 == 0) prune(outDir,hash)
        return out
    }

    private var published = 0

    /** الصفحات المترجمة فوق ٢٫٥ جيجا: الأقدم كتابةً يُحذف حتى ٢ جيجا (يُترجم من جديد إن عدت له). */
    private fun prune(outDir: File, protectedHash:String) {
        PagePublisher.prune(outDir,protectedHash,OUT_CAP,OUT_KEEP)
    }

    private fun readResidual(img:RgbImage,r:Region,perf:Perf):OcrResult {
        val scope=ResidualLatin.inspectionBox(r)
        val crop=img.crop(scope.x1,scope.y1,scope.x2,scope.y2)
        val mask=ResidualLatin.inspectionMask(img,r)
        return ocr(perf).read(crop,mask,Box(0,0,crop.width,crop.height))
    }

    /** يرجع (WebP، بصمة الصفحة، عدد المرسوم). */
    private fun renderImpl(file: File, arabicById: Map<String, String>, perf: Perf, useCache: Boolean, leave: Set<String> = emptySet(), refinement: Boolean = true, lettering: Map<String, LetteringStyle> = emptyMap()): Triple<ByteArray, String, Int> {
        store.requireInstalled()
        val (bytes, hash) = read(file, perf)
        val analysis = (if (useCache) analyses[hash] else null) ?:
            if(renderOnly) error("analysis handoff missing") else analyzeImpl(file, perf, useCache)
        val regions = perf.time("unpack") { thaw(analysis) }
        // الصورة المحفوظة تبقى نظيفة: المسح على نسخة
        val decoded = image(bytes, hash, perf, useCache)
        val img = perf.time("copy") { decoded.img.copy() }
        val sibs = Regions.siblings(regions)
        for (r in regions) {
            val ar = arabicById[r.id]?.trim()
            if (r.status != "pending" && r.status != "translated") continue
            if (ar.isNullOrEmpty()) { r.status = "skipped:untranslated"; continue }
            r.lettering = lettering[r.id] ?: LetteringStyle()
            r.arabic = ar
            r.status = "translated"
        }
        // ١. التخطيط أولًا: ما لا يدخل لا يُمسح
        perf.time("layout") {
            for (r in regions) {
                if (r.status != "translated") continue
                val l = fonts.layout(r.lettering).layoutRegion(img, r, r.arabic!!, sibs[r.id])
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
        // لم يُكتب في img شيء بعد: الأصل هو المفكوك نفسه (بلا نسخة ثالثة بحجم الصفحة)
        val original = decoded.img
        val lama = if (Cleaner.needsInpaint(regions)) inpainter(perf) else null
        perf.count("fill", regions.count { it.status == "translated" && it.cleanMode == "fill" })
        perf.count("inpaint", regions.count { it.status == "translated" && it.cleanMode != "fill" && it.eraseMask?.any() == true })
        val eraseStats = perf.time("erase") { Cleaner.applyErase(img, regions, lama) }
        recordErase(perf, eraseStats)
        // Cheap colour gate first. OCR sees only known text lines before Arabic is drawn.
        val residual = ArrayList<Region>()
        perf.time("residual") {
            for (r in regions) {
                if (r.status != "translated" || !ResidualLatin.candidate(img,r)) continue
                var result = readResidual(img,r,perf)
                if (!ResidualLatin.readable(result.text,result.confidence,r.kind)) continue
                val baseMask = r.eraseMask
                var cumulativeMask=baseMask
                var cleared = false
                // At most two local retries; never dilate the previous retry's already expanded mask.
                for (pixels in 1..2) {
                    r.eraseMask = baseMask
                    r.eraseMask = WhiteningRepair.mask(r,pixels)
                    val retryMask=r.eraseMask!!
                    recordErase(perf, Cleaner.applyErase(img,listOf(r),lama))
                    cumulativeMask=RenderSafety.cumulative(cumulativeMask,retryMask)
                    r.eraseMask=cumulativeMask
                    perf.count("residualRepairAttempts")
                    // Base erasure changed pixels; a repair no-op alone does not revoke that evidence.
                    r.status = "translated"
                    if (!ResidualLatin.candidate(img,r)) { cleared = true; break }
                    result = readResidual(img,r,perf)
                    if (!ResidualLatin.readable(result.text,result.confidence,r.kind)) break
                }
                if (!cleared && ResidualLatin.readable(result.text,result.confidence,r.kind)) {
                    r.status = "skipped:residual"
                    residual.add(r); perf.count("residualLatin")
                } else perf.count("residualRepaired")
            }
        }
        if (residual.isNotEmpty()) {
            // Metadata handoff only: the next analysis retry owns CTD/BubbleSeg.
            // Loading duplicate heavy sessions into the renderer would inflate memory and delay ready pages.
            analyses[hash]=Analysis(hash,analysis.width,analysis.height,analysis.regions,analysis.bubbles,
                rescue=ResidualLatin.rescueBoxes(residual),revision=analysis.revision+1)
            perf.count("residualRescueQueued")
            // A failed check preserves source pixels; it cannot count as a completed translation.
        }
        keepWholeBubbles(regions,sibs,leave,perf)
        // ٣. الرسم: بلون الحبر الأصلي، إلا إن كان سيختفي في خلفيته بعد المسح
        val inks = HashMap<String, Boolean>()
        val bmp = perf.time("draw") {
            val b = ArabicLayout.bitmapOf(img)
            val canvas = Canvas(b)
            for (r in regions) {
                if (r.status != "translated") continue
                val l = r.layout!!
                val light = Visibility.inkLight(img, l, r.inkLight)
                if (light != r.inkLight) perf.count("inkFlipped")
                inks[r.id] = light
                fonts.layout(r.lettering).draw(canvas, l, light, r.bubble == null && r.bubbleBox == null, r.lettering)
            }
            b
        }
        // ٣ب. لا مسح بلا عربي ظاهر: منطقة لم يظهر عربيّها فعلًا (خط بلا حروف، لون مطابق)
        // تعود لأصلها بالكامل بدل فقاعة مبيّضة فارغة
        val drawn = perf.time("visible") { try { ArabicLayout.rgbOf(bmp) } finally { bmp.recycle() } }
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
        keepWholeBubbles(regions,sibs,leave,perf)
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
        // صفحة حُلِّلت مصغّرة (أطول من MAX_EDGE): المسح والعربي يُعادان على الملف بمقاسه، فلا
        // تُحفظ الصفحة أصغر من أصلها (كانت تُمطّ على الشاشة فتظهر مبكسلة)
        val needsFullRes = decoded.fullW != img.width || decoded.fullH != img.height
        if (needsFullRes && !refinement) perf.count("refinementPending")
        val out = if (!needsFullRes || !refinement) {
            ArabicLayout.bitmapOf(final)
        } else {
            perf.count("fullRes")
            perf.time("fullRes") { fullRes(bytes, img.width, img.height, regions, inks, lama) }
        }
        val encoded = perf.time("encode") {
            val buf = ByteArrayOutputStream()
            val format = if (android.os.Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSLESS else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
            // WEBP_LOSSLESS: الرقم جهد الضغط (أسرع بحجم أكبر قليلًا)؛ WEBP القديم: 100 = بلا فقد
            out.compress(format, if (android.os.Build.VERSION.SDK_INT >= 30) 10 else 100, buf)
            out.recycle()
            buf.toByteArray()
        }
        val translated = regions.count { it.status == "translated" }
        perf.count("translated", translated)
        if (keepPixels) lastPixels = final.data
        return Triple(encoded, hash, translated)
    }

    /**
     * الصفحة بمقاس ملفها: كل منطقة مترجمة يُكبَّر قناع مسحها من مقاس التحليل ويُمسح بالطريقة
     * نفسها (لون الفقاعة أو LaMa)، ويُرسم العربي بالتخطيط نفسه مكبّرًا (خط متجهي: حادّ لا مبكسل)
     * وبلون الحبر نفسه. ما سوى ذلك بكسلات الملف كما هي.
     */
    private fun fullRes(bytes: ByteArray, sw: Int, sh: Int, regions: List<Region>, inks: Map<String, Boolean>, lama: Inpainter?): Bitmap {
        val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: error("not an image")
        Ort.checkBudget()
        val big = ArabicLayout.rgbOf(src)
        src.recycle()
        val kx = big.width.toFloat() / sw
        val ky = big.height.toFloat() / sh
        // صفحات الـFast Path كلها تقريبًا fill. سابقًا كنا نبني قناعًا كاملًا بدقة
        // الأصل ثم نمر فوقه مرة ثانية لكل فقاعة. في صفحة ويب تون طويلة هذا وحده
        // يضيف ثوانٍ. التعبئة يمكن تطبيقها مباشرة من القناع المصغّر؛ LaMa وحده
        // يحتاج ByteMask كامل الدقة.
        var inpaintMask: ByteMask? = null
        for (r in regions) {
            if (r.status != "translated") continue
            val m = r.eraseMask ?: continue
            val w = m.bounds() ?: continue
            val x0 = (w[0] * kx).toInt(); val y0 = (w[1] * ky).toInt()
            val x1 = minOf(big.width, Math.ceil(w[2] * kx.toDouble()).toInt()); val y1 = minOf(big.height, Math.ceil(w[3] * ky.toDouble()).toInt())
            if (r.cleanMode == "fill") {
                val color = r.fillColor ?: continue
                for (y in y0 until y1) {
                    Ort.checkBudget()
                    val my = minOf(sh - 1, (y / ky).toInt())
                    for (x in x0 until x1) {
                        val mx = minOf(sw - 1, (x / kx).toInt())
                        if (m[mx, my].toInt() == 0) continue
                        val i = (y * big.width + x) * 3
                        big.data[i] = color[0].toByte(); big.data[i + 1] = color[1].toByte(); big.data[i + 2] = color[2].toByte()
                    }
                }
            } else if (lama != null) {
                val mask = inpaintMask ?: ByteMask(big.width, big.height).also { inpaintMask = it }
                for (y in y0 until y1) {
                    Ort.checkBudget()
                    val my = minOf(sh - 1, (y / ky).toInt())
                    for (x in x0 until x1) mask[x, y] = m[minOf(sw - 1, (x / kx).toInt()), my]
                }
                lama.inpaint(big, mask, Box(x0, y0, x1, y1))
                mask.fillRect(x0, y0, x1, y1, 0)
            }
        }
        val out = ArabicLayout.bitmapOf(big)
        val canvas = Canvas(out)
        canvas.scale(kx, ky)
        for (r in regions) {
            if (r.status != "translated") continue
            fonts.layout(r.lettering).draw(canvas, r.layout!!, inks[r.id] ?: r.inkLight, r.bubble == null && r.bubbleBox == null, r.lettering)
        }
        return out
    }

    /** منطقة مقروءة بقيت بلا عربي ظاهر في فقاعة فيها عربي: الفقاعة كلها تبقى أصلها. */
    private fun keepWholeBubbles(regions: List<Region>, sibs: Map<String, List<Region>>, leave: Set<String>, perf: Perf) {
        RenderSafety.enforce(regions,sibs,leave,perf)
    }

    /** بكسلات آخر صفحة رُسمت (لمقارنة القديم بالجديد وحدها، أثناءها فقط). */
    private var lastPixels: ByteArray? = null
    private var keepPixels = false

    // ── القديم مقابل الجديد، على الجوال نفسه ──

    class Benchmark(val legacy: Perf, val current: Perf, val identical: Boolean)

    class EngineResult(val name: String, val loadMs: Long, val glyphsMs: Long, val bubblesMs: Long, val glyphDiff: Int, val glyphPixels: Int, val bubblesSame: Boolean, val bubbles: Int, val error: String? = null)

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
            Ort.Engine("nnapi-candidate", 1, 0, spin = false, nnapi = true),
            Ort.CURRENT.copy(name = "current-again"),
        )
        var baseMask: ByteArray? = null
        var baseBubbles: List<Bubble>? = null
        val out = ArrayList<EngineResult>()
        for (e in engines) {
            val t0 = System.nanoTime()
            var gs: GlyphSegmenter? = null
            var bs: BubbleSegmenter? = null
            try {
                gs = GlyphSegmenter(store.file("ctd"), e)
                bs = BubbleSegmenter(store.file("bubbleseg"), e)
                val t1 = System.nanoTime()
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
            } catch (error: Exception) {
                out.add(EngineResult(e.name,0,0,0,-1,0,false,0,error.javaClass.simpleName))
            } finally {
                gs?.close(); bs?.close()
            }
        }
        // Tight crops are benchmark candidates only; changing model context is gated on the real corpus.
        val plan=Regions.fastFlatPlan(img,img.gray(),hash,detect(img,Perf()))
        val crops=HeavyRoi.plan(img.width,img.height,plan.heavy,detect(img,Perf()).filter { it.label=="bubble" })
        if(crops.isNotEmpty()) {
            val t0=System.nanoTime()
            GlyphSegmenter(store.file("ctd")).use { gs ->
                BubbleSegmenter(store.file("bubbleseg")).use { bs ->
                    val t1=System.nanoTime();val full=gs.probabilities(img);val refB=bs.segment(img)
                    val t2=System.nanoTime();val roi=gs.probabilitiesRoi(img,crops);val t3=System.nanoTime();val roiB=bs.segmentRoi(img,crops);val t4=System.nanoTime()
                    var diff=0;var pixels=0
                    for(d in plan.heavy) for(y in maxOf(0,d.box.y1-Regions.GLYPH_MARGIN) until minOf(img.height,d.box.y2+Regions.GLYPH_MARGIN)) for(x in maxOf(0,d.box.x1-Regions.GLYPH_MARGIN) until minOf(img.width,d.box.x2+Regions.GLYPH_MARGIN)) {
                        val i=y*img.width+x
                        if((full[i]>.3f)!=(roi[i]>.3f)) diff++
                        if(roi[i]>.3f) pixels++
                    }
                    val same=plan.heavy.all { d ->
                        val a=refB.filter { it.box.contains(d.box)>.85f }.maxByOrNull { it.score }
                        val b=roiB.filter { it.box.contains(d.box)>.85f }.maxByOrNull { it.score }
                        a!=null && b!=null && a.mask.data.contentEquals(b.mask.data)
                    }
                    out.add(EngineResult("roi-candidate",(t1-t0)/1_000_000,(t3-t2)/1_000_000,(t4-t3)/1_000_000,diff,pixels,same,roiB.size))
                }
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
        keepPixels = true
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
            keepPixels = false
            lastPixels = null
        }
    }

    companion object {
        /**
         * هل هذا التحليل يحتاج نداء Luna وصورة السياق؟
         *
         * مهم خصوصًا لإعادة المحاولة: وجود Analysis في الذاكرة لا يعني أن الصفحة
         * انتهت. إن كان فيها نص pending مقروءًا، يجب أن تُبنى المصغّرة من جديد.
         */
        internal fun needsLuna(a: Analysis): Boolean =
            a.regions.any { it.status == "pending" && it.source.isNotEmpty() }

        fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
