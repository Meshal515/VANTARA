package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File

/**
 * قناع الحروف: رأس UNet في comic-text-detector (`seg` من الخرج الثلاثي).
 * المدخل 1024×1024 ثابت؛ الصفحة تُقسَّم شرائح مربعة بعرضها، والمتوسط في التداخل.
 * الخرج خريطة احتمال [0,1] بحجم الصورة.
 */
class GlyphSegmenter(file: File, private val engine: Ort.Engine? = null) : AutoCloseable {
    /** بدائل القياس فقط؛ الإنتاج يبقى AUTO بشروطه الأصلية. */
    enum class Mode { AUTO, ATLAS, STRIPES, TIGHT }
    private val session: OrtSession = Ort.open(file, engine = engine)
    private val size = 1024

    /**
     * Fixed 1024² canvases stay on the static session (XNNPACK). Small crops use the
     * dynamic sibling ([CtdDynamicModel], CPU pool: see [Ort.DYNAMIC]), opened lazily
     * only when a page actually picks [Mode.TIGHT].
     */
    private val dynamicFile: File? = CtdDynamicModel.ensure(file)
    private var dynamicSession: OrtSession? = null
    private var dynamicFailed = false
    private fun dynamicSession(): OrtSession? {
        dynamicSession?.let { return it }
        val dyn = dynamicFile
        if (dynamicFailed || dyn == null) return null
        return runCatching { Ort.open(dyn, engine = engine ?: Ort.DYNAMIC) }
            .onFailure { dynamicFailed = true }.getOrNull()?.also { dynamicSession = it }
    }
    val dynamic: Boolean get() = dynamicFile != null && !dynamicFailed

    /** Tensor pixels actually pushed through CTD by the last mask call (telemetry). */
    var lastTensorPixels = 0L
        private set

    /** Actual model tensor demand per CTD forward pass. */
    val inputPixelsPerTile: Int
        get() = size * size

    /** عدد المربعات في آخر صفحة (للقياس). */
    var tiles = 0
        private set

    /**
     * One CTD forward pass mapped back to the source crop. Keeping this local
     * avoids page-sized probability/count planes on the production ROI path.
     */
    private fun inferMapped(crop:RgbImage):FloatArray {
        val (chw,r)=crop.toChwPadded(size,0)
        val nw=Math.round(crop.width*r)
        val nh=Math.round(crop.height*r)
        val input=Ort.tensor(chw,1,3,size.toLong(),size.toLong())
        Ort.run(session,mapOf("images" to input)).use {res->
            val seg=res.get("seg").get().value
            @Suppress("UNCHECKED_CAST")
            val plane=(seg as Array<Array<Array<FloatArray>>>)[0][0]
            return CtdSegMapper.map(plane,nw,nh,crop.width,crop.height)
        }
    }

    /** يرجع احتمال «حرف» لكل بكسل. */
    /**
     * `rows`: صفوف النص (من الكاشف موسّعة). قطعة لا تمسّ أي صف لا تُشغَّل: كل بكسل في
     * تلك الصفوف يأخذ القطع نفسها التي كان يأخذها، فقيمته هي نفسها بتًّا بتًّا.
     */
    fun probabilities(img: RgbImage, rows: List<IntRange>? = null, singleTile:Boolean=false): FloatArray {
        val acc=FloatArray(img.width*img.height)
        val cnt=FloatArray(img.width*img.height)
        val tileH=img.width
        val overlap=(img.width*.12).toInt()
        val spans=if(singleTile) listOf(0 to img.height) else verticalTiles(img.height,tileH,overlap)
        val needed=if(rows==null) spans else spans.filter {(y0,y1)->rows.any {it.first<y1 && it.last>=y0}}
        tiles=needed.size
        for((y0,y1) in needed) {
            val crop=img.crop(0,y0,img.width,y1)
            val local=inferMapped(crop)
            var k=0
            for(y in y0 until y1) for(x in 0 until img.width) {
                val i=y*img.width+x
                acc[i]+=local[k++]
                cnt[i]+=1f
            }
        }
        for(i in acc.indices) if(cnt[i]>0) acc[i]/=cnt[i]
        return acc
    }

    /** Legacy/diagnostic ROI probabilities; production consumes [maskRoi]. */
    fun probabilitiesRoi(img: RgbImage, crops: List<Box>): FloatArray {
        val blended=RoiProbabilities(img.width,img.height)
        for(box in crops) {
            val crop=img.crop(box.x1,box.y1,box.x2,box.y2)
            blended.add(box,inferMapped(crop))
        }
        tiles=crops.size
        return blended.finish()
    }

    /**
     * Production ROI path: identical per-crop CTD inference and overlap averaging,
     * but only ROI-local float buffers are allocated. The page-sized result is the
     * final ByteMask downstream already needs.
     */
    fun maskRoi(img:RgbImage,crops:List<Box>,threshold:Float=.3f):ByteMask {
        val local=ArrayList<FloatArray>(crops.size)
        for(box in crops)
            local.add(inferMapped(img.crop(box.x1,box.y1,box.x2,box.y2)))
        tiles=crops.size
        return RoiMaskComposer.threshold(img.width,img.height,crops,local,threshold)
    }

    /** Fraction of the last atlas tensors that carried crop pixels (telemetry). */
    var lastOccupancy = 0f
        private set
    /** "atlas" or "stripes": which v3 path the last [maskAtlas] used. */
    var lastMode = ""
        private set

    /**
     * v3 production path. Crops are packed at the reference glyph scale
     * ([RoiAtlas.referenceScale]) into as few 1024² canvases as possible — one CTD call
     * per canvas instead of one per crop. A dense page whose text needs no more
     * full-width stripes than canvases takes the stripes instead: same cost or less,
     * and exactly the reference geometry. Same threshold/averaging downstream.
     */
    fun maskAtlas(img: RgbImage, crops: List<Box>, threshold: Float = .3f, mode: Mode = Mode.AUTO): ByteMask {
        val scale = RoiAtlas.referenceScale(img.width, size)
        val plan = RoiAtlas.plan(crops, size, scale = scale)
        val spans = RoiAtlas.stripes(img.width, img.height, crops)
        val tight = if (dynamic) RoiAtlas.tight(crops, scale, size) else emptyList()
        val tightPixels = tight.sumOf { it.pixels }
        val stripePixels = spans.size.toLong() * size * size
        val chosen = when {
            mode != Mode.AUTO -> if (mode == Mode.TIGHT && !dynamic) Mode.ATLAS else mode
            // The CPU pool is slower per pixel than XNNPACK; take tight only with a clear margin.
            dynamic && tight.isNotEmpty() && tightPixels * TIGHT_MARGIN < minOf(stripePixels, plan.atlases.toLong() * size * size) -> Mode.TIGHT
            spans.size <= plan.atlases -> Mode.STRIPES
            else -> Mode.ATLAS
        }
        val local = when (chosen) {
            Mode.STRIPES -> {
                lastMode = "stripes"
                tiles = spans.size
                lastOccupancy = 1f
                lastTensorPixels = stripePixels
                RoiAtlas.stripeProbabilities(img, crops, spans) { strip -> inferMapped(strip) }
            }
            Mode.TIGHT -> {
                val dyn = dynamicSession()
                    ?: return maskAtlas(img, crops, threshold, if (spans.size <= plan.atlases) Mode.STRIPES else Mode.ATLAS)
                lastMode = "tight"
                tiles = tight.size
                lastTensorPixels = tightPixels
                lastOccupancy = if (tightPixels == 0L) 0f else tight.sumOf { it.w.toLong() * it.h }.toFloat() / tightPixels
                val out = arrayOfNulls<FloatArray>(crops.size)
                for (t in tight) {
                    val input = Ort.tensor(RoiAtlas.tightInput(img, t), 1, 3, t.canvasH.toLong(), t.canvasW.toLong())
                    Ort.run(dyn, mapOf("images" to input)).use { res ->
                        @Suppress("UNCHECKED_CAST")
                        out[t.index] = RoiAtlas.tightExtract(t, (res.get("seg").get().value as Array<Array<Array<FloatArray>>>)[0][0])
                    }
                }
                crops.indices.map { out[it] ?: FloatArray(maxOf(0, crops[it].area)) }
            }
            else -> {
                lastMode = "atlas"
                tiles = plan.atlases
                lastOccupancy = plan.occupancy()
                lastTensorPixels = plan.atlases.toLong() * size * size
                RoiAtlas.probabilities(img, crops, plan) { chw ->
                    val input = Ort.tensor(chw, 1, 3, size.toLong(), size.toLong())
                    Ort.run(session, mapOf("images" to input)).use { res ->
                        @Suppress("UNCHECKED_CAST")
                        (res.get("seg").get().value as Array<Array<Array<FloatArray>>>)[0][0]
                    }
                }
            }
        }
        return RoiMaskComposer.threshold(img.width, img.height, crops, local, threshold)
    }

    override fun close() { session.close(); dynamicSession?.close(); dynamicSession = null }

    companion object {
        /** Tight must save at least this factor of tensor pixels over atlas/stripes. */
        const val TIGHT_MARGIN = 1.5
    }
}
