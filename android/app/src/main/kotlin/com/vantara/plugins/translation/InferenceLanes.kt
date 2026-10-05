package com.vantara.plugins.translation
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
/** Individual heavy calls share cores fairly; detector owns its separate small session. */
enum class InferenceWork { DETECT, CONFIRM, HEAVY }
class InferenceLanes {
 private val compute=ReentrantLock(true)
 fun <T> run(work:InferenceWork,budget:InferenceBudget?=null,block:()->T):T {
  // OCR confirmation is tiny and may run while a model owns the CPU. RT-DETR is not:
  // on S23 the detector plus CTD/BubbleSeg created 8–30s oversubscription spikes.
  if(work==InferenceWork.CONFIRM) {budget?.check();return block()}
  return runCompute(budget,block)
 }
 fun <T> run(expensive:Boolean,budget:InferenceBudget?=null,block:()->T):T =
  if(expensive) run(InferenceWork.HEAVY,budget,block) else run(InferenceWork.DETECT,budget,block)
 private fun <T> runCompute(budget:InferenceBudget?,block:()->T):T {
  if(budget==null) compute.lockInterruptibly()
  else while(true) {
   budget.check()
   if(compute.tryLock(minOf(25L,maxOf(1L,budget.remainingMs())),TimeUnit.MILLISECONDS)) break
  }
  try {budget?.check();return block()} finally {compute.unlock()}
 }
}
