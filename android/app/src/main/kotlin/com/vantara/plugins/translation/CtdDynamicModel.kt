package com.vantara.plugins.translation

import java.io.File
import java.io.RandomAccessFile

/**
 * comic-text-detector برأس الحروف وحده (`comictextdetector-seg.onnx`) رسمه كله
 * Conv/Pool/ConvTranspose/Concat بلا Reshape ولا Resize، لكن ملفه يعلن مدخلًا ثابتًا
 * 1×3×1024×1024. فكل منطقة نص، ولو 170×170، كانت تدفع نداءً كاملًا بحجم 1024²
 * (~1.8 ث على S23) لأن ORT يرفض أي مقاس آخر.
 *
 * هنا نسخة مشتقة على الجهاز من الملف المتحقَّق منه نفسه: الفرق الوحيد أن بُعدي
 * الارتفاع والعرض في وصف المدخل `images` والمخرج `seg` صارا رمزيين ("h"/"w").
 * الترميز بنفس الطول بالضبط (`08 80 08` = dim_value 1024 ↔ `12 01 68` = dim_param "h")،
 * فلا يتغير أي طول في protobuf ولا يُلمس أي وزن. على 1024² الناتج مطابق بتًّا بتًّا
 * (ORT 1.20/1.30)، وعلى المقاسات الأصغر الحساب يتناسب مع البكسلات.
 *
 * لا تنزيل جديد: النسخة تُولَّد مرة بجانب الأصل وتُعاد إن تغيّر الأصل (حجمه/وقته).
 */
internal object CtdDynamicModel {
    /** Serialized ValueInfoProto of the fixed input/output, as exported by tools/ctd_seg_only.py. */
    private val INPUT = hex("0a06696d6167657312180a16080112120a0208010a0208030a030880080a03088008")
    private val OUTPUT = hex("0a0373656712180a16080112120a0208010a0208010a030880080a03088008")
    /** Last two dims (`dim{dim_value:1024}` ×2) → `dim{dim_param:"h"}`, `dim{dim_param:"w"}`. */
    private val DYNAMIC_HW = hex("0a031201680a03120177")
    /** Graph inputs/outputs are serialized after nodes and initializers. */
    private const val TAIL_BYTES = 1 shl 20

    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    private fun indexOf(hay: ByteArray, needle: ByteArray, from: Int = 0): Int {
        outer@ for (i in from..hay.size - needle.size) {
            for (j in needle.indices) if (hay[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }

    /** Offsets (in `tail`) of the dims to rewrite, or null unless each descriptor occurs exactly once. */
    fun patchOffsets(tail: ByteArray): List<Int>? {
        val out = ArrayList<Int>(2)
        for (p in listOf(INPUT, OUTPUT)) {
            val at = indexOf(tail, p)
            if (at < 0 || indexOf(tail, p, at + 1) >= 0) return null
            out.add(at + p.size - DYNAMIC_HW.size)
        }
        return out
    }

    /** In-memory variant (tests): rewrites `bytes` in place; false leaves it untouched. */
    fun patch(bytes: ByteArray): Boolean {
        val offsets = patchOffsets(bytes) ?: return false
        for (o in offsets) System.arraycopy(DYNAMIC_HW, 0, bytes, o, DYNAMIC_HW.size)
        return true
    }

    /** The dynamic sibling of `source`, generated once; null when `source` is not the seg-only export. */
    fun ensure(source: File): File? = runCatching {
        if (!source.isFile) return null
        val target = File(source.parentFile, source.nameWithoutExtension + ".dyn.onnx")
        val stamp = File(source.parentFile, target.name + ".src")
        val want = "${source.length()}:${source.lastModified()}"
        if (target.isFile && target.length() == source.length() && stamp.takeIf { it.isFile }?.readText() == want) return target
        val tailStart = maxOf(0L, source.length() - TAIL_BYTES)
        val tail = RandomAccessFile(source, "r").use { f ->
            ByteArray((source.length() - tailStart).toInt()).also { f.seek(tailStart); f.readFully(it) }
        }
        val offsets = patchOffsets(tail) ?: return null
        val tmp = File(source.parentFile, target.name + ".tmp")
        source.copyTo(tmp, overwrite = true)
        RandomAccessFile(tmp, "rw").use { f -> for (o in offsets) { f.seek(tailStart + o); f.write(DYNAMIC_HW) } }
        if (!tmp.renameTo(target)) { target.delete(); if (!tmp.renameTo(target)) { tmp.delete(); return null } }
        stamp.writeText(want)
        target
    }.getOrNull()
}
