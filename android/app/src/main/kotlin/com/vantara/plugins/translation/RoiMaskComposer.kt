package com.vantara.plugins.translation

/**
 * Thresholds ROI-local CTD probabilities without allocating page-sized float/count
 * planes. Overlapping crops are grouped and averaged in their local union exactly
 * like [RoiProbabilities]; disjoint crops are thresholded directly.
 */
internal object RoiMaskComposer {
    private fun overlaps(a:Box,b:Box):Boolean =
        maxOf(a.x1,b.x1)<minOf(a.x2,b.x2) && maxOf(a.y1,b.y1)<minOf(a.y2,b.y2)

    fun threshold(
        width:Int,
        height:Int,
        crops:List<Box>,
        probabilities:List<FloatArray>,
        threshold:Float=.3f,
    ):ByteMask {
        require(crops.size==probabilities.size)
        val out=ByteMask(width,height)
        if(crops.isEmpty()) return out

        val seen=BooleanArray(crops.size)
        for(start in crops.indices) {
            if(seen[start]) continue
            val queue=java.util.ArrayDeque<Int>()
            val component=ArrayList<Int>()
            seen[start]=true
            queue.add(start)
            while(queue.isNotEmpty()) {
                val i=queue.removeFirst()
                component.add(i)
                for(j in crops.indices) {
                    if(seen[j] || !overlaps(crops[i],crops[j])) continue
                    seen[j]=true
                    queue.add(j)
                }
            }
            component.sort()
            if(component.size==1) {
                val i=component[0]
                val b=crops[i]
                val p=probabilities[i]
                require(p.size==b.area)
                var k=0
                for(y in b.y1 until b.y2) for(x in b.x1 until b.x2) {
                    if(x in 0 until width && y in 0 until height && p[k]>threshold)
                        out[x,y]=1
                    k++
                }
                continue
            }

            val boxes=component.map {crops[it]}
            val bounds=boxes.reduce {a,b->a.union(b)}
            val bw=bounds.w
            val bh=bounds.h
            val sum=FloatArray(bw*bh)
            val count=IntArray(bw*bh)
            for(i in component) {
                val b=crops[i]
                val p=probabilities[i]
                require(p.size==b.area)
                var k=0
                for(y in b.y1 until b.y2) for(x in b.x1 until b.x2) {
                    val local=(y-bounds.y1)*bw+(x-bounds.x1)
                    sum[local]+=p[k++]
                    count[local]++
                }
            }
            for(y in bounds.y1 until bounds.y2) for(x in bounds.x1 until bounds.x2) {
                if(x !in 0 until width || y !in 0 until height) continue
                val local=(y-bounds.y1)*bw+(x-bounds.x1)
                val n=count[local]
                if(n>0 && sum[local]/n>threshold) out[x,y]=1
            }
        }
        return out
    }
}
