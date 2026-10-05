package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CancellationException
class RefinementWaitTest {
 @Test fun `expired refinement exits heavy lock wait while analysis still owns lane`() {
  val lanes=InferenceLanes();val owned=CountDownLatch(1);val release=CountDownLatch(1);val done=CountDownLatch(1)
  val analysis=Thread {lanes.run(true) {owned.countDown();release.await()}};analysis.start()
  assertTrue(owned.await(1,TimeUnit.SECONDS))
  var failed=false;val refinement=Thread {
   try {lanes.run(true,InferenceBudget(75)) {fail("expired refinement entered inference")}}
   catch(e:CancellationException) {failed=true} finally {done.countDown()}
  };refinement.start()
  try {assertTrue("refinement must free owner before heavy analysis releases",done.await(1,TimeUnit.SECONDS));assertTrue(failed)}
  finally {release.countDown();analysis.join(1000);refinement.join(1000)}
 }
}
