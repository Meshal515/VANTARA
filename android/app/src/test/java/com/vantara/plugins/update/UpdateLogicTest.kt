package com.vantara.plugins.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateLogicTest {
    private class Mem : WebBundleState.KeyValue {
        val map = mutableMapOf<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String?) {
            if (value == null) map.remove(key) else map[key] = value
        }
    }

    private val own = Mem()
    private val cap = Mem()
    private val onDisk = mutableSetOf<String>()

    private fun device(native: String = "n1") = WebBundleState(own, cap, { it in onDisk }, native)

    private fun path() = cap.map[WebBundleState.CAP_PATH] ?: ""

    /** يُحاكي فتح التطبيق: onBoot ثم (إن عملت الواجهة) healthy. */
    private fun launch(native: String = "n1", running: (String) -> String?): WebBundleState.Boot {
        val state = device(native)
        val boot = state.onBoot()
        running(path())?.let { state.healthy(it) }
        return boot
    }

    private fun versionAt(p: String) = if (p.isEmpty()) "bundled" else p.substringAfterLast('/')

    @Test
    fun `a staged bundle shows on the next launch and becomes good once it confirms`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        assertTrue(device().stage("/web/0.0.5", "0.0.5", "n1"))
        assertEquals("", path())

        val boot = launch { versionAt(it) }
        assertEquals(WebBundleState.Boot.Trial("0.0.5"), boot)
        assertEquals("/web/0.0.5", path())
        assertEquals("0.0.5", device().goodVersion())
        assertEquals(WebBundleState.Boot.Nothing, launch { versionAt(it) })
        assertEquals("/web/0.0.5", path())
    }

    @Test
    fun `a bundle that never confirms is rolled back to the last good one and never retried`() {
        device().onBoot()
        onDisk += listOf("/web/0.0.5", "/web/0.0.6")
        device().stage("/web/0.0.5", "0.0.5", "n1")
        launch { versionAt(it) }
        device().stage("/web/0.0.6", "0.0.6", "n1")

        // 0.0.6 تنهار قبل أول شاشة: لا healthy
        assertEquals(WebBundleState.Boot.Trial("0.0.6"), launch { null })
        assertEquals(WebBundleState.Boot.Trial("0.0.6"), launch { null })
        assertEquals(WebBundleState.Boot.RolledBack("0.0.6"), launch { null })
        assertEquals("/web/0.0.5", path())
        assertTrue("0.0.6" in device().bad())
        assertFalse(device().stage("/web/0.0.6", "0.0.6", "n1"))
    }

    @Test
    fun `the watchdog rollback with no good bundle falls back to the APK's own web`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        device().stage("/web/0.0.5", "0.0.5", "n1")
        val state = device()
        state.onBoot()
        assertTrue(state.inTrial("0.0.5"))
        assertEquals("", state.rollback())
        assertEquals("", path())
    }

    @Test
    fun `a bundle built for other native code is never staged`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        assertFalse(device().stage("/web/0.0.5", "0.0.5", "n2"))
        assertEquals(WebBundleState.Boot.Nothing, launch { versionAt(it) })
        assertEquals("", path())
    }

    @Test
    fun `a new APK clears every downloaded bundle so its own newer web shows`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        device().stage("/web/0.0.5", "0.0.5", "n1")
        launch { versionAt(it) }
        assertEquals("/web/0.0.5", path())

        assertEquals(WebBundleState.Boot.Reset, launch(native = "n2") { versionAt(it) })
        assertEquals("", path())
        assertEquals(emptySet<String>(), device("n2").keep())
    }

    @Test
    fun `a missing bundle folder rolls back instead of loading a blank page`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        device().stage("/web/0.0.5", "0.0.5", "n1")
        device().onBoot()
        onDisk -= "/web/0.0.5"
        assertEquals(WebBundleState.Boot.RolledBack("0.0.5"), device().onBoot())
        assertEquals("", path())
    }

    @Test
    fun `reset returns to the bundled web and keeps the bad list`() {
        device().onBoot()
        onDisk += listOf("/web/0.0.5", "/web/0.0.6")
        device().stage("/web/0.0.5", "0.0.5", "n1")
        launch { versionAt(it) }
        device().stage("/web/0.0.6", "0.0.6", "n1")
        device().onBoot()
        device().rollback()
        device().reset()
        assertEquals("", path())
        assertEquals(setOf("0.0.6"), device().bad())
        assertEquals(emptySet<String>(), device().keep())
    }

    private val official = ApkCheck.STABLE_CERT_SHA256
    private val installed = ApkCheck.Apk("com.vantara.app", 4, setOf(official))

    @Test
    fun `only a newer official build of the same app passes`() {
        assertEquals(ApkCheck.Verdict.OK, ApkCheck.verify(ApkCheck.Apk("com.vantara.app", 5, setOf(official)), installed))
        assertEquals(ApkCheck.Verdict.NOT_NEWER, ApkCheck.verify(ApkCheck.Apk("com.vantara.app", 4, setOf(official)), installed))
        assertEquals(ApkCheck.Verdict.WRONG_PACKAGE, ApkCheck.verify(ApkCheck.Apk("com.evil.app", 9, setOf(official)), installed))
        assertEquals(ApkCheck.Verdict.NOT_OFFICIAL, ApkCheck.verify(ApkCheck.Apk("com.vantara.app", 9, setOf("ab")), installed))
        assertEquals(ApkCheck.Verdict.UNREADABLE, ApkCheck.verify(null, installed))
        assertEquals(
            ApkCheck.Verdict.INSTALLED_DIFFERENT_KEY,
            ApkCheck.verify(ApkCheck.Apk("com.vantara.app", 9, setOf(official)), installed.copy(certs = setOf("debug"))),
        )
    }
}
