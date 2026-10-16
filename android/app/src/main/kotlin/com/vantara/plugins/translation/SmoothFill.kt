package com.vantara.plugins.translation

/**
 * E2b — ملء سلس (معادلة لابلاس/الغشاء) من حافة القناع.
 *
 * بين E1 (لون واحد) وE2 (مستوى خطي) وE3 (LaMa) فجوة كبيرة: فقاعة بتدرّج دائري،
 * خلفية لوحة بإضاءة ناعمة، سماء متدرجة. هذه لا يقبلها E1/E2 فتذهب كلها لـLaMa
 * (93% من قناع المسح في تقرير الجهاز). الغشاء يعيد أي حقل سلس من حافته بدقة،
 * وبتكلفة ميلي ثوانٍ بدل ثوانٍ.
 *
 * القبول محافظ ومن البكسلات نفسها، بلا تخمين:
 *   1. الحلقة المعروفة حول القناع ناعمة (لا تنقيط شاشي، لا تهشير، لا خطوط رسم).
 *   2. اختبار حجب: نخفي أول بكسلين من الحلقة، نحلّ المعادلة من الباقي، ونقارن
 *      بالأصل. خطأ متوسط ≤ [MAX_MAE] ونسبة شواذ ≤ 5% وإلا LaMa كما كان.
 * ما خارج القناع لا يُكتب أبدًا.
 */
object SmoothFill {
    const val MARGIN = 10
    const val MAX_MAE = 4.0
    const val OUTLIER = 12.0
    const val MAX_RING_ROUGHNESS = 2.6
    private const val MAX_ITER = 600
    private const val TOLERANCE = 0.1
    private const val COARSE_MIN = 1500

    /**
     * Pixels that may serve as boundary evidence, stored only around the mask.
     * `ok` is local to [x0,y0,x1,y1); outside it nothing is known.
     */
    class Support(val x0: Int, val y0: Int, val x1: Int, val y1: Int, val ok: ByteArray) {
        val w get() = x1 - x0
        /** Hold-out solution from [admit]; warm-starts [apply] (same window, superset domain). */
        internal var warm: FloatArray? = null
        operator fun get(x: Int, y: Int): Boolean =
            x in x0 until x1 && y in y0 until y1 && ok[(y - y0) * w + (x - x0)].toInt() != 0
    }

    data class Verdict(val admitted: Boolean, val reason: String, val mae: Double = 0.0, val roughness: Double = 0.0)

    /**
     * `allowed`: where evidence may be sampled (bubble interior); null = anywhere.
     * `forbidden`: never evidence (other text, own glyph core); may be null.
     */
    fun support(mask: ByteMask, allowed: ByteMask?, forbidden: ByteMask?, margin: Int = MARGIN): Support? {
        val b = mask.bounds() ?: return null
        val x0 = maxOf(0, b[0] - margin); val y0 = maxOf(0, b[1] - margin)
        val x1 = minOf(mask.width, b[2] + margin); val y1 = minOf(mask.height, b[3] + margin)
        val w = x1 - x0
        val ok = ByteArray(w * (y1 - y0))
        for (y in y0 until y1) for (x in x0 until x1) {
            if (allowed != null && allowed[x, y].toInt() == 0) continue
            if (forbidden != null && forbidden[x, y].toInt() != 0) continue
            ok[(y - y0) * w + (x - x0)] = 1
        }
        return Support(x0, y0, x1, y1, ok)
    }

    /** Same evidence window at full-file resolution (nearest sampling), for the fullRes pass. */
    fun scaled(s: Support, kx: Float, ky: Float, bigW: Int, bigH: Int): Support {
        val x0 = (s.x0 * kx).toInt().coerceIn(0, bigW); val y0 = (s.y0 * ky).toInt().coerceIn(0, bigH)
        val x1 = minOf(bigW, Math.ceil(s.x1 * kx.toDouble()).toInt()); val y1 = minOf(bigH, Math.ceil(s.y1 * ky.toDouble()).toInt())
        val w = maxOf(0, x1 - x0)
        val ok = ByteArray(w * maxOf(0, y1 - y0))
        for (y in y0 until y1) for (x in x0 until x1) {
            if (s[(x / kx).toInt(), (y / ky).toInt()]) ok[(y - y0) * w + (x - x0)] = 1
        }
        return Support(x0, y0, x1, y1, ok)
    }

    /** Admission test. Never mutates `img`. */
    fun admit(img: RgbImage, mask: ByteMask, support: Support): Verdict {
        val w = support.w; val h = support.y1 - support.y0
        val unknown = BooleanArray(w * h)
        var unknownN = 0
        for (y in support.y0 until support.y1) for (x in support.x0 until support.x1) {
            if (mask[x, y].toInt() != 0) { unknown[(y - support.y0) * w + (x - support.x0)] = true; unknownN++ }
        }
        if (unknownN == 0) return Verdict(false, "empty")
        // Rings measured in local coordinates (Chebyshev distance to the mask).
        val dist = chebyshev(unknown, w, h, 7)
        val ringNear = ArrayList<Int>()   // 1..2: held out for validation
        val ringAll = ArrayList<Int>()    // 1..6: roughness evidence
        for (i in unknown.indices) {
            val d = dist[i]
            if (d in 1..6 && support.ok[i].toInt() != 0) {
                ringAll.add(i)
                if (d <= 2) ringNear.add(i)
            }
        }
        if (ringNear.size < 24 || ringAll.size < 60) return Verdict(false, "ring_small")
        // The ring must enclose the mask: evidence on too few sides extrapolates.
        if (ringNear.size * 4 < perimeter(unknown, w, h)) return Verdict(false, "ring_open")
        val rough = roughness(img, support, ringAll)
        if (rough > MAX_RING_ROUGHNESS) return Verdict(false, "textured", roughness = rough)

        // Hold-out: hide the near ring, solve from the remaining evidence.
        val hidden = unknown.copyOf()
        for (i in ringNear) hidden[i] = true
        val solved = solve(img, support, hidden) ?: return Verdict(false, "unbounded", roughness = rough)
        var err = 0.0; var outliers = 0
        for (i in ringNear) {
            val x = support.x0 + i % w; val y = support.y0 + i / w
            val e = (Math.abs(solved[i * 3] - img.r(x, y)) + Math.abs(solved[i * 3 + 1] - img.g(x, y)) + Math.abs(solved[i * 3 + 2] - img.b(x, y))) / 3.0
            err += e
            if (e > OUTLIER) outliers++
        }
        val mae = err / ringNear.size
        if (mae > MAX_MAE || outliers > maxOf(2, ringNear.size / 20)) return Verdict(false, "holdout", mae, rough)
        support.warm = solved
        return Verdict(true, "ok", mae, rough)
    }

    /** Writes the membrane solution into masked pixels only. Returns changed pixels, or -1 if unsolvable. */
    fun apply(img: RgbImage, mask: ByteMask, support: Support): Int {
        val b = mask.bounds() ?: return 0
        // A repair-expanded mask must still lie inside the evidence window; otherwise
        // some masked pixels would silently stay unerased.
        if (b[0] < support.x0 || b[1] < support.y0 || b[2] > support.x1 || b[3] > support.y1) return -1
        val w = support.w; val h = support.y1 - support.y0
        val unknown = BooleanArray(w * h)
        for (y in support.y0 until support.y1) for (x in support.x0 until support.x1)
            if (mask[x, y].toInt() != 0) unknown[(y - support.y0) * w + (x - support.x0)] = true
        val solved = solve(img, support, unknown, support.warm) ?: return -1
        var changed = 0
        for (i in unknown.indices) {
            if (!unknown[i]) continue
            val x = support.x0 + i % w; val y = support.y0 + i / w
            val p = (y * img.width + x) * 3
            val r = Math.round(solved[i * 3]).toInt().coerceIn(0, 255)
            val g = Math.round(solved[i * 3 + 1]).toInt().coerceIn(0, 255)
            val b = Math.round(solved[i * 3 + 2]).toInt().coerceIn(0, 255)
            if ((img.data[p].toInt() and 0xff) != r || (img.data[p + 1].toInt() and 0xff) != g || (img.data[p + 2].toInt() and 0xff) != b) changed++
            img.data[p] = r.toByte(); img.data[p + 1] = g.toByte(); img.data[p + 2] = b.toByte()
        }
        return changed
    }

    /**
     * Membrane interpolation: unknown pixels relax to the mean of their usable
     * 4-neighbours (unknown or known evidence); pixels with neither are Neumann.
     * Initialised by a two-pass nearest-evidence fill, then SOR. Null when an
     * unknown component touches no evidence (would invent colour).
     */
    private fun solve(img: RgbImage, s: Support, unknown: BooleanArray, init: FloatArray? = null): FloatArray? {
        val w = s.w; val h = s.y1 - s.y0
        val v = FloatArray(w * h * 3)
        val known = BooleanArray(w * h) { !unknown[it] && s.ok[it].toInt() != 0 }
        for (i in known.indices) if (known[i]) {
            val x = s.x0 + i % w; val y = s.y0 + i / w
            v[i * 3] = img.r(x, y).toFloat(); v[i * 3 + 1] = img.g(x, y).toFloat(); v[i * 3 + 2] = img.b(x, y).toFloat()
        }
        return if (solveArrays(w, h, unknown, known, v, init)) v else null
    }

    /**
     * In-place membrane solve on local arrays. Coarse-to-fine: large domains are
     * first solved on a 2× coarser grid (recursively) and upsampled as the initial
     * guess, so the fine SOR only removes high-frequency error. False when an unknown
     * component touches no evidence.
     */
    private fun solveArrays(w: Int, h: Int, unknown: BooleanArray, known: BooleanArray, v: FloatArray, init: FloatArray?): Boolean {
        val reached = BooleanArray(w * h)
        val queue = IntArray(w * h)
        var head = 0; var tail = 0
        for (i in known.indices) if (known[i]) { reached[i] = true; queue[tail++] = i }
        // Breadth-first nearest-evidence initialisation through unknown pixels.
        while (head < tail) {
            val i = queue[head++]
            val x = i % w; val y = i / w
            for (k in 0 until 4) {
                val nx = x + DX[k]; val ny = y + DY[k]
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
                val j = ny * w + nx
                if (reached[j] || !unknown[j]) continue
                reached[j] = true
                v[j * 3] = v[i * 3]; v[j * 3 + 1] = v[i * 3 + 1]; v[j * 3 + 2] = v[i * 3 + 2]
                queue[tail++] = j
            }
        }
        var count = 0
        for (i in unknown.indices) if (unknown[i]) { if (!reached[i]) return false; count++ }
        val order = IntArray(count)
        run { var k = 0; for (i in unknown.indices) if (unknown[i]) order[k++] = i }
        if (init != null && init.size == v.size) {
            for (i in order) { v[i * 3] = init[i * 3]; v[i * 3 + 1] = init[i * 3 + 1]; v[i * 3 + 2] = init[i * 3 + 2] }
        } else if (count > COARSE_MIN && w >= 8 && h >= 8) {
            val cw = (w + 1) / 2; val ch = (h + 1) / 2
            val cu = BooleanArray(cw * ch); val ck = BooleanArray(cw * ch)
            val cv = FloatArray(cw * ch * 3); val cn = IntArray(cw * ch)
            for (i in unknown.indices) {
                val c = (i / w / 2) * cw + (i % w) / 2
                if (unknown[i]) cu[c] = true
                else if (known[i]) { cv[c * 3] += v[i * 3]; cv[c * 3 + 1] += v[i * 3 + 1]; cv[c * 3 + 2] += v[i * 3 + 2]; cn[c]++ }
            }
            for (c in cu.indices) if (!cu[c] && cn[c] > 0) {
                ck[c] = true; cv[c * 3] /= cn[c]; cv[c * 3 + 1] /= cn[c]; cv[c * 3 + 2] /= cn[c]
            }
            if (solveArrays(cw, ch, cu, ck, cv, null)) for (i in order) {
                val c = (i / w / 2) * cw + (i % w) / 2
                v[i * 3] = cv[c * 3]; v[i * 3 + 1] = cv[c * 3 + 1]; v[i * 3 + 2] = cv[c * 3 + 2]
            }
        }
        val omega = 1.9f
        for (iter in 0 until MAX_ITER) {
            var maxDelta = 0f
            for (i in order) {
                val x = i % w; val y = i / w
                var sr = 0f; var sg = 0f; var sb = 0f; var n = 0
                for (k in 0 until 4) {
                    val nx = x + DX[k]; val ny = y + DY[k]
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
                    val j = ny * w + nx
                    if (!unknown[j] && !known[j]) continue
                    sr += v[j * 3]; sg += v[j * 3 + 1]; sb += v[j * 3 + 2]; n++
                }
                if (n == 0) continue
                val o = i * 3
                val dr = sr / n - v[o]; val dg = sg / n - v[o + 1]; val db = sb / n - v[o + 2]
                v[o] += omega * dr; v[o + 1] += omega * dg; v[o + 2] += omega * db
                maxDelta = maxOf(maxDelta, Math.abs(dr), Math.abs(dg), Math.abs(db))
            }
            if (maxDelta < TOLERANCE) break
        }
        return true
    }

    /** Mean absolute deviation of each ring pixel from its known 3×3 neighbours. */
    private fun roughness(img: RgbImage, s: Support, ring: List<Int>): Double {
        val w = s.w
        var total = 0.0; var n = 0
        for (i in ring) {
            val x = s.x0 + i % w; val y = s.y0 + i / w
            var sr = 0; var sg = 0; var sb = 0; var c = 0
            for (dy in -1..1) for (dx in -1..1) {
                if (dx == 0 && dy == 0) continue
                val nx = x + dx; val ny = y + dy
                if (!s[nx, ny]) continue
                sr += img.r(nx, ny); sg += img.g(nx, ny); sb += img.b(nx, ny); c++
            }
            if (c < 3) continue
            total += (Math.abs(img.r(x, y) - sr.toDouble() / c) + Math.abs(img.g(x, y) - sg.toDouble() / c) + Math.abs(img.b(x, y) - sb.toDouble() / c)) / 3.0
            n++
        }
        return if (n == 0) 99.0 else total / n
    }

    private fun perimeter(unknown: BooleanArray, w: Int, h: Int): Int {
        var n = 0
        for (i in unknown.indices) {
            if (!unknown[i]) continue
            val x = i % w; val y = i / w
            for (k in 0 until 4) {
                val nx = x + DX[k]; val ny = y + DY[k]
                if (nx < 0 || ny < 0 || nx >= w || ny >= h || !unknown[ny * w + nx]) { n++; break }
            }
        }
        return n
    }

    /** Chebyshev distance to the set, capped. 0 inside. */
    private fun chebyshev(set: BooleanArray, w: Int, h: Int, cap: Int): IntArray {
        val d = IntArray(w * h) { if (set[it]) 0 else cap }
        // Two-pass chamfer with unit diagonal weight = Chebyshev.
        for (y in 0 until h) for (x in 0 until w) {
            var best = d[y * w + x]
            if (best == 0) continue
            if (x > 0) best = minOf(best, d[y * w + x - 1] + 1)
            if (y > 0) {
                best = minOf(best, d[(y - 1) * w + x] + 1)
                if (x > 0) best = minOf(best, d[(y - 1) * w + x - 1] + 1)
                if (x < w - 1) best = minOf(best, d[(y - 1) * w + x + 1] + 1)
            }
            d[y * w + x] = best
        }
        for (y in h - 1 downTo 0) for (x in w - 1 downTo 0) {
            var best = d[y * w + x]
            if (best == 0) continue
            if (x < w - 1) best = minOf(best, d[y * w + x + 1] + 1)
            if (y < h - 1) {
                best = minOf(best, d[(y + 1) * w + x] + 1)
                if (x < w - 1) best = minOf(best, d[(y + 1) * w + x + 1] + 1)
                if (x > 0) best = minOf(best, d[(y + 1) * w + x - 1] + 1)
            }
            d[y * w + x] = best
        }
        return d
    }

    private val DX = intArrayOf(1, -1, 0, 0)
    private val DY = intArrayOf(0, 0, 1, -1)
}
