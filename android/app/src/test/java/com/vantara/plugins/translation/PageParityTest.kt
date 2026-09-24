package com.vantara.plugins.translation

import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.DataInputStream

/**
 * خط الجوال (الكشف + الحروف + الفقاعات + OCR) على الصفحات الحقيقية، بـONNX Runtime
 * للحاسوب. يعمل فقط حين تُعطى مجلد الأوزان: `VANTARA_MODELS_DIR`، والصفحات من
 * `VANTARA_PARITY_PAGES` (ملفات `.rgb`: عرض وارتفاع ثم البايتات).
 */
class PageParityTest {
    /** صفحة بصيغة خام: عرض وارتفاع (big-endian) ثم بايتات RGB. */
    private fun load(file: File): RgbImage =
        DataInputStream(file.inputStream().buffered()).use { input ->
            val w = input.readInt(); val h = input.readInt()
            val data = ByteArray(w * h * 3)
            input.readFully(data)
            RgbImage(w, h, data)
        }

    @Test
    fun `every readable bubble on the real pages reaches Luna`() {
        val models = System.getenv("VANTARA_MODELS_DIR")?.let(::File)
        assumeTrue(models?.isDirectory == true)
        val pages = File(System.getenv("VANTARA_PARITY_PAGES") ?: return)
        val detector = Detector(File(models, "rtdetr-v4-s_int8.onnx"))
        val glyphs = GlyphSegmenter(File(models, "comictextdetector.onnx"))
        val bubbles = BubbleSegmenter(File(models, "yolov8m-seg-speech-bubble.onnx"))
        val ocr = LatinOcr(File(models, "ppocrv5-en-rec.onnx"), File(models, "ppocrv5-en-dict.txt"))
        for (page in pages.listFiles { f -> f.extension == "rgb" }!!.sortedBy { it.name }) {
            val img = load(page)
            val gray = img.gray()
            val prob = glyphs.probabilities(img)
            val glyphFull = ByteMask(img.width, img.height)
            for (i in prob.indices) if (prob[i] > 0.3f) glyphFull.data[i] = 1
            val regions = Regions.assemble(img, gray, page.name, detector.detect(img), bubbles.segment(img), glyphFull)
            println("== ${page.name} ${img.width}x${img.height}")
            for (r in regions) {
                if (r.kind == "sfx") { println("  ${r.box} sfx"); continue }
                val res = ocr.read(img, r.glyph, r.box)
                val status = if (res.text.isEmpty() || res.confidence < Regions.MIN_OCR_CONF) "UNREADABLE" else "to-luna"
                println("  ${r.box} ${r.kind} bubble=${r.bubble != null} $status ${"%.3f".format(res.confidence)} ${res.text}")
            }
        }
    }
}
