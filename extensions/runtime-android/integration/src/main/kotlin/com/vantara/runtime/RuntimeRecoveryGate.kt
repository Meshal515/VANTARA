package com.vantara.runtime

/**
 * Bounded per-source, per-revision fault gate. Three reproducible failures in
 * two minutes allow ONE old-version health comparison. A ten-minute cooldown
 * prevents request storms if both publisher versions have a broken website.
 */
internal class RuntimeRecoveryGate(
    private val threshold:Int=3,
    private val windowMs:Long=120_000L,
    private val cooldownMs:Long=600_000L,
) {
    private data class Failure(var count:Int,var started:Long,var nextProbe:Long)
    private val attempts=HashMap<String,Failure>()
    @Synchronized fun onFailure(key:String,now:Long):Boolean {
        require(key.isNotBlank()&&now>=0)
        val row=attempts.getOrPut(key) { Failure(0,now,0) }
        if(now-row.started>windowMs) {row.count=0;row.started=now}
        if(now<row.nextProbe)return false
        row.count++
        if(row.count<threshold)return false
        row.count=0
        row.started=now
        row.nextProbe=now+cooldownMs
        return true
    }
    @Synchronized fun onSuccess(key:String){attempts.remove(key)}
    @Synchronized fun clear(){attempts.clear()}
}
