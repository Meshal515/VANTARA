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

    private fun device(native: String = "n1", bundledVersion: String? = null) = WebBundleState(own, cap, { it in onDisk }, native, bundledVersion)

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
    fun `staged bundles remain inactive across launches until Settings promotes them`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        assertTrue(device().stage("/web/0.0.5", "0.0.5", "n1"))
        repeat(3) {
            assertEquals(WebBundleState.Boot.Nothing, launch { versionAt(it) })
            assertEquals("", path())
            assertEquals("0.0.5", device().stagedVersion())
        }
        assertEquals("/web/0.0.5" to "0.0.5", device().promoteNow())
        assertEquals(WebBundleState.Boot.Trial("0.0.5"), launch { versionAt(it) })
        assertEquals("0.0.5", device().goodVersion())
        assertEquals(WebBundleState.Boot.Nothing, launch { versionAt(it) })
    }

    @Test
    fun `an interrupted manual update can finish on restart`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        assertTrue(device().stage("/web/0.0.5", "0.0.5", "n1", userInitiated = true))
        assertEquals(WebBundleState.Boot.Trial("0.0.5"), launch { versionAt(it) })
        assertEquals("0.0.5", device().goodVersion())
        assertEquals(WebBundleState.Boot.Nothing, launch { versionAt(it) })
    }

    @Test
    fun `a bundle that never confirms is rolled back to the last good one and never retried`() {
        device().onBoot()
        onDisk += listOf("/web/0.0.5", "/web/0.0.6")
        device().stage("/web/0.0.5", "0.0.5", "n1")
        device().promoteNow()
        launch { versionAt(it) }
        device().stage("/web/0.0.6", "0.0.6", "n1")
        device().promoteNow()

        // 0.0.6 تنهار قبل أول شاشة: لا healthy
        assertTrue(device().inTrial("0.0.6"))
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
        state.promoteNow()
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
        device().promoteNow()
        launch { versionAt(it) }
        assertEquals("/web/0.0.5", path())

        assertEquals(WebBundleState.Boot.Reset, launch(native = "n2") { versionAt(it) })
        assertEquals("", path())
        assertEquals(emptySet<String>(), device("n2").keep())
    }

    @Test
    fun `a newer bundled APK replaces an older good web even with unchanged native code`() {
        device(bundledVersion = "0.0.209").onBoot()
        onDisk += "/web/0.0.210"
        device(bundledVersion = "0.0.209").stage("/web/0.0.210", "0.0.210", "n1")
        device(bundledVersion = "0.0.209").promoteNow()
        device(bundledVersion = "0.0.209").healthy("0.0.210")
        own.map["unrelated-setting"] = "preserved"

        val updated = device(bundledVersion = "0.0.212")
        assertEquals(WebBundleState.Boot.Nothing, updated.onBoot())
        assertEquals("", path())
        assertEquals(null, updated.goodVersion())
        assertEquals(emptySet<String>(), updated.keep())
        assertEquals("preserved", own.get("unrelated-setting"))
        assertTrue("/web/0.0.210" in onDisk)
    }

    @Test
    fun `an OTA newer than the bundled APK remains active and usable`() {
        val state = device(bundledVersion = "0.0.212")
        state.onBoot()
        onDisk += "/web/0.0.213"
        assertTrue(state.stage("/web/0.0.213", "0.0.213", "n1"))
        state.promoteNow()
        assertEquals(WebBundleState.Boot.Trial("0.0.213"), device(bundledVersion = "0.0.212").onBoot())
        assertTrue(state.healthy("0.0.213"))
        assertEquals(WebBundleState.Boot.Nothing, device(bundledVersion = "0.0.212").onBoot())
        assertEquals("/web/0.0.213", path())
        assertEquals("0.0.213", state.goodVersion())
    }

    @Test
    fun `an older trial and manual staged update cannot override newer embedded web`() {
        val old = device(bundledVersion = "0.0.209")
        old.onBoot()
        onDisk += listOf("/web/0.0.210", "/web/0.0.211")
        old.stage("/web/0.0.210", "0.0.210", "n1")
        old.promoteNow()
        old.stage("/web/0.0.211", "0.0.211", "n1", userInitiated = true)

        val updated = device(bundledVersion = "0.0.212")
        assertEquals(WebBundleState.Boot.Nothing, updated.onBoot())
        assertEquals("", path())
        assertFalse(updated.inTrial("0.0.210"))
        assertEquals(null, updated.stagedVersion())
        assertFalse(updated.stage("/web/0.0.211", "0.0.211", "n1", userInitiated = true))
        assertEquals(null, updated.promoteNow())
        assertTrue(onDisk.containsAll(listOf("/web/0.0.210", "/web/0.0.211")))
    }

    @Test
    fun `a newer manually staged OTA still completes after installing a newer APK`() {
        val old = device(bundledVersion = "0.0.209")
        old.onBoot()
        onDisk += listOf("/web/0.0.210", "/web/0.0.213")
        old.stage("/web/0.0.210", "0.0.210", "n1")
        old.promoteNow()
        old.healthy("0.0.210")
        old.stage("/web/0.0.213", "0.0.213", "n1", userInitiated = true)

        val updated = device(bundledVersion = "0.0.212")
        assertEquals(WebBundleState.Boot.Trial("0.0.213"), updated.onBoot())
        assertEquals("/web/0.0.213", path())
        assertTrue(updated.healthy("0.0.213"))
        assertEquals("0.0.213", updated.goodVersion())
    }

    @Test
    fun `a newer trial rolls back to embedded web instead of an older good bundle`() {
        val old = device(bundledVersion = "0.0.209")
        old.onBoot()
        onDisk += listOf("/web/0.0.210", "/web/0.0.213")
        old.stage("/web/0.0.210", "0.0.210", "n1")
        old.promoteNow()
        old.healthy("0.0.210")
        old.stage("/web/0.0.213", "0.0.213", "n1")
        old.promoteNow()

        val updated = device(bundledVersion = "0.0.212")
        assertEquals(WebBundleState.Boot.Trial("0.0.213"), updated.onBoot())
        assertEquals("/web/0.0.213", path())
        assertEquals("", updated.rollback())
        assertEquals("", path())
        assertTrue("0.0.213" in updated.bad())
    }

    @Test
    fun `version comparisons are numeric and unknown debug versions do not discard web`() {
        val old = device(bundledVersion = "0.0.8")
        old.onBoot()
        onDisk += "/web/0.0.9"
        old.stage("/web/0.0.9", "0.0.9", "n1")
        old.promoteNow()
        old.healthy("0.0.9")
        assertEquals(WebBundleState.Boot.Nothing, device(bundledVersion = "debug-10-abc").onBoot())
        assertEquals("/web/0.0.9", path())
        assertEquals(WebBundleState.Boot.Nothing, device(bundledVersion = "0.0.10").onBoot())
        assertEquals("", path())
    }

    @Test
    fun `a missing bundle folder rolls back instead of loading a blank page`() {
        device().onBoot()
        onDisk += "/web/0.0.5"
        device().stage("/web/0.0.5", "0.0.5", "n1")
        device().promoteNow()
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
        device().promoteNow()
        launch { versionAt(it) }
        device().stage("/web/0.0.6", "0.0.6", "n1")
        device().promoteNow()
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
