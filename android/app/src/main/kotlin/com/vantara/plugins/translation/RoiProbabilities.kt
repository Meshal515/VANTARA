package com.vantara.plugins.translation

/** Same averaging rule as full-width tiles; crop order cannot overwrite overlap. */
internal class RoiProbabilities(private val width:Int,private val height:Int) {
    private val out=FloatArray(width*height)
    private val count=IntArray(width*height)
    private var normalized=false
    fun add(box:Box,prob:FloatArray) {
        check(!normalized)
        require(box.x1>=0 && box.y1>=0 && box.x2<=width && box.y2<=height && prob.size==box.area)
        for(y in 0 until box.h) for(x in 0 until box.w) {
            val i=(box.y1+y)*width+box.x1+x
            out[i]+=prob[y*box.w+x];count[i]++
        }
    }
    fun finish():FloatArray {
        if(!normalized) {for(i in out.indices) if(count[i]>0) out[i]/=count[i];normalized=true}
        return out
    }
}
