package com.vantara.plugins.translation

import java.io.File
import javax.imageio.ImageIO

/**
 * مقارنة JVM محلية للنماذج المثبتة، وليست قياس Android أو الفصل الكامل.
 * تُصرَّف مع ملفات المحرك النقية وonnxruntime 1.20.0؛ لا Pipeline/Canvas/Luna.
 * الوسيطان: مجلد النماذج، مجلد صفحات JPEG. الخرج TSV للقياس والتدقيق.
 */
fun main(args: Array<String>) {
    val models=File(args[0]); val pages=File(args[1])
    val detector=Detector(File(models,"rtdetr-v4-s_int8.onnx"))
    val glyphs=GlyphSegmenter(File(models,"comictextdetector-seg.onnx"))
    val bubbles=BubbleSegmenter(File(models,"yolov8m-seg-speech-bubble.onnx"))
    val ocr=LatinOcr(File(models,"ppocrv5-en-rec.onnx"),File(models,"ppocrv5-en-dict.txt"))
    fun elapsed(start:Long)=(System.nanoTime()-start)/1_000_000
    println("page\tregions\tcrops\tsourcePixels\tatlasCalls\tstripeCalls\toccupancy\tmode\troiMs\tautoMs\tstripeMs\troiVsAutoDiff\tautoVsStripeDiff\tbubble1024Ms\tbubbleNativeMs\tbubbleCount1024\tbubbleCountNative\tocrFailedBefore\tocrFailedAfter\tocrRetryLines")
    try {
        for(file in pages.listFiles()!!.filter {it.extension=="jpg"}.sortedBy {it.name}) {
            val bitmap=ImageIO.read(file); val w=bitmap.width;val h=bitmap.height
            val pixels=ByteArray(w*h*3)
            for(y in 0 until h) for(x in 0 until w) {
                val color=bitmap.getRGB(x,y);val i=(y*w+x)*3
                pixels[i]=(color shr 16).toByte();pixels[i+1]=(color shr 8).toByte();pixels[i+2]=color.toByte()
            }
            val img=RgbImage(w,h,pixels)
            val detections=detector.detect(img)
            val texts=detections.filter {it.label.startsWith("text") && it.score>=.35f}
            val crops=HeavyRoi.plan(w,h,texts,detections.filter {it.label=="bubble"})
            val plan=RoiAtlas.plan(crops,scale=RoiAtlas.referenceScale(w))
            val spans=RoiAtlas.stripes(w,h,crops)
            val t0=System.nanoTime();val roi=glyphs.maskRoi(img,crops);val roiMs=elapsed(t0)
            val t1=System.nanoTime();val auto=glyphs.maskAtlas(img,crops);val autoMs=elapsed(t1);val mode=glyphs.lastMode
            val t2=System.nanoTime();val stripes=glyphs.maskAtlas(img,crops,mode=GlyphSegmenter.Mode.STRIPES);val stripeMs=elapsed(t2)
            var roiDiff=0;var stripeDiff=0
            for(i in roi.data.indices) {if(roi.data[i]!=auto.data[i]) roiDiff++;if(auto.data[i]!=stripes.data[i]) stripeDiff++}
            BubbleSegmenter.nativeRoi=false
            val b0=System.nanoTime();val up=bubbles.segmentRoi(img,crops);val upMs=elapsed(b0)
            BubbleSegmenter.nativeRoi=true
            val b1=System.nanoTime();val native=bubbles.segmentRoi(img,crops);val nativeMs=elapsed(b1)
            var before=0;var after=0;var retries=0
            for(text in texts) {
                val box=text.box
                val result=ocr.read(img,auto,box)
                after+=result.failedLines;retries+=result.retriedLines
                for(line in ocr.splitLines(auto,box)) {
                    val raw=ocr.recognize(img.crop(maxOf(0,line.x1-4),maxOf(0,line.y1-4),minOf(w,line.x2+4),minOf(h,line.y2+4)))
                    if(raw.first.isBlank() || raw.second<.55f) before++
                }
            }
            println(listOf(file.name,texts.size,crops.size,crops.sumOf {it.area},plan.atlases,spans.size,plan.occupancy(),mode,roiMs,autoMs,stripeMs,roiDiff,stripeDiff,upMs,nativeMs,up.size,native.size,before,after,retries).joinToString("\t"))
            System.out.flush()
        }
    } finally {BubbleSegmenter.nativeRoi=true;ocr.close();bubbles.close();glyphs.close();detector.close()}
}
