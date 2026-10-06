package com.vantara.plugins.translation

/**
 * Bounded memoization for deterministic CTD ROI plans.
 *
 * The key includes the page content hash and the exact canonical crop geometry.
 * We cache the thresholded mask that downstream code actually consumes, never a
 * guessed/downsized approximation. Large sparse plans are deliberately not
 * retained because a packed snapshot still owns its enclosing rectangle.
 */
internal class CtdRoiCache(
    private val maxEntries:Int=8,
    private val maxEnclosingPixels:Int=1_200_000,
) {
    private data class Key(val pageHash:String,val crops:List<Box>)

    init {
        require(maxEntries>0)
        require(maxEnclosingPixels>0)
    }

    private val items=object:LinkedHashMap<Key,CtdMaskSnapshot>(maxEntries+1,.75f,true) {
        override fun removeEldestEntry(eldest:MutableMap.MutableEntry<Key,CtdMaskSnapshot>?):Boolean =
            size>maxEntries
    }

    private fun key(pageHash:String,crops:List<Box>):Key =
        Key(pageHash,crops.filter {it.area>0}.sortedWith(compareBy<Box>({it.y1},{it.x1},{it.y2},{it.x2})))

    @Synchronized
    fun get(pageHash:String,crops:List<Box>):CtdMaskSnapshot? = items[key(pageHash,crops)]

    @Synchronized
    fun put(pageHash:String,crops:List<Box>,mask:ByteMask):Boolean {
        val valid=crops.filter {it.area>0}
        if(valid.isEmpty()) return false
        var stored=false
        // Non-overlapping ROI are independent forward passes. Retain each exact
        // thresholded slice so a later one-holder rescue can reuse it even when
        // the original page had multiple heavy ROI.
        if(valid.size>1 && CtdRoiDemand.pairwiseDisjoint(valid)) {
            for(box in valid) {
                if(box.area>maxEnclosingPixels) continue
                items[key(pageHash,listOf(box))]=CtdMaskSnapshot.of(mask,box)
                stored=true
            }
        }
        // Store/touch the complete plan last so singleton aliases cannot evict
        // the most valuable whole-plan entry when the LRU is near capacity.
        if(CtdRoiDemand.enclosingPixels(valid)<=maxEnclosingPixels) {
            items[key(pageHash,valid)]=CtdMaskSnapshot.of(mask,CtdRoiDemand.enclosingBox(valid)!!)
            stored=true
        }
        return stored
    }

    @Synchronized
    fun clear() = items.clear()
}

/**
 * Cache representation packed from already-known ROI geometry. Unlike
 * PackedMask.of(), this never scans the whole page to discover bounds.
 */
internal class CtdMaskSnapshot private constructor(
    private val width:Int,
    private val height:Int,
    private val box:Box,
    private val data:ByteArray,
) {
    fun unpack():ByteMask {
        val out=ByteMask(width,height)
        for(y in 0 until box.h)
            System.arraycopy(data,y*box.w,out.data,(box.y1+y)*width+box.x1,box.w)
        return out
    }

    companion object {
        fun of(mask:ByteMask,box:Box):CtdMaskSnapshot {
            require(box.x1>=0 && box.y1>=0 && box.x2<=mask.width && box.y2<=mask.height)
            val data=ByteArray(box.area)
            for(y in 0 until box.h)
                System.arraycopy(mask.data,(box.y1+y)*mask.width+box.x1,data,y*box.w,box.w)
            return CtdMaskSnapshot(mask.width,mask.height,box,data)
        }
    }
}

/** Geometry-only CTD demand accounting; no page-sized scratch bitmap is allocated. */
internal object CtdRoiDemand {
    fun sourcePixels(crops:List<Box>):Int =
        crops.sumOf {it.area}

    fun enclosingBox(crops:List<Box>):Box? {
        val valid=crops.filter {it.area>0}
        if(valid.isEmpty()) return null
        return Box(
            valid.minOf {it.x1},
            valid.minOf {it.y1},
            valid.maxOf {it.x2},
            valid.maxOf {it.y2},
        )
    }

    fun enclosingPixels(crops:List<Box>):Int = enclosingBox(crops)?.area ?: 0

    fun uniquePixels(crops:List<Box>):Int {
        val valid=crops.filter {it.area>0}
        if(valid.isEmpty()) return 0
        val xs=valid.flatMap {listOf(it.x1,it.x2)}.distinct().sorted()
        var area=0L
        for(i in 0 until xs.lastIndex) {
            val x0=xs[i];val x1=xs[i+1]
            if(x1<=x0) continue
            val spans=valid.asSequence()
                .filter {it.x1<x1 && it.x2>x0}
                .map {it.y1 to it.y2}
                .filter {it.second>it.first}
                .sortedBy {it.first}
                .toList()
            if(spans.isEmpty()) continue
            var y0=spans[0].first;var y1=spans[0].second
            var covered=0L
            for(j in 1 until spans.size) {
                val (a,b)=spans[j]
                if(a<=y1) y1=maxOf(y1,b)
                else {
                    covered+=(y1-y0).toLong()
                    y0=a;y1=b
                }
            }
            covered+=(y1-y0).toLong()
            area+=(x1-x0).toLong()*covered
        }
        return area.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    fun overlapPixels(crops:List<Box>):Int =
        maxOf(0,sourcePixels(crops)-uniquePixels(crops))

    fun pairwiseDisjoint(crops:List<Box>):Boolean {
        for(i in crops.indices) for(j in i+1 until crops.size) {
            val a=crops[i];val b=crops[j]
            if(maxOf(a.x1,b.x1)<minOf(a.x2,b.x2) && maxOf(a.y1,b.y1)<minOf(a.y2,b.y2))
                return false
        }
        return true
    }
}
