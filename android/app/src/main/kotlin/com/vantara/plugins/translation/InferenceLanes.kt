package com.vantara.plugins.translation
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
/** Individual heavy calls share cores fairly; detector owns its separate small session. */
enum class InferenceWork { DETECT, CONFIRM, HEAVY }
class InferenceLanes {
 private val heavy=ReentrantLock(true)
 fun <T> run(work:InferenceWork,budget:InferenceBudget?=null,block:()->T):T = run(work==InferenceWork.HEAVY,budget,block)
 fun <T> run(expensive:Boolean,budget:InferenceBudget?=null,block:()->T):T {
  if(!expensive) {budget?.check();return block()}
  if(budget==null) heavy.lockInterruptibly()
  else while(true) {
   budget.check()
   if(heavy.tryLock(minOf(25L,maxOf(1L,budget.remainingMs())),TimeUnit.MILLISECONDS)) break
  }
  try {budget?.check();return block()} finally {heavy.unlock()}
 }
}
