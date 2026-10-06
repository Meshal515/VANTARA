package com.vantara.plugins.translation

import java.security.MessageDigest

/**
 * تجميع ما رأته النماذج إلى «مناطق» بمعرّفات ثابتة، مع بوابات الأمان —
 * ترجمة حرفية لـ`vantara_worker/regions.py`:
 *
 *   منطقة = صندوق نص من RT-DETR + (اختياريًا) فقاعة تحتويه + قناع حروفها
 *   المقصوص داخل الصندوق والمنقّى بعتبة Otsu بقطبية الحبر.
 *   المعرّف من بصمة الصفحة وموضع الصندوق بالنسب (دقة 0.5%): ثابت عبر التشغيلات.
 *
 * بوابات الأمان: بلا حروف → لا منطقة؛ ثقة دون العتبة → لا منطقة؛ «فقاعة»
 * بلا نص → تُهمل.
 */
class Region(
    val id: String,
    val box: Box,
    val score: Float,
    var kind: String, // speech | narration | free | sfx
    val bubble: Bubble?,
    val bubbleBox: Box?,
    val glyph: ByteMask,
    val glyphPixels: Int,
    val inkLight: Boolean,
) {
    var lettering: LetteringStyle = LetteringStyle()
    var ocr: OcrResult? = null
    var source: String = ""
    var arabic: String? = null
    var status: String = "pending"
    var eraseMask: ByteMask? = null
    var cleanMode: String? = null
    var fillColor: IntArray? = null
    var reconstruction: Cleaner.Reconstruction? = null
    var layout: TextLayout? = null
}

object Regions {
    const val MIN_SCORE = 0.35f
    const val MIN_GLYPH_PIXELS = 40
    const val MIN_OCR_CONF = 0.55f
    /** ما يقرؤه التجميع من قناع الحروف حول كل صندوق (`pad`) وزيادة. */
    const val GLYPH_MARGIN = 16

    fun stableId(pageHash: String, box: Box, width: Int, height: Int): String {
        val key = "$pageHash:${Math.round(200f * box.x1 / width)}:${Math.round(200f * box.y1 / height)}:${Math.round(200f * box.x2 / width)}:${Math.round(200f * box.y2 / height)}"
        val d = MessageDigest.getInstance("SHA-1").digest(key.toByteArray())
        return "r" + d.joinToString("") { "%02x".format(it) }.substring(0, 8)
    }

    /** صناديق النص المتكررة أو المتداخلة تُدمج في صندوق واحد يحيط بهما. */
    fun mergeTextBoxes(dets: List<Detection>, iouThr: Float = 0.4f, containThr: Float = 0.75f): List<Detection> {
        val texts = dets.filter { it.label.startsWith("text") }.sortedByDescending { it.score }
        val merged = ArrayList<Detection>()
        for (d in texts) {
            val hit = merged.indexOfFirst { m -> m.box.iou(d.box) > iouThr || m.box.contains(d.box) > containThr || d.box.contains(m.box) > containThr }
            if (hit < 0) { merged.add(d); continue }
            val m = merged[hit]
            merged[hit] = Detection(m.box.union(d.box), maxOf(m.score, d.score), if (m.score >= d.score) m.label else d.label)
        }
        return merged
    }

    /** قناع UNet خشن؛ يُقطع ببكسلات الحبر الفعلية (Otsu بقطبية الحبر داخل الصندوق). */
    fun refineGlyph(img: RgbImage, gray: ByteArray, glyph: ByteMask, box: Box): ByteMask {
        val pad = 6
        val x1 = maxOf(0, box.x1 - pad); val y1 = maxOf(0, box.y1 - pad)
        val x2 = minOf(img.width, box.x2 + pad); val y2 = minOf(img.height, box.y2 + pad)
        var inSum = 0L; var inN = 0L; var outSum = 0L; var outN = 0L
        for (y in y1 until y2) for (x in x1 until x2) {
            val v = (gray[y * img.width + x].toInt() and 0xff).toLong()
            if (glyph[x, y].toInt() != 0) { inSum += v; inN++ } else { outSum += v; outN++ }
        }
        if (inN == 0L) return glyph
        val light = outN == 0L || inSum / inN > outSum / outN
        val thr = ByteMask.otsu(gray, img.width, x1, y1, x2, y2)
        val core = glyph.dilate(1)
        val ink = ByteMask(img.width, img.height)
        for (y in y1 until y2) for (x in x1 until x2) {
            val v = gray[y * img.width + x].toInt() and 0xff
            val isInk = if (light) v > thr else v <= thr
            if (isInk && core[x, y].toInt() != 0) ink[x, y] = 1
        }
        // مكوّنات يغطيها القناع الأصلي بنصفها على الأقل: الباقي خط رسم مرّ بالصندوق
        val (labels, comps) = ink.components(true)
        val keep = ByteMask(img.width, img.height)
        val overlap = IntArray(comps.size + 1)
        // الحبر محصور في الصندوق؛ التسميات خارجه صفر
        val win = ink.scanWindow()
        if (win != null) for (y in win[1] until win[3]) for (x in win[0] until win[2]) {
            val i = y * img.width + x
            if (labels[i] != 0 && glyph.data[i].toInt() != 0) overlap[labels[i]]++
        }
        val ok = BooleanArray(comps.size + 1)
        for (c in comps) if (c.area >= 3 && overlap[c.label] * 2 >= c.area) ok[c.label] = true
        if (win != null) for (y in win[1] until win[3]) for (x in win[0] until win[2]) {
            val i = y * img.width + x
            if (labels[i] != 0 && ok[labels[i]]) keep.data[i] = 1
        }
        return if (keep.count() < 0.25 * glyph.count()) glyph else keep
    }

    fun inkIsLight(gray: ByteArray, width: Int, glyph: ByteMask, box: Box): Boolean {
        val vals = ArrayList<Int>()
        for (y in maxOf(0, box.y1) until minOf(glyph.height, box.y2)) for (x in maxOf(0, box.x1) until minOf(glyph.width, box.x2)) if (glyph[x, y].toInt() != 0) vals.add(gray[y * width + x].toInt() and 0xff)
        if (vals.isEmpty()) return false
        vals.sort()
        return vals[vals.size / 2] > 140
    }

    /**
     * المسار السريع للفقاعات المسطحة.
     *
     * RT-DETR أعطانا أصلًا صندوق النص وصندوق الفقاعة. إذا كانت الفقاعة ذات لون
     * واحد فعليًا، لا توجد فائدة من تشغيل CTD (1024²) ثم BubbleSeg (1024²):
     * نستخرج ورق الفقاعة من اللون نفسه ونستخرج الحبر باختلافه عن لون الورق.
     *
     * null = غير متأكد 100%؛ ارجع للمسار الثقيل بلا أي مخاطرة بالجودة.
     */
    data class FastFlatPlan(
        val fast: List<Region>,
        val heavy: List<Detection>,
        val sources: Map<String, List<Detection>>,
        val features: Map<String, FastRoiRouter.Features> = emptyMap(),
        val rejectionReasons: Map<Detection, String> = emptyMap(),
    )

    internal data class FastBubbleEvidence(
        val mask: ByteMask,
        val color: IntArray,
        val backgroundSpread: Float,
        val edgeDensity: Float,
        val maskConfidence: Float,
    )

    internal data class FastGlyphEvidence(val mask: ByteMask, val coverage: Float)
    private data class HolderGlyphCoverage(val coverage: Float, val hasUnclaimed: Boolean)

    /** Partition independently by holder; retain the exact conservative flat-mask tests. */
    fun fastFlatPlan(img: RgbImage, gray: ByteArray, pageHash: String, dets: List<Detection>, allowFlatFree:Boolean=false): FastFlatPlan {
        val texts = mergeTextBoxes(dets).filter { it.score >= MIN_SCORE }
        val holders = dets.filter { it.label == "bubble" && it.score >= 0.30f }
        val grouped = LinkedHashMap<Detection, MutableList<Detection>>()
        val heavy = ArrayList<Detection>()
        val out = ArrayList<Region>()
        val sources = LinkedHashMap<String, List<Detection>>()
        val features = LinkedHashMap<String, FastRoiRouter.Features>()
        val rejections = LinkedHashMap<Detection, String>()

        fun reject(ds: List<Detection>, reason: String) {
            heavy.addAll(ds)
            for (d in ds) rejections.putIfAbsent(d, reason)
        }

        for (d in texts) {
            // Geometry is only a proposal. The old 1.18x holder-area gate rejected
            // valid tight RT-DETR boxes before pixel evidence could prove them safe.
            val holder = holders
                .filter { it.box.contains(d.box) >= FastRoiRouter.HOLDER_CONTAINMENT_MIN }
                .maxByOrNull { it.box.contains(d.box) * 2f + it.score }

            if (holder == null) {
                if (allowFlatFree && d.label == "text_free") {
                    // Use the same 64px context budget as HeavyRoi. Fast is only
                    // accepted when that whole cheap context contains no meaningful
                    // unclaimed ink; otherwise CTD owns this ROI.
                    val pad=HeavyRoi.DEFAULT_PAD
                    val context=Box(maxOf(0,d.box.x1-pad),maxOf(0,d.box.y1-pad),minOf(img.width,d.box.x2+pad),minOf(img.height,d.box.y2+pad))
                    val flat=fastBubbleEvidence(img,context,d.box)
                    val glyph=flat?.let {fastGlyphEvidence(img,it.mask,d.box,it.color)}
                    if(flat!=null && glyph!=null && glyph.mask.count()>=MIN_GLYPH_PIXELS) {
                        val coverage=fastHolderGlyphCoverage(img,flat.mask,context,glyph.mask,flat.color)
                        if(coverage.hasUnclaimed) {
                            reject(listOf(d),"glyph_coverage")
                            continue
                        }
                        val id=stableId(pageHash,d.box,img.width,img.height)
                        val overlap=texts.filter {it != d}.maxOfOrNull {it.box.iou(d.box)} ?: 0f
                        val f=FastRoiRouter.Features(
                            detectorConfidence=d.score,
                            ocrConfidence=1f,
                            holderContainment=1f,
                            backgroundSpread=flat.backgroundSpread,
                            edgeDensity=flat.edgeDensity,
                            maskConfidence=flat.maskConfidence,
                            overlap=overlap,
                            glyphCoverage=coverage.coverage,
                            speechLike=false,
                        )
                        val verdict=FastRoiRouter.classify(f)
                        if(verdict.lane==FastRoiRouter.Lane.FAST) {
                            out.add(Region(id,d.box,d.score,"free",Bubble(context,d.score,flat.mask),context,glyph.mask,glyph.mask.count(),fastInkLight(img,glyph.mask,flat.color)))
                            sources[id]=listOf(d)
                            features[id]=f
                        } else reject(listOf(d),verdict.rejectionReasons.firstOrNull() ?: "router")
                    } else reject(listOf(d),if(flat==null) "background" else "glyph_mask")
                } else reject(listOf(d),if(d.label=="text_bubble") "holder" else "free_not_enabled")
            } else grouped.getOrPut(holder) { ArrayList() }.add(d)
        }

        for ((holder, group) in grouped) {
            // Mixed semantic ownership remains conservative: never partially erase
            // a holder when RT-DETR says another item inside may be free/SFX art.
            if (group.any { it.label == "text_free" }) { reject(group,"mixed_holder_label"); continue }
            val textBox = group.map { it.box }.reduce { a, b -> a.union(b) }
            val flat = fastBubbleEvidence(img, holder.box, textBox)
            if(flat==null) {reject(group,"background");continue}
            val glyph = fastGlyphEvidence(img, flat.mask, textBox, flat.color)
            if(glyph==null || glyph.mask.count()<MIN_GLYPH_PIXELS) {reject(group,"glyph_mask");continue}
            // Cheap whole-holder audit: Fast cannot rely on post-render residual
            // repair for a line that RT-DETR omitted. The component definition is
            // the same conservative one used by unclaimedGlyphDetections below.
            val holderCoverage=fastHolderGlyphCoverage(img,flat.mask,holder.box,glyph.mask,flat.color)
            if(holderCoverage.hasUnclaimed) {reject(group,"glyph_coverage");continue}

            val containment=group.minOf {holder.box.contains(it.box)}
            val overlap=holders.filter {it != holder}.maxOfOrNull {holder.box.iou(it.box)} ?: 0f
            val f=FastRoiRouter.Features(
                detectorConfidence=group.minOf {it.score},
                ocrConfidence=1f,
                holderContainment=containment,
                backgroundSpread=flat.backgroundSpread,
                edgeDensity=flat.edgeDensity,
                maskConfidence=flat.maskConfidence,
                overlap=overlap,
                glyphCoverage=holderCoverage.coverage,
                speechLike=true,
            )
            val verdict=FastRoiRouter.classify(f)
            if(verdict.lane!=FastRoiRouter.Lane.FAST) {reject(group,verdict.rejectionReasons.firstOrNull() ?: "router");continue}

            val gb = glyph.mask.bounds()
            if (gb == null) { reject(group,"glyph_mask"); continue }
            val id = stableId(pageHash, textBox, img.width, img.height)
            out.add(Region(id, textBox.union(Box(gb[0], gb[1], gb[2], gb[3])), group.maxOf { it.score }, "speech",
                Bubble(holder.box, holder.score, flat.mask), holder.box, glyph.mask, glyph.mask.count(), fastInkLight(img, glyph.mask, flat.color)))
            sources[id] = group
            features[id] = f
        }
        return FastFlatPlan(out.sortedWith(compareBy({ it.box.y1 / 60 }, { -it.box.x1 })), heavy, sources, features, rejections)
    }

    data class TrustedHolderPlan(
        val bubbles: List<Bubble>,
        val fastColor: Int,
        val flatBox: Int,
        val seeded: Int,
    )

    private fun maskCoverage(mask:ByteMask,box:Box):Float {
        var inside=0;var total=0
        for(y in maxOf(0,box.y1) until minOf(mask.height,box.y2)) for(x in maxOf(0,box.x1) until minOf(mask.width,box.x2)) {
            total++
            if(mask[x,y].toInt()!=0) inside++
        }
        return if(total==0) 0f else inside.toFloat()/total
    }

    /**
     * A mask that reaches the detector holder edge is only trusted if the holder
     * itself has visible boundary evidence. This rejects a false "bubble" box cut
     * out of an otherwise identical page background.
     */
    private fun holderBoundaryVisible(img:RgbImage,holder:Box):Boolean {
        val x0=maxOf(0,holder.x1);val y0=maxOf(0,holder.y1)
        val x1=minOf(img.width,holder.x2);val y1=minOf(img.height,holder.y2)
        if(x1-x0<12 || y1-y0<12) return false
        var samples=0;var strong=0
        fun compare(ax:Int,ay:Int,bx:Int,by:Int) {
            if(ax !in 0 until img.width || ay !in 0 until img.height || bx !in 0 until img.width || by !in 0 until img.height) return
            samples++
            val d=maxOf(
                Math.abs(img.r(ax,ay)-img.r(bx,by)),
                Math.abs(img.g(ax,ay)-img.g(bx,by)),
                Math.abs(img.b(ax,ay)-img.b(bx,by)),
            )
            if(d>=12) strong++
        }
        val sx=maxOf(2,(x1-x0)/48);val sy=maxOf(2,(y1-y0)/48)
        for(x in x0 until x1 step sx) {
            compare(x,y0+1,x,y0-2)
            compare(x,y1-2,x,y1+1)
        }
        for(y in y0 until y1 step sy) {
            compare(x0+1,y,x0-2,y)
            compare(x1-2,y,x1+1,y)
        }
        return samples>=16 && strong*4>=samples
    }

    private fun trustedLocalMask(img:RgbImage,holder:Box,owned:List<Detection>,mask:ByteMask):Boolean {
        // Downstream assemble requires >= .85 actual mask coverage. Keep a
        // margin above that gate so a bypass can never become narration later.
        if(owned.any {maskCoverage(mask,it.box)<.86f}) return false
        val b=mask.bounds() ?: return false
        val hx0=maxOf(0,holder.x1);val hy0=maxOf(0,holder.y1)
        val hx1=minOf(img.width,holder.x2);val hy1=minOf(img.height,holder.y2)
        val touches=b[0]<=hx0+1 || b[1]<=hy0+1 || b[2]>=hx1-1 || b[3]>=hy1-1
        return !touches || holderBoundaryVisible(img,holder)
    }

    /**
     * Conservative deterministic rescue for a loose RT-DETR holder.
     *
     * CTD supplies only an exclusion mask for ink while paper color is sampled;
     * it never decides the holder boundary. A candidate paper component must stay
     * closed inside the detector holder and cover every detected speech line.
     */
    internal fun seededBubbleMask(img:RgbImage,holder:Box,textBox:Box,glyphFull:ByteMask):ByteMask? {
        val hx0=maxOf(0,holder.x1);val hy0=maxOf(0,holder.y1)
        val hx1=minOf(img.width,holder.x2);val hy1=minOf(img.height,holder.y2)
        if(hx1-hx0<24 || hy1-hy0<24 || holder.contains(textBox)<.84f) return null
        // Sample paper from the detector-owned text extent only. Expanding this
        // seed window can cross the speech-bubble outline on a tight/low bubble
        // and make safe flat paper look textured. CTD-excluded ink leaves enough
        // actual paper here; if it does not, we conservatively fall back to neural rescue.
        val sx0=maxOf(hx0,textBox.x1);val sy0=maxOf(hy0,textBox.y1)
        val sx1=minOf(hx1,textBox.x2);val sy1=minOf(hy1,textBox.y2)
        if(sx1<=sx0 || sy1<=sy0) return null

        val blocked=glyphFull
        val rs=ArrayList<Int>();val gs=ArrayList<Int>();val bs=ArrayList<Int>()
        val stride=maxOf(1,minOf(sx1-sx0,sy1-sy0)/64)
        for(y in sy0 until sy1 step stride) for(x in sx0 until sx1 step stride) {
            if(blocked[x,y].toInt()!=0) continue
            rs.add(img.r(x,y));gs.add(img.g(x,y));bs.add(img.b(x,y))
        }
        if(rs.size<80) return null
        rs.sort();gs.sort();bs.sort()
        val color=intArrayOf(rs[rs.size/2],gs[gs.size/2],bs[bs.size/2])
        var spread=0.0
        for(i in rs.indices) spread += (
            Math.abs(rs[i]-color[0])+Math.abs(gs[i]-color[1])+Math.abs(bs[i]-color[2])
        )/3.0
        if(spread/rs.size>8.0) return null

        val close=ByteMask(img.width,img.height)
        for(y in hy0 until hy1) for(x in hx0 until hx1) {
            val d=maxOf(
                Math.abs(img.r(x,y)-color[0]),
                Math.abs(img.g(x,y)-color[1]),
                Math.abs(img.b(x,y)-color[2]),
            )
            if(d<=20) close[x,y]=1
        }
        val closed=close.close(1)
        val (labels,comps)=closed.components(false)
        if(comps.isEmpty()) return null

        var bestLabel=0;var bestOverlap=0
        for(c in comps) {
            var overlap=0
            for(y in maxOf(c.y0,textBox.y1) until minOf(c.y1,textBox.y2))
                for(x in maxOf(c.x0,textBox.x1) until minOf(c.x1,textBox.x2))
                    if(labels[y*img.width+x]==c.label) overlap++
            if(overlap>bestOverlap) {bestOverlap=overlap;bestLabel=c.label}
        }
        if(bestLabel==0) return null
        val c=comps.first {it.label==bestLabel}
        val paper=ByteMask(img.width,img.height)
        for(y in c.y0 until c.y1) for(x in c.x0 until c.x1) {
            if(labels[y*img.width+x]==bestLabel) paper[x,y]=1
        }
        val filled=paper.filledHoles()
        val b=filled.bounds() ?: return null
        if(b[0]<=hx0+1 || b[1]<=hy0+1 || b[2]>=hx1-1 || b[3]>=hy1-1) return null
        if((b[2]-b[0])<textBox.w || (b[3]-b[1])<textBox.h) return null
        if(filled.count()<textBox.area*1.15) return null
        if(maskCoverage(filled,textBox)<.86f) return null

        // Final paper-uniformity check over the accepted component itself.
        var dev=0.0;var n=0
        for(y in b[1] until b[3] step 2) for(x in b[0] until b[2] step 2) {
            if(filled[x,y].toInt()==0 || blocked[x,y].toInt()!=0) continue
            dev += (
                Math.abs(img.r(x,y)-color[0])+Math.abs(img.g(x,y)-color[1])+Math.abs(img.b(x,y)-color[2])
            )/3.0
            n++
        }
        if(n<40 || dev/n>7.5) return null
        return filled
    }

    /** BubbleSeg is rescue-only when a conservative local holder mask is proven. */
    fun trustedHolderPlan(
        img:RgbImage,
        texts:List<Detection>,
        holders:List<Detection>,
        glyphFull:ByteMask?=null,
    ):TrustedHolderPlan {
        val bubbles=ArrayList<Bubble>()
        val blockedGlyph by lazy {glyphFull?.dilate(2)}
        var fastColor=0;var flatBox=0;var seeded=0
        for(h in holders) {
            val owned=texts.filter {h.box.contains(it.box)>=.88f}
            if(owned.isEmpty()) continue
            val textBox=owned.map {it.box}.reduce {a,b->a.union(b)}
            var mask=fastBubbleMask(img,h.box,textBox)?.first
            var source=1
            if(mask==null || !trustedLocalMask(img,h.box,owned,mask)) {
                mask=flatBoxMask(img,h.box,textBox)
                source=2
            }
            if(mask==null || !trustedLocalMask(img,h.box,owned,mask)) {
                mask=blockedGlyph?.let {seededBubbleMask(img,h.box,textBox,it)}
                source=3
            }
            if(mask==null || !trustedLocalMask(img,h.box,owned,mask)) continue
            when(source) {1->fastColor++;2->flatBox++;else->seeded++}
            bubbles.add(Bubble(h.box,h.score,mask))
        }
        return TrustedHolderPlan(bubbles,fastColor,flatBox,seeded)
    }

    /** Legacy view for callers that only need the masks. */
    fun trustedHolderMasks(img:RgbImage,texts:List<Detection>,holders:List<Detection>):List<Bubble> =
        trustedHolderPlan(img,texts,holders).bubbles

    /** Legacy all-or-nothing view for existing diagnostics; production consumes the partition. */
    fun fastFlatRegions(img: RgbImage, gray: ByteArray, pageHash: String, dets: List<Detection>): List<Region>? {
        val plan = fastFlatPlan(img, gray, pageHash, dets)
        return plan.fast.takeIf { plan.heavy.isEmpty() }
    }

    /**
     * قناع فقاعة من لونها نفسه. يرجع القناع + لون الخلفية إن كانت مسطحة حقًا.
     * الشروط متعمدة المحافظة: فشل يعيد فقاعة واحدة فقط لـCTD/BubbleSeg.
     */
    internal fun fastBubbleMask(img: RgbImage, bubbleBox: Box, textBox: Box): Pair<ByteMask, IntArray>? =
        fastBubbleEvidence(img,bubbleBox,textBox)?.let {it.mask to it.color}

    private fun fastBubbleEvidence(img: RgbImage, bubbleBox: Box, textBox: Box): FastBubbleEvidence? {
        val x0 = maxOf(0, bubbleBox.x1); val y0 = maxOf(0, bubbleBox.y1)
        val x1 = minOf(img.width, bubbleBox.x2); val y1 = minOf(img.height, bubbleBox.y2)
        if (x1 - x0 < 24 || y1 - y0 < 24) return null

        val rs = ArrayList<Int>(); val gs = ArrayList<Int>(); val bs = ArrayList<Int>()
        val stride = maxOf(1, minOf(x1 - x0, y1 - y0) / 96)
        for (y in y0 until y1 step stride) for (x in x0 until x1 step stride) {
            if (x in (textBox.x1 - 3)..(textBox.x2 + 3) && y in (textBox.y1 - 3)..(textBox.y2 + 3)) continue
            rs.add(img.r(x, y)); gs.add(img.g(x, y)); bs.add(img.b(x, y))
        }
        if (rs.size < 80) return null
        rs.sort(); gs.sort(); bs.sort()
        val color = intArrayOf(rs[rs.size / 2], gs[gs.size / 2], bs[bs.size / 2])

        val close = ByteMask(img.width, img.height)
        var closeN = 0
        var total = 0
        for (y in y0 until y1) for (x in x0 until x1) {
            total++
            val d = maxOf(
                Math.abs(img.r(x, y) - color[0]),
                Math.abs(img.g(x, y) - color[1]),
                Math.abs(img.b(x, y) - color[2]),
            )
            if (d <= 20) { close[x, y] = 1; closeN++ }
        }
        if (closeN < total * 0.42) return null

        val paper = close.close(1).largestComponent().filledHoles()
        val pb = paper.bounds() ?: return null
        if (pb[2] - pb[0] < textBox.w || pb[3] - pb[1] < textBox.h) return null

        var inside = 0; var tn = 0
        for (y in maxOf(0, textBox.y1) until minOf(img.height, textBox.y2)) for (x in maxOf(0, textBox.x1) until minOf(img.width, textBox.x2)) {
            tn++
            if (paper[x, y].toInt() != 0) inside++
        }
        if (tn == 0) return null
        val maskConfidence=inside.toFloat()/tn
        if (maskConfidence < FastRoiRouter.MASK_CONFIDENCE_MIN) return null

        var spread = 0.0; var sn = 0
        var edge = 0.0; var en = 0
        val pw = paper.scanWindow() ?: return null
        fun luma(x:Int,y:Int)= (299*img.r(x,y)+587*img.g(x,y)+114*img.b(x,y))/1000
        for (y in pw[1] until pw[3] step 2) for (x in pw[0] until pw[2] step 2) {
            if (paper[x, y].toInt() == 0) continue
            if (x in (textBox.x1 - 8)..(textBox.x2 + 8) && y in (textBox.y1 - 8)..(textBox.y2 + 8)) continue
            spread += (
                Math.abs(img.r(x, y) - color[0]) +
                    Math.abs(img.g(x, y) - color[1]) +
                    Math.abs(img.b(x, y) - color[2])
                ) / 3.0
            sn++
            val here=luma(x,y)
            if(x+1<pw[2] && paper[x+1,y].toInt()!=0) {edge+=Math.abs(luma(x+1,y)-here)/255.0;en++}
            if(y+1<pw[3] && paper[x,y+1].toInt()!=0) {edge+=Math.abs(luma(x,y+1)-here)/255.0;en++}
        }
        if (sn < 40) return null
        val backgroundSpread=(spread/sn).toFloat()
        if (backgroundSpread > FastRoiRouter.BACKGROUND_SPREAD_MAX) return null
        val edgeDensity=if(en==0) 1f else (edge/en).toFloat()
        return FastBubbleEvidence(paper,color,backgroundSpread,edgeDensity,maskConfidence)
    }

    /** حبر النص داخل الفقاعة المسطحة، بلا شبكة عصبية. */
    internal fun fastGlyphMask(img: RgbImage, bubble: ByteMask, box: Box, bg: IntArray): ByteMask? =
        fastGlyphEvidence(img,bubble,box,bg)?.mask

    private fun fastGlyphEvidence(img: RgbImage, bubble: ByteMask, box: Box, bg: IntArray): FastGlyphEvidence? {
        val inner = bubble.erode(2)
        val pad = maxOf(5, minOf(14, box.h / 5))
        val x0 = maxOf(0, box.x1 - pad); val y0 = maxOf(0, box.y1 - pad)
        val x1 = minOf(img.width, box.x2 + pad); val y1 = minOf(img.height, box.y2 + pad)
        val ink = ByteMask(img.width, img.height)
        var candidate = 0
        for (y in y0 until y1) for (x in x0 until x1) {
            if (inner[x, y].toInt() == 0) continue
            val d = maxOf(
                Math.abs(img.r(x, y) - bg[0]),
                Math.abs(img.g(x, y) - bg[1]),
                Math.abs(img.b(x, y) - bg[2]),
            )
            if (d >= 18) { ink[x, y] = 1; candidate++ }
        }
        if (candidate < MIN_GLYPH_PIXELS) return null

        val area = maxOf(1, (x1 - x0) * (y1 - y0))
        if (candidate > area * 0.38) return null

        val (labels, comps) = ink.components(true)
        val keep = ByteMask(img.width, img.height)
        var kept = 0
        for (comp in comps) {
            val h = comp.y1 - comp.y0; val w = comp.x1 - comp.x0
            if (comp.area < 3 || h < 2 || w < 1) continue
            if (h > box.h * 1.25 || w > maxOf(box.w, box.h * 5)) return null
            for (y in comp.y0 until comp.y1) for (x in comp.x0 until comp.x1) {
                val i = y * img.width + x
                if (labels[i] == comp.label) { keep.data[i] = 1; kept++ }
            }
        }
        if (kept < MIN_GLYPH_PIXELS) return null
        return FastGlyphEvidence(keep.close(1), kept.toFloat()/candidate)
    }

    private fun fastHolderGlyphCoverage(
        img: RgbImage,
        bubble: ByteMask,
        holder: Box,
        claimed: ByteMask,
        bg: IntArray,
    ): HolderGlyphCoverage {
        val inner=bubble.erode(2)
        val owned=claimed.dilate(2)
        val stray=ByteMask(img.width,img.height)
        var candidate=0
        var covered=0
        for(y in maxOf(0,holder.y1) until minOf(img.height,holder.y2)) {
            for(x in maxOf(0,holder.x1) until minOf(img.width,holder.x2)) {
                if(inner[x,y].toInt()==0) continue
                val d=maxOf(
                    Math.abs(img.r(x,y)-bg[0]),
                    Math.abs(img.g(x,y)-bg[1]),
                    Math.abs(img.b(x,y)-bg[2]),
                )
                if(d<18) continue
                candidate++
                if(owned[x,y].toInt()!=0) covered++ else stray[x,y]=1
            }
        }
        val (_,components)=stray.components(true)
        val meaningful=components.any { comp ->
            val w=comp.x1-comp.x0
            val h=comp.y1-comp.y0
            comp.area>=10 && w>=2 && h>=3 && w<=holder.w && h<=maxOf(64,holder.h/2)
        }
        val coverage=if(candidate==0) 1f else covered.toFloat()/candidate
        return HolderGlyphCoverage(coverage,meaningful)
    }

    private fun fastInkLight(img: RgbImage, glyph: ByteMask, bg: IntArray): Boolean {
        val b = glyph.bounds() ?: return false
        var sum = 0L; var n = 0L
        for (y in b[1] until b[3]) for (x in b[0] until b[2]) if (glyph[x, y].toInt() != 0) {
            sum += (299L * img.r(x, y) + 587L * img.g(x, y) + 114L * img.b(x, y)) / 1000L
            n++
        }
        if (n == 0L) return false
        val ink = sum.toDouble() / n
        val paper = (299.0 * bg[0] + 587.0 * bg[1] + 114.0 * bg[2]) / 1000.0
        return ink > paper
    }

    /**
     * قناع صندوق سرد مستطيل فاته YOLO-seg: المكوّن المتصل بلون الحافة الداخلية
     * للصندوق. null إن لم يكن مسطّح اللون (نص فوق رسم).
     */
    fun flatBoxMask(img: RgbImage, bubbleBox: Box, textBox: Box, tol: Int = 18): ByteMask? {
        val bw = bubbleBox.w; val bh = bubbleBox.h
        if (bw < 8 || bh < 8) return null
        val m = maxOf(2, minOf(6, bh / 12))
        val ring = ArrayList<IntArray>()
        for (y in bubbleBox.y1 until bubbleBox.y2) for (x in bubbleBox.x1 until bubbleBox.x2) {
            if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
            val onRing = (y - bubbleBox.y1 < m) || (bubbleBox.y2 - 1 - y < m) || (x - bubbleBox.x1 < m) || (bubbleBox.x2 - 1 - x < m)
            val inText = x >= textBox.x1 - 2 && x < textBox.x2 + 2 && y >= textBox.y1 - 2 && y < textBox.y2 + 2
            if (onRing && !inText) ring.add(intArrayOf(img.r(x, y), img.g(x, y), img.b(x, y)))
        }
        if (ring.size < 20) return null
        val color = IntArray(3) { c -> ring.map { it[c] }.sorted()[ring.size / 2] }
        val spread = ring.map { (Math.abs(it[0] - color[0]) + Math.abs(it[1] - color[1]) + Math.abs(it[2] - color[2])) / 3.0 }.average()
        if (spread > 10) return null
        val close = ByteMask(img.width, img.height)
        for (y in maxOf(0, bubbleBox.y1) until minOf(img.height, bubbleBox.y2)) for (x in maxOf(0, bubbleBox.x1) until minOf(img.width, bubbleBox.x2)) {
            val d = maxOf(Math.abs(img.r(x, y) - color[0]), Math.abs(img.g(x, y) - color[1]), Math.abs(img.b(x, y) - color[2]))
            if (d <= tol) close[x, y] = 1
        }
        val closed = close.close(2)
        val (labels, comps) = closed.components(false)
        if (comps.isEmpty()) return null
        // المكوّن الذي يلامس معظم الحلقة
        val counts = IntArray(comps.size + 1)
        var ringN = 0
        for (y in maxOf(0, bubbleBox.y1) until minOf(img.height, bubbleBox.y2)) for (x in maxOf(0, bubbleBox.x1) until minOf(img.width, bubbleBox.x2)) {
            val onRing = (y - bubbleBox.y1 < m) || (bubbleBox.y2 - 1 - y < m) || (x - bubbleBox.x1 < m) || (bubbleBox.x2 - 1 - x < m)
            if (!onRing) continue
            ringN++
            val l = labels[y * img.width + x]
            if (l != 0) counts[l]++
        }
        val best = counts.indices.maxByOrNull { counts[it] } ?: return null
        if (best == 0 || counts[best] < ringN * 0.8) return null
        val comp = ByteMask(img.width, img.height)
        val c = comps.first { it.label == best }
        for (y in c.y0 until c.y1) for (x in c.x0 until c.x1) {
            val i = y * img.width + x
            if (labels[i] == best) comp.data[i] = 1
        }
        return comp.filledHoles()
    }

    /** Accepted fast holders own their pixels; heavy unification cannot reclaim their text or layout space. */
    fun excludeFastOwnership(fast: List<Region>, glyph: ByteMask, bubbles: List<Bubble>): List<Bubble> {
        if (fast.isEmpty()) return bubbles
        val boxes = fast.map { it.bubbleBox ?: it.box }
        for (box in boxes) glyph.fillRect(box.x1,box.y1,box.x2,box.y2,0)
        return bubbles.mapNotNull { bubble ->
            if (boxes.none { it.iou(bubble.box) > 0f }) bubble else {
                val mask = bubble.mask.copy()
                for (box in boxes) mask.fillRect(box.x1,box.y1,box.x2,box.y2,0)
                val bounds = mask.bounds()
                bounds?.let { Bubble(Box(it[0],it[1],it[2],it[3]),bubble.score,mask) }
            }
        }
    }

    /**
     * CTD is a second source of text evidence, not merely a mask for RT-DETR boxes.
     * Promote meaningful glyphs left unclaimed inside a speech holder into a
     * conservative synthetic text detection. OCR still has final veto before Luna/erase.
     */
    fun unclaimedGlyphDetections(img: RgbImage, glyphFull: ByteMask, dets: List<Detection>, bubbles: List<Bubble>): List<Detection> {
        if (bubbles.isEmpty() || glyphFull.count() < MIN_GLYPH_PIXELS) return emptyList()
        val claimed=ByteMask(img.width,img.height)
        for (d in mergeTextBoxes(dets).filter { it.score >= MIN_SCORE }) {
            val pad=maxOf(4,minOf(12,d.box.h/5))
            claimed.fillRect(d.box.x1-pad,d.box.y1-pad,d.box.x2+pad,d.box.y2+pad)
        }
        val out=ArrayList<Detection>()
        for (bubble in bubbles) {
            val inner=Cleaner.innerOf(bubble.mask,2)
            val stray=ByteMask(img.width,img.height)
            val b=bubble.box
            for(y in maxOf(0,b.y1) until minOf(img.height,b.y2)) for(x in maxOf(0,b.x1) until minOf(img.width,b.x2)) {
                val i=y*img.width+x
                if(glyphFull.data[i].toInt()!=0 && inner.data[i].toInt()!=0 && claimed.data[i].toInt()==0) stray.data[i]=1
            }
            val (_,components)=stray.components(true)
            val useful=components.filter { comp ->
                val w=comp.x1-comp.x0; val h=comp.y1-comp.y0
                comp.area>=10 && w>=2 && h>=3 && w<=b.w && h<=maxOf(64,b.h/2)
            }
            if(useful.isEmpty()) continue
            val box=Box(
                maxOf(0,useful.minOf {it.x0}-4),maxOf(0,useful.minOf {it.y0}-4),
                minOf(img.width,useful.maxOf {it.x1}+4),minOf(img.height,useful.maxOf {it.y1}+4),
            )
            if(box.area<=0) continue
            if(dets.any {it.label.startsWith("text") && it.score>=MIN_SCORE && (it.box.contains(box)>.85f || it.box.iou(box)>.72f)}) continue
            out.add(Detection(box,.81f,"text_bubble"))
        }
        return out.distinctBy { listOf(it.box.x1/4,it.box.y1/4,it.box.x2/4,it.box.y2/4) }
    }

    fun assemble(img: RgbImage, gray: ByteArray, pageHash: String, dets: List<Detection>, bubbles: List<Bubble>, glyphFull: ByteMask): List<Region> {
        val bubbleBoxes = dets.filter { it.label == "bubble" }
        val out = ArrayList<Region>()
        for (d in mergeTextBoxes(dets)) {
            if (d.score < MIN_SCORE) continue
            val pad = 10
            var glyph = glyphFull.clipped(d.box.x1 - pad, d.box.y1 - pad, d.box.x2 + pad, d.box.y2 + pad)
            glyph = refineGlyph(img, gray, glyph, d.box)
            val n = glyph.count()
            if (n < MIN_GLYPH_PIXELS) continue
            var bubble: Bubble? = null
            var bestCov = 0f
            for (b in bubbles) {
                var inside = 0; var total = 0
                for (y in maxOf(0, d.box.y1) until minOf(img.height, d.box.y2)) for (x in maxOf(0, d.box.x1) until minOf(img.width, d.box.x2)) { total++; if (b.mask[x, y].toInt() != 0) inside++ }
                val cov = if (total > 0) inside.toFloat() / total else 0f
                if (cov > bestCov) { bestCov = cov; bubble = b }
            }
            if (bestCov < 0.85f) bubble = null
            var bubbleBox = bubble?.box
            if (bubble == null) {
                val holder = bubbleBoxes.filter { it.box.contains(d.box) > 0.9f }.maxByOrNull { it.score }
                if (holder != null && holder.box.area > 1.15 * d.box.area) bubbleBox = holder.box
            }
            val light = inkIsLight(gray, img.width, glyph, d.box)
            // Detector confidence is not semantics. Short dialogue such as “HUH?” is often
            // low-confidence text_free; Luna sees page context and may decide it is SFX.
            val kind = when {
                bubble != null -> "speech"
                bubbleBox != null -> "narration"
                else -> "free"
            }
            out.add(Region(stableId(pageHash, d.box, img.width, img.height), d.box, d.score, kind, bubble, bubbleBox, glyph, n, light))
        }
        // ترتيب القراءة: من أعلى لأسفل ثم من اليمين لليسار
        return unify(img, gray, pageHash, out, bubbles, glyphFull).sortedWith(compareBy({ it.box.y1 / 60 }, { -it.box.x1 }))
    }

    /**
     * فقاعة واحدة = جملة واحدة = منطقة واحدة.
     *
     * الكاشف يقسم نص الفقاعة أحيانًا صناديق (سطر وسطران بينهما فراغ)، وأحيانًا يفوته
     * سطر كامل. النتيجة كانت: كل صندوق يُقرأ ويُترجم وحده (ترجمتان في فقاعة واحدة)،
     * والسطر الفائت لا يدخل أي قناع مسح فيبقى إنجليزيًّا تحت العربي.
     *
     * هنا:
     *  1. منطقة داخل فقاعة لم تُنسب لها (نصف صندوقها أو أكثر في قناعها) تُنسب لها.
     *  2. حبر النص داخل الفقاعة (قناع الحروف داخل حدّها المتآكل) الذي لم يدخل أي
     *     صندوق يُضم لأقرب مجموعة، ومكوّن يقع بين مجموعتين يصلهما (سطر فائت في الوسط).
     *  3. الصناديق المتقاربة (فجوة ≤ 2.5 سطر) تُدمج: قناع حروف واحد، صندوق واحد،
     *     قراءة واحدة بكل الأسطر، وترجمة واحدة. المتباعدة (فقاعتان ملتحمتان) تبقى منفصلة.
     * معرّف المنطقة المنفردة لا يتغير (ترجماتها المحفوظة تبقى صالحة)؛ المدموجة تأخذ
     * معرّف مجموع صناديقها.
     */
    internal fun unify(img: RgbImage, gray: ByteArray, pageHash: String, regions: List<Region>, bubbles: List<Bubble>, glyphFull: ByteMask): List<Region> {
        if (bubbles.isEmpty()) return regions
        val owner = java.util.IdentityHashMap<Region, Bubble>()
        for (r in regions) {
            val b = r.bubble ?: if (r.kind == "sfx") null else adoptive(img, r.box, bubbles)
            if (b != null) owner[r] = b
        }
        if (owner.isEmpty()) return regions
        val groups = java.util.IdentityHashMap<Bubble, MutableList<Region>>()
        for (r in regions) owner[r]?.let { groups.getOrPut(it) { ArrayList() }.add(r) }
        val out = ArrayList<Region>(regions.filter { owner[it] == null })
        for ((b, group) in groups) out += mergeBubble(img, gray, pageHash, b, group, glyphFull)
        return out
    }

    /** فقاعة تحتوي مركز الصندوق ونصفه على الأقل (منطقة فاتها شرط 85%). */
    private fun adoptive(img: RgbImage, box: Box, bubbles: List<Bubble>): Bubble? {
        val cx = ((box.x1 + box.x2) / 2).coerceIn(0, img.width - 1)
        val cy = ((box.y1 + box.y2) / 2).coerceIn(0, img.height - 1)
        return bubbles.firstOrNull { b ->
            if (b.mask[cx, cy].toInt() == 0) return@firstOrNull false
            var inside = 0; var total = 0
            for (y in maxOf(0, box.y1) until minOf(img.height, box.y2)) for (x in maxOf(0, box.x1) until minOf(img.width, box.x2)) { total++; if (b.mask[x, y].toInt() != 0) inside++ }
            total > 0 && inside * 2 >= total
        }
    }

    private fun gap(a: Box, b: Box): Pair<Int, Int> =
        maxOf(0, maxOf(a.x1, b.x1) - minOf(a.x2, b.x2)) to maxOf(0, maxOf(a.y1, b.y1) - minOf(a.y2, b.y2))

    private fun mergeBubble(img: RgbImage, gray: ByteArray, pageHash: String, b: Bubble, group: List<Region>, glyphFull: ByteMask): List<Region> {
        val heights = group.map { Cleaner.glyphHeight(it.glyph, it.box) }.sorted()
        val gh = maxOf(6, heights[heights.size / 2])
        // اتحاد-بحث على الصناديق المتقاربة
        val parent = IntArray(group.size) { it }
        fun find(i: Int): Int { var x = i; while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x] }; return x }
        fun join(a: Int, c: Int) { val ra = find(a); val rc = find(c); if (ra != rc) parent[ra] = rc }
        val near = (gh * 2.5).toInt()
        for (i in group.indices) for (j in i + 1 until group.size) {
            val (gx, gy) = gap(group[i].box, group[j].box)
            if (gx <= near && gy <= near) join(i, j)
        }
        // حبر نص داخل الفقاعة لم يدخل أي صندوق
        val inner = Cleaner.innerOf(b.mask, maxOf(2, gh / 5))
        var claimed = ByteMask(img.width, img.height)
        for (r in group) claimed = claimed.or(r.glyph)
        claimed = claimed.dilate(2)
        val stray = ByteMask(img.width, img.height)
        val bx0 = maxOf(0, b.box.x1); val by0 = maxOf(0, b.box.y1); val bx1 = minOf(img.width, b.box.x2); val by1 = minOf(img.height, b.box.y2)
        for (y in by0 until by1) for (x in bx0 until bx1) {
            val i = y * img.width + x
            if (glyphFull.data[i].toInt() != 0 && inner.data[i].toInt() != 0 && claimed.data[i].toInt() == 0) stray.data[i] = 1
        }
        val (labels, comps) = stray.components(true)
        val extra = HashMap<Int, ByteMask>() // جذر المجموعة ← حبرها الإضافي
        // بحجم حرف أو كلمة، لا خط رسم ولا نقطة ضجيج
        val pending = comps.filter { c -> val h = c.y1 - c.y0; c.area >= 12 && h <= gh * 2.2 && h >= gh * 0.3 && c.x1 - c.x0 <= b.box.w }.toMutableList()
        // الصندوق ينمو بما يُضم إليه: سطور فائتة متتالية فوق الصندوق (الكاشف أخذ آخر
        // سطرين من فقاعة بخمسة) تنضم سطرًا بعد سطر، لا الأقرب وحده
        val grown = group.map { it.box }.toMutableList()
        var changed = true
        while (changed && pending.isNotEmpty()) {
            changed = false
            val it = pending.iterator()
            while (it.hasNext()) {
                val c = it.next()
                val cb = Box(c.x0, c.y0, c.x1, c.y1)
                val close = group.indices.filter { idx -> val (gx, gy) = gap(grown[idx], cb); gy <= gh * 3 && gx <= gh * 4 }
                if (close.isEmpty()) continue
                // سطر فائت بين مجموعتين: هما جملة واحدة
                for (k in 1 until close.size) join(close[0], close[k])
                grown[close[0]] = grown[close[0]].union(cb)
                val root = find(close[0])
                val m = extra.getOrPut(root) { ByteMask(img.width, img.height) }
                for (y in c.y0 until c.y1) for (x in c.x0 until c.x1) {
                    val i = y * img.width + x
                    if (labels[i] == c.label) m.data[i] = 1
                }
                it.remove()
                changed = true
            }
        }
        // الجذور قد تغيّرت بعد الوصل: الحبر الإضافي يُعاد إلى جذره الأخير
        val extraByRoot = HashMap<Int, ByteMask>()
        for ((root, m) in extra) {
            val r = find(root)
            extraByRoot[r] = extraByRoot[r]?.or(m) ?: m
        }
        val clusters = group.indices.groupBy { find(it) }
        return clusters.map { (root, members) ->
            val rs = members.map { group[it] }
            val add = extraByRoot[root]
            if (rs.size == 1 && add == null) {
                val r = rs[0]
                if (r.bubble === b) r
                else Region(r.id, r.box, r.score, "speech", b, b.box, r.glyph, r.glyphPixels, r.inkLight)
            } else {
                var glyph = rs[0].glyph
                for (r in rs.drop(1)) glyph = glyph.or(r.glyph)
                if (add != null) glyph = glyph.or(add)
                val detBox = rs.map { it.box }.reduce { a, c -> a.union(c) }
                val gb = glyph.bounds()
                val box = if (gb != null) detBox.union(Box(gb[0], gb[1], gb[2], gb[3])) else detBox
                val id = if (rs.size == 1) rs[0].id else stableId(pageHash, detBox, img.width, img.height)
                val n = glyph.count()
                Region(id, box, rs.maxOf { it.score }, "speech", b, b.box, glyph, n, inkIsLight(gray, img.width, glyph, box))
            }
        }
    }

    /** المناطق التي تتشارك الفقاعة نفسها. */
    fun siblings(regions: List<Region>): Map<String, List<Region>> {
        val out = HashMap<String, List<Region>>()
        for (a in regions) {
            val same = regions.filter { b -> b !== a && ((a.bubble != null && a.bubble === b.bubble) || (a.bubble == null && a.bubbleBox != null && a.bubbleBox == b.bubbleBox)) }
            if (same.isNotEmpty()) out[a.id] = same
        }
        return out
    }
}
