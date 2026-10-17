package com.vantara.plugins.translation
/** Individual heavy calls share cores fairly; detector owns its separate small session. */
enum class InferenceWork { DETECT, CONFIRM, HEAVY }
/**
 * One model call owns the CPU at a time (S23: RT-DETR beside CTD/BubbleSeg created
 * 8–30s oversubscription spikes). The owner is chosen by reader priority, not FIFO:
 * [PriorityGate.run] publishes the caller's live priority in [priority], so the visible
 * page's next model call waits for at most the one call already running — never for a
 * whole queued Analyze/Render of a page further away.
 */
class InferenceLanes {
 companion object {
  /** Lower = sooner. Read at grant time so a focus change re-orders waiting calls. */
  val priority = ThreadLocal<(() -> Long)?>()
  private const val UNRANKED = Long.MAX_VALUE / 2
 }
 private class Waiter(val key:()->Long,val seq:Long) {var granted=false}
 private val monitor=Object()
 private val waiters=ArrayList<Waiter>()
 private var held=false
 private var seq=0L
 fun <T> run(work:InferenceWork,budget:InferenceBudget?=null,block:()->T):T {
  // OCR confirmation is tiny and may run while a model owns the CPU. RT-DETR is not.
  if(work==InferenceWork.CONFIRM) {budget?.check();return block()}
  return runCompute(budget,block)
 }
 fun <T> run(expensive:Boolean,budget:InferenceBudget?=null,block:()->T):T =
  if(expensive) run(InferenceWork.HEAVY,budget,block) else run(InferenceWork.DETECT,budget,block)
 private fun grantNextLocked() {
  var best:Waiter?=null; var bestKey=0L
  for(w in waiters) {
   val k=runCatching {w.key()}.getOrDefault(UNRANKED)
   if(best==null || k<bestKey || (k==bestKey && w.seq<best.seq)) {best=w;bestKey=k}
  }
  if(best==null) {held=false;return}
  waiters.remove(best); best.granted=true
  monitor.notifyAll()
 }
 private fun <T> runCompute(budget:InferenceBudget?,block:()->T):T {
  synchronized(monitor) {
   val me=Waiter(priority.get() ?: {UNRANKED},seq++)
   if(!held) {held=true;me.granted=true} else waiters.add(me)
   while(!me.granted) {
    try {
     budget?.check()
     monitor.wait(if(budget==null) 0L else minOf(25L,maxOf(1L,budget.remainingMs())))
    } catch(e:Throwable) {
     if(me.granted) grantNextLocked() else waiters.remove(me)
     throw e
    }
   }
  }
  try {budget?.check();return block()} finally {synchronized(monitor) {grantNextLocked()}}
 }
}
