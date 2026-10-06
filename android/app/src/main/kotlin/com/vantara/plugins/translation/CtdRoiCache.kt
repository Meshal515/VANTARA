package com.vantara.plugins.translation

/**
 * Bounded memoization for deterministic CTD ROI plans.
 *
 * The key includes the page content hash and the exact canonical crop geometry.
 * We cache the thresholded mask that downstream code actually consumes, never a
 * guessed/downsized approximation. Large sparse plans are deliberately not
 * retained because PackedMask stores the enclosing rectangle.
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

    private val items=object:LinkedHashMap<Key,PackedMask>(maxEntries+1,.75f,true) {
        override fun removeEldestEntry(eldest:MutableMap.MutableEntry<Key,PackedMask>?):Boolean =
            size>maxEntries
    }

    private fun key(pageHash:String,crops:List<Box>):Key =
        Key(pageHash,crops.filter {it.area>0}.sortedWith(compareBy<Box>({it.y1},{it.x1},{it.y2},{it.x2})))

    @Synchronized
    fun get(pageHash:String,crops:List<Box>):PackedMask? = items[key(pageHash,crops)]

    @Synchronized
    fun put(pageHash:String,crops:List<Box>,mask:ByteMask):Boolean {
        if(crops.isEmpty() || CtdRoiDemand.enclosingPixels(crops)>maxEnclosingPixels) return false
        items[key(pageHash,crops)]=PackedMask.of(mask)
        return true
    }

    @Synchronized
    fun clear() = items.clear()
}

/** Geometry-only CTD demand accounting; no page-sized scratch bitmap is allocated. */
internal object CtdRoiDemand {
    fun sourcePixels(crops:List<Box>):Int =
        crops.sumOf {it.area}

    fun enclosingPixels(crops:List<Box>):Int {
        val valid=crops.filter {it.area>0}
        if(valid.isEmpty()) return 0
        val x1=valid.minOf {it.x1};val y1=valid.minOf {it.y1}
        val x2=valid.maxOf {it.x2};val y2=valid.maxOf {it.y2}
        return maxOf(0,x2-x1)*maxOf(0,y2-y1)
    }

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
}
