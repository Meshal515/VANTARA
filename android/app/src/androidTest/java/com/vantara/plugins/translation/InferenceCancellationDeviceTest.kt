package com.vantara.plugins.translation

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Runs an actual ONNX Loop, terminates it via RunOptions, then reuses the same session. */
@RunWith(AndroidJUnit4::class)
class InferenceCancellationDeviceTest {
    @Test fun terminationExitsNativeBeforeNextRunAndKeepsSharedSessionHealthy() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val file=File(instrumentation.targetContext.cacheDir,"cancellation-loop-test.onnx")
        instrumentation.context.assets.open("cancel-loop.onnx").use { input -> file.outputStream().use { input.copyTo(it) } }
        val owner=InferenceBudget(200)
        Ort.open(file,engine=Ort.Engine("test-cpu",2,0,false)).use { session ->
            val matrix=FloatArray(128*128) { if (it/128==it%128) 1f else 0f }
            val began=System.nanoTime()
            var terminated=false
            try {
                Ort.withBudget(owner) {
                    Ort.run(session,mapOf("x" to Ort.tensor(matrix,128,128),"count" to Ort.tensor(longArrayOf(1000000)))).use { error("expensive loop unexpectedly completed") }
                }
            } catch (_: ai.onnxruntime.OrtException) { terminated=true }
              catch (_: java.util.concurrent.CancellationException) { terminated=true }
            assertTrue(terminated)
            assertTrue("native loop failed to exit its deadline",(System.nanoTime()-began)/1_000_000 < 3000)
            assertEquals(0,owner.activeRuns())
            // Zero iterations returns the same matrix using the very same session, not a replacement.
            Ort.withBudget(InferenceBudget(1000)) {
                Ort.run(session,mapOf("x" to Ort.tensor(matrix,128,128),"count" to Ort.tensor(longArrayOf(0)))).use { result ->
                    @Suppress("UNCHECKED_CAST") val output=result[0].value as Array<FloatArray>
                    assertEquals(1f,output[0][0],0f);assertEquals(0f,output[0][1],0f)
                }
            }
        }
        file.delete()
    }
}
