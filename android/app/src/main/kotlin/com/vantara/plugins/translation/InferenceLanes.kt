package com.vantara.plugins.translation
import java.util.concurrent.locks.ReentrantLock
/** Individual heavy calls share cores fairly; detector owns its separate small session. */
enum class InferenceWork { DETECT, CONFIRM, HEAVY }
class InferenceLanes {
 fun <T> run(work:InferenceWork,block:()->T):T = run(work==InferenceWork.HEAVY,block)
 private val heavy=ReentrantLock(true)
 fun <T> run(expensive:Boolean,block:()->T):T {
  if(!expensive) return block()
  heavy.lockInterruptibly()
  try {return block()} finally {heavy.unlock()}
 }
}
