package com.vantara.plugins.translation
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
class InferenceLaneTest {
 @Test fun `detector cannot oversubscribe CPU while heavy inference owns the compute lane`() {
  val lanes=InferenceLanes();val entered=CountDownLatch(1);val release=CountDownLatch(1);val detected=CountDownLatch(1);val other=CountDownLatch(1)
  val a=thread {lanes.run(InferenceWork.HEAVY) {entered.countDown();release.await()}}
  assertTrue(entered.await(1,TimeUnit.SECONDS))
  val b=thread {lanes.run(InferenceWork.HEAVY) {other.countDown()}}
  val c=thread {lanes.run(InferenceWork.DETECT) {detected.countDown()}}
  assertFalse(detected.await(100,TimeUnit.MILLISECONDS));assertEquals(1,other.count)
  release.countDown();a.join();b.join();c.join()
  assertEquals(0,other.count);assertEquals(0,detected.count)
 }
 @Test fun `missing text confirmation remains independent while a heavy inference is held`() {
  val lanes=InferenceLanes();val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
  val held=java.util.concurrent.CountDownLatch(1);val release=java.util.concurrent.CountDownLatch(1)
  try {
   val heavy=pool.submit {lanes.run(InferenceWork.HEAVY) {held.countDown();release.await()}}
   assertTrue(held.await(1,java.util.concurrent.TimeUnit.SECONDS))
   val confirm=pool.submit<Int> {lanes.run(InferenceWork.CONFIRM) {7}}
   assertEquals(7,confirm.get(1,java.util.concurrent.TimeUnit.SECONDS))
   release.countDown();heavy.get(1,java.util.concurrent.TimeUnit.SECONDS)
  } finally {release.countDown();pool.shutdownNow()}
 }
}
