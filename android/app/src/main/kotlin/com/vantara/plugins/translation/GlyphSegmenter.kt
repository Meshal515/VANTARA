package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File

/**
 * قناع الحروف: رأس UNet في comic-text-detector (`seg` من الخرج الثلاثي).
 * المدخل 1024×1024 ثابت؛ الصفحة تُقسَّم شرائح مربعة بعرضها، والمتوسط في التداخل.
 * الخرج خريطة احتمال [0,1] بحجم الصورة.
 */
class GlyphSegmenter(file: File, engine: Ort.Engine? = null) : AutoCloseable {
    private val session: OrtSession = Ort.open(file, engine = engine)
    private val size = 1024

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
        val mapped=FloatArray(crop.width*crop.height)
        Ort.run(session,mapOf("images" to input)).use {res->
            val seg=res.get("seg").get().value
            @Suppress("UNCHECKED_CAST")
            val plane=(seg as Array<Array<Array<FloatArray>>>)[0][0]
            for(y in 0 until crop.height) {
                val fy=((y+.5f)*nh/crop.height-.5f).coerceIn(0f,(nh-1).toFloat())
                val ya=fy.toInt();val yb=minOf(nh-1,ya+1);val wy=fy-ya
                for(x in 0 until crop.width) {
                    val fx=((x+.5f)*nw/crop.width-.5f).coerceIn(0f,(nw-1).toFloat())
                    val xa=fx.toInt();val xb=minOf(nw-1,xa+1);val wx=fx-xa
                    mapped[y*crop.width+x]=
                        (plane[ya][xa]*(1-wx)+plane[ya][xb]*wx)*(1-wy)+
                        (plane[yb][xa]*(1-wx)+plane[yb][xb]*wx)*wy
                }
            }
        }
        return mapped
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

    override fun close() = session.close()
}
