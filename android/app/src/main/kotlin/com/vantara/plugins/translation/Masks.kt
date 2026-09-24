package com.vantara.plugins.translation

import java.util.ArrayDeque

/**
 * قناع ثنائي (بايت لكل بكسل، 0 أو 1) وعملياته: توسيع، تآكل، مكوّنات متصلة،
 * عتبة Otsu، أوتار الصفوف. كل ما كان يفعله OpenCV في العامل، بلا OpenCV:
 * الـAPK لا يحمل 20MB زائدة لأجل أربع دوال.
 */
class ByteMask(val width: Int, val height: Int, val data: ByteArray = ByteArray(width * height)) {

    operator fun get(x: Int, y: Int): Byte = data[y * width + x]
    operator fun set(x: Int, y: Int, v: Byte) {
        data[y * width + x] = v
    }

    fun count(): Int {
        var n = 0
        for (b in data) if (b.toInt() != 0) n++
        return n
    }

    fun any(): Boolean = data.any { it.toInt() != 0 }

    fun copy(): ByteMask = ByteMask(width, height, data.copyOf())

    fun fill(v: Byte) = data.fill(v)

    fun and(other: ByteMask): ByteMask {
        val out = ByteMask(width, height)
        for (i in data.indices) if (data[i].toInt() != 0 && other.data[i].toInt() != 0) out.data[i] = 1
        return out
    }

    fun or(other: ByteMask): ByteMask {
        val out = ByteMask(width, height)
        for (i in data.indices) if (data[i].toInt() != 0 || other.data[i].toInt() != 0) out.data[i] = 1
        return out
    }

    fun not(): ByteMask {
        val out = ByteMask(width, height)
        for (i in data.indices) if (data[i].toInt() == 0) out.data[i] = 1
        return out
    }

    /** يُبقي ما داخل المستطيل فقط. */
    fun clipped(x0: Int, y0: Int, x1: Int, y1: Int): ByteMask {
        val out = ByteMask(width, height)
        for (y in maxOf(0, y0) until minOf(height, y1)) for (x in maxOf(0, x0) until minOf(width, x1)) out.data[y * width + x] = data[y * width + x]
        return out
    }

    fun fillRect(x0: Int, y0: Int, x1: Int, y1: Int, v: Byte = 1) {
        for (y in maxOf(0, y0) until minOf(height, y1)) for (x in maxOf(0, x0) until minOf(width, x1)) data[y * width + x] = v
    }

    /** توسيع مربّع بنصف قطر `r` (مرشّح أقصى قابل للفصل: صفوف ثم أعمدة). */
    fun dilate(r: Int): ByteMask = if (r <= 0) copy() else separable(r, true)

    fun erode(r: Int): ByteMask = if (r <= 0) copy() else separable(r, false)

    private fun separable(r: Int, max: Boolean): ByteMask {
        val tmp = ByteMask(width, height)
        val bg: Byte = if (max) 0 else 1
        for (y in 0 until height) {
            val row = y * width
            for (x in 0 until width) {
                var v = bg
                val a = maxOf(0, x - r)
                val b = minOf(width - 1, x + r)
                if (max) {
                    for (i in a..b) if (data[row + i].toInt() != 0) { v = 1; break }
                } else {
                    for (i in a..b) if (data[row + i].toInt() == 0) { v = 0; break }
                    if (v.toInt() == 1 && (x - r < 0 || x + r >= width)) v = 0 // خارج الصورة = خلفية
                }
                tmp.data[row + x] = v
            }
        }
        val out = ByteMask(width, height)
        for (x in 0 until width) for (y in 0 until height) {
            var v = bg
            val a = maxOf(0, y - r)
            val b = minOf(height - 1, y + r)
            if (max) {
                for (j in a..b) if (tmp.data[j * width + x].toInt() != 0) { v = 1; break }
            } else {
                for (j in a..b) if (tmp.data[j * width + x].toInt() == 0) { v = 0; break }
                if (v.toInt() == 1 && (y - r < 0 || y + r >= height)) v = 0
            }
            out.data[y * width + x] = v
        }
        return out
    }

    /** إغلاق مورفولوجي: توسيع ثم تآكل. */
    fun close(r: Int): ByteMask = dilate(r).erode(r)

    fun open(r: Int): ByteMask = erode(r).dilate(r)

    data class Component(val label: Int, val x0: Int, val y0: Int, val x1: Int, val y1: Int, val area: Int)

    /** مكوّنات متصلة (4 أو 8 جوار). يرجع خريطة التسميات وقائمة المكوّنات. */
    fun components(eight: Boolean = true): Pair<IntArray, List<Component>> {
        val labels = IntArray(width * height)
        val out = ArrayList<Component>()
        val queue = ArrayDeque<Int>()
        var next = 0
        for (start in data.indices) {
            if (data[start].toInt() == 0 || labels[start] != 0) continue
            next++
            var x0 = width; var y0 = height; var x1 = -1; var y1 = -1; var area = 0
            labels[start] = next
            queue.add(start)
            while (queue.isNotEmpty()) {
                val p = queue.poll()
                val x = p % width
                val y = p / width
                area++
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
                for (dy in -1..1) for (dx in -1..1) {
                    if (dx == 0 && dy == 0) continue
                    if (!eight && dx != 0 && dy != 0) continue
                    val nx = x + dx; val ny = y + dy
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
                    val q = ny * width + nx
                    if (data[q].toInt() != 0 && labels[q] == 0) {
                        labels[q] = next
                        queue.add(q)
                    }
                }
            }
            out.add(Component(next, x0, y0, x1 + 1, y1 + 1, area))
        }
        return labels to out
    }

    /** أكبر مكوّن وحده (فقاعة واحدة = مكوّن واحد). */
    fun largestComponent(): ByteMask {
        val (labels, comps) = components(true)
        val best = comps.maxByOrNull { it.area } ?: return ByteMask(width, height)
        val out = ByteMask(width, height)
        for (i in labels.indices) if (labels[i] == best.label) out.data[i] = 1
        return out
    }

    /** ملء الثقوب: كل ما لا يصل إلى حافة الصورة عبر الخلفية يُعدّ داخلًا. */
    fun filledHoles(): ByteMask {
        val outside = ByteMask(width, height)
        val queue = ArrayDeque<Int>()
        fun seed(p: Int) {
            if (data[p].toInt() == 0 && outside.data[p].toInt() == 0) { outside.data[p] = 1; queue.add(p) }
        }
        for (x in 0 until width) { seed(x); seed((height - 1) * width + x) }
        for (y in 0 until height) { seed(y * width); seed(y * width + width - 1) }
        while (queue.isNotEmpty()) {
            val p = queue.poll()
            val x = p % width; val y = p / width
            if (x > 0) seed(p - 1); if (x < width - 1) seed(p + 1); if (y > 0) seed(p - width); if (y < height - 1) seed(p + width)
        }
        val out = ByteMask(width, height)
        for (i in data.indices) if (outside.data[i].toInt() == 0) out.data[i] = 1
        return out
    }

    fun bounds(): IntArray? {
        var x0 = width; var y0 = height; var x1 = -1; var y1 = -1
        for (y in 0 until height) for (x in 0 until width) if (data[y * width + x].toInt() != 0) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
        }
        return if (x1 < 0) null else intArrayOf(x0, y0, x1 + 1, y1 + 1)
    }

    /** أطول امتداد أفقي داخل القناع عند الصف `y` يحتوي `cx` (أو الأقرب إليه). */
    fun chord(y: Int, cx: Int): IntArray? {
        if (y < 0 || y >= height) return null
        val row = y * width
        var bestA = -1; var bestB = -1; var bestDist = Int.MAX_VALUE
        var x = 0
        while (x < width) {
            if (data[row + x].toInt() == 0) { x++; continue }
            val a = x
            while (x < width && data[row + x].toInt() != 0) x++
            val b = x - 1
            val dist = if (cx in a..b) 0 else minOf(Math.abs(a - cx), Math.abs(b - cx))
            if (dist < bestDist) { bestDist = dist; bestA = a; bestB = b }
        }
        return if (bestA < 0) null else intArrayOf(bestA, bestB)
    }

    companion object {
        /** عتبة Otsu على صورة رمادية داخل مستطيل؛ `light` = الحبر فاتح (فوق العتبة). */
        fun otsu(gray: ByteArray, width: Int, x0: Int, y0: Int, x1: Int, y1: Int): Int {
            val hist = IntArray(256)
            var total = 0
            for (y in y0 until y1) for (x in x0 until x1) { hist[gray[y * width + x].toInt() and 0xff]++; total++ }
            if (total == 0) return 128
            var sum = 0.0
            for (i in 0 until 256) sum += i.toDouble() * hist[i]
            var sumB = 0.0; var wB = 0; var best = 0.0; var thr = 128
            for (i in 0 until 256) {
                wB += hist[i]
                if (wB == 0) continue
                val wF = total - wB
                if (wF == 0) break
                sumB += i.toDouble() * hist[i]
                val mB = sumB / wB
                val mF = (sum - sumB) / wF
                val between = wB.toDouble() * wF * (mB - mF) * (mB - mF)
                if (between > best) { best = between; thr = i }
            }
            return thr
        }
    }
}
