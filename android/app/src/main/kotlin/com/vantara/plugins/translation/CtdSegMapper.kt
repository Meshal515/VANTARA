package com.vantara.plugins.translation

/**
 * Exact CTD seg-plane bilinear remap with coordinate terms precomputed once.
 *
 * Arithmetic inside the interpolation expression is deliberately kept in the
 * same order as the legacy per-pixel loop so threshold-adjacent floats remain
 * bit identical.
 */
internal object CtdSegMapper {
    fun map(
        plane:Array<FloatArray>,
        nw:Int,
        nh:Int,
        outW:Int,
        outH:Int,
    ):FloatArray {
        require(nw>0 && nh>0 && outW>0 && outH>0)
        val xa=IntArray(outW)
        val xb=IntArray(outW)
        val wx=FloatArray(outW)
        for(x in 0 until outW) {
            val fx=((x+.5f)*nw/outW-.5f).coerceIn(0f,(nw-1).toFloat())
            xa[x]=fx.toInt()
            xb[x]=minOf(nw-1,xa[x]+1)
            wx[x]=fx-xa[x]
        }

        val ya=IntArray(outH)
        val yb=IntArray(outH)
        val wy=FloatArray(outH)
        for(y in 0 until outH) {
            val fy=((y+.5f)*nh/outH-.5f).coerceIn(0f,(nh-1).toFloat())
            ya[y]=fy.toInt()
            yb[y]=minOf(nh-1,ya[y]+1)
            wy[y]=fy-ya[y]
        }

        val mapped=FloatArray(outW*outH)
        for(y in 0 until outH) {
            val ay=ya[y];val by=yb[y];val yw=wy[y]
            for(x in 0 until outW) {
                val ax=xa[x];val bx=xb[x];val xw=wx[x]
                mapped[y*outW+x]=
                    (plane[ay][ax]*(1-xw)+plane[ay][bx]*xw)*(1-yw)+
                    (plane[by][ax]*(1-xw)+plane[by][bx]*xw)*yw
            }
        }
        return mapped
    }
}
