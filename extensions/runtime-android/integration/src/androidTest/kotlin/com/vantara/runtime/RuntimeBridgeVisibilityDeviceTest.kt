package com.vantara.runtime

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.app.MainActivity
import org.junit.Assert.*
import org.junit.Test

/**
 * The actual Capacitor bridge must expose the same native runtime that the
 * emulator's low-level RuntimeHost tests invoke. Class presence in the APK
 * alone is insufficient if startup/ContentProvider plugin registration fails.
 */
class RuntimeBridgeVisibilityDeviceTest {
    @Test fun publishedCloudStreamBridgeIsRegisteredBeforeTheWebViewStarts() {
        val ins=InstrumentationRegistry.getInstrumentation()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val bridge=activity.javaClass.getMethod("getBridge").invoke(activity)
                assertNotNull("Capacitor BridgeActivity has no bridge",bridge)
                val getPlugin=bridge.javaClass.getMethod("getPlugin",String::class.java)
                val plugin=getPlugin.invoke(bridge,"VantaraRuntime")
                assertNotNull("CloudStream plugin missing from running Debug Capacitor bridge",plugin)
                assertNotNull("RuntimePlugin class must be packaged",
                    Class.forName("com.vantara.runtime.RuntimePlugin",false,activity.classLoader))
                android.util.Log.i("VantaraRuntime","DEBUG_BRIDGE_REGISTERED:VantaraRuntime")
            }
        }
    }
}
