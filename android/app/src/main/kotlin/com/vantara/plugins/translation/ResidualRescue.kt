package com.vantara.plugins.translation

/** Only already-failed regions: repair the whole holder instead of reusing a missed text box. */
internal object ResidualRescue {
    fun detections(targets:List<Pipeline.Snapshot>):List<Detection> {
        val detections=ArrayList<Detection>()
        for((scope,group) in targets.groupBy {it.bubbleBox ?: it.box}) {
            val hasHolder=group.any {it.bubbleBox!=null}
            detections.add(Detection(scope,group.maxOf {it.score},if(hasHolder) "text_bubble" else "text_free"))
            if(hasHolder) detections.add(Detection(scope,.95f,"bubble"))
        }
        return detections
    }
}
