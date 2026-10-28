package com.vantara.stableproof

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.app.BuildConfig
import com.vantara.app.MainActivity
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Test-only instrumentation, signed for an empty CI emulator. Not shipped in the app. */
@RunWith(AndroidJUnit4::class)
class StableAddonsDeviceTest {
    private val ins = InstrumentationRegistry.getInstrumentation()
    private lateinit var activity: MainActivity
    private lateinit var web: WebView
    private val phase get() = InstrumentationRegistry.getArguments().getString("stablePhase") ?: "candidate"
    private val nativeFixture = """{"repos":[{"url":"https://repo.example/stable","name":"Stable preserved repository","fingerprint":"${"a".repeat(64)}"}],"extensions":[]}"""
    @Test fun stableUpgradeAndQuietVerification() {
        val proof = JSONObject().put("phase", phase).put("buildType", BuildConfig.BUILD_TYPE)
            .put("authenticationTest", false).put("liveSourcePlaybackTest", false)
        try {
            assertEquals("release", BuildConfig.BUILD_TYPE)
            assertEquals("com.vantara.app", ins.targetContext.packageName)
            assertFalse(ins.targetContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
            val native = File(ins.targetContext.filesDir, "extensions/user-repos.json")
            if (phase == "baseline") {
                assertFalse("Only seed an empty CI emulator", native.exists())
                native.parentFile!!.mkdirs(); native.writeText(nativeFixture)
            }
            assertEquals("Native repositories changed across APK replacement", nativeFixture, native.readText())
            activity = ins.startActivitySync(Intent(ins.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            ins.runOnMainSync { web = activity.bridge.webView }
            waitFor("live account screen", 45_000) { bool("!!document.querySelector('#root .gate button,#root .v35,#root .vpin')") }
            val retention = async("""
                const id=(await Capacitor.Plugins.SystemUi.deviceId()).identifier;
                const key='vantara.stable.upgrade-proof';
                const value=JSON.stringify({marker:'stable-only-20261028',id});
                const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('vantara-stable-upgrade-proof',1);r.onupgradeneeded=()=>r.result.createObjectStore('proof');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
                if('${phase}'==='baseline'){
                  localStorage.setItem(key,value);
                  await new Promise((resolve,reject)=>{const t=db.transaction('proof','readwrite');t.objectStore('proof').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
                }
                const saved=await new Promise((resolve,reject)=>{const r=db.transaction('proof').objectStore('proof').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();
                const repos=await Capacitor.Plugins.ExtensionEngine.repos();
                return {localStorage:localStorage.getItem(key)===value,indexedDB:saved===value,nativeIdentity:JSON.parse(localStorage.getItem(key)||'{}').id===id,
                  nativeRepository:repos.repos.some(r=>r.url==='https://repo.example/stable'&&r.name==='Stable preserved repository')};
            """)
            for (key in listOf("localStorage", "indexedDB", "nativeIdentity", "nativeRepository")) assertTrue("$key: $retention", retention.getBoolean(key))
            proof.put("retention", retention)
            if (phase != "candidate") { proof.put("passed", true); return }
            async("""
                window.__stableErrors=[];
                addEventListener('error',e=>window.__stableErrors.push(String(e.error?.stack||e.message)));
                addEventListener('unhandledrejection',e=>window.__stableErrors.push(String(e.reason?.stack||e.reason)));
                const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
                const {mountV35}=await import(new URL('/v35/shell.js',location.href).href);
                window.__stableShell=mountV35({sync,mount:node=>document.querySelector('#root').replaceChildren(node),go:async()=>{},friends:()=>[],presence:async()=>[],version:'stable-release-fixture',switchAccount:()=>{},openReader:()=>{}},{page:'home'});
                return {mounted:true};
            """)
            waitFor("real Home shell", 20_000) { bool("!!document.querySelector('#home.active')") }
            assertTrue("No verification process before a request", shell("pidof com.vantara.app:verification").isBlank())
            // Inject challenge detection into the real coordinator, not a JS UI mock.
            // This records a host; it does not fetch the site or claim CAPTCHA success.
            val coordinator = Class.forName("com.vantara.verification.VerificationCoordinator")
            coordinator.getMethod("require", okhttp3.HttpUrl::class.java, String::class.java)
                .invoke(null, "https://example.org/".toHttpUrl(), "Stable Release test")
            for (iteration in 1..30) {
                raw("document.querySelector('[data-act=\"openDrawer\"]').click();[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات').click();true")
                waitFor("V7 manager $iteration", 15_000) { bool("!!document.querySelector('#utility.active .v7-addon')") }
                raw("document.querySelector('.v7-verify-entry').click();true")
                waitFor("recorded source in verification tab", 10_000) { bool("document.querySelector('.v7-verification-item')?.textContent.includes('example.org')") }
                assertFalse("No automatic challenge overlay", bool("!!document.querySelector('[data-source-verification]')"))
                assertTrue("Background challenge started verification", shell("pidof com.vantara.app:verification").isBlank())
                val focus=shell("dumpsys activity activities")
                assertTrue("MainActivity lost foreground: "+focus.lineSequence().filter { it.contains("ResumedActivity") }.joinToString(), resumed(focus,"com.vantara.app.MainActivity"))
                assertFalse("App lost focus", activity.isFinishing || activity.isDestroyed)
                raw("window.__stableShell.handleBack();true")
                waitFor("root Back returns Home, not another Addons tab", 10_000) { bool("!!document.querySelector('#home.active')") }
                Thread.sleep(4000)
            }
            // Beyond the 30–120s interval reported by the owner; no source UI or login fixture.
            Thread.sleep(60_000)
            assertTrue("A delayed challenge opened itself", shell("pidof com.vantara.app:verification").isBlank())
            proof.put("cycles", 30).put("quietObservationSeconds", 180)
            // Explicit user action must be the only path opening the isolated page.
            raw("document.querySelector('[data-act=\"openDrawer\"]').click();[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات').click();true")
            waitFor("manager", 15_000) { bool("!!document.querySelector('.v7-verify-entry')") }
            raw("document.querySelector('.v7-verify-entry').click();true")
            waitFor("verify button", 10_000) { bool("!!document.querySelector('.v7-verification-item button')") }
            raw("document.querySelector('.v7-verification-item button').click();true")
            waitFor("explicit isolated verification Activity", 15_000) {
                resumed(shell("dumpsys activity activities"),"com.vantara.verification.VerificationActivity")
            }
            shell("input keyevent KEYCODE_BACK")
            waitFor("cancelled verification returns to same manager", 15_000) { bool("!!document.querySelector('#utility.active .v7-addon .v7-verification-item')") }
            waitFor("cancelled verification retains a retry button", 10_000) { bool("!!document.querySelector('.v7-verification-item button') && !document.querySelector('.v7-verification-item button').disabled") }
            val cancelled = async("""
                const out=await Capacitor.Plugins.Verification.pending();
                return {required:out.pending.some(x=>x.host==='example.org'&&x.state==='required'),active:out.pending.some(x=>x.state==='active')};
            """)
            assertTrue(cancelled.toString(),cancelled.getBoolean("required"));assertFalse(cancelled.toString(),cancelled.getBoolean("active"))
            assertEquals(nativeFixture, native.readText())
            assertEquals("No unhandled UI errors", "[]", raw("JSON.stringify(window.__stableErrors)").let { JSONTokener(it).nextValue() as String })
            proof.put("explicitVerificationOpened", true).put("cancellationReturned", true)
                .put("javascriptErrors", org.json.JSONArray()).put("nativeRepositoryBytesPreserved", true).put("passed", true)
        } finally {
            ins.sendStatus(0, android.os.Bundle().apply { putString("stableAddonsProof", proof.toString()) })
            if (::activity.isInitialized) ins.runOnMainSync { activity.finish() }
        }
    }
    @Test fun activityIdentityAcceptsAndroidShortAndFullComponentNamesOnly() {
        assertTrue(resumed("mResumedActivity: ActivityRecord{abc u0 com.vantara.app/.MainActivity t9}", "com.vantara.app.MainActivity"))
        assertTrue(resumed("topResumedActivity=ActivityRecord{abc u0 com.vantara.app/com.vantara.app.MainActivity t9}", "com.vantara.app.MainActivity"))
        assertFalse(resumed("mResumedActivity: ActivityRecord{abc u0 com.vantara.app/com.vantara.verification.VerificationActivity t9}", "com.vantara.app.MainActivity"))
        assertFalse(resumed("lastPausedActivity: com.vantara.app/.MainActivity", "com.vantara.app.MainActivity"))
        assertFalse(resumed("mResumedActivity: com.vantara.app.evil/.MainActivity", "com.vantara.app.MainActivity"))
    }
    private fun resumed(dump: String, expected: String): Boolean = dump.lineSequence()
        .filter { it.contains("mResumedActivity") || it.contains("topResumedActivity") }
        .any { line ->
            Regex("com\\.vantara\\.app/([^\\s}]+)").find(line)?.let { match ->
                val name=match.groupValues[1]
                (if(name.startsWith(".")) "com.vantara.app$name" else name)==expected
            } ?: false
        }
    private fun shell(command: String): String = ins.uiAutomation.executeShellCommand(command).use { fd ->
        FileInputStream(fd.fileDescriptor).bufferedReader().use { it.readText().trim() }
    }
    private fun raw(script: String): String {
        val done = CountDownLatch(1); var value = "null"
        ins.runOnMainSync { web.evaluateJavascript(script) { value = it ?: "null"; done.countDown() } }
        assertTrue(done.await(10, TimeUnit.SECONDS)); return value
    }
    private fun bool(script: String) = raw("Boolean($script)") == "true"
    private fun async(script: String): JSONObject {
        raw("window.__stableAsync={done:false};Promise.resolve().then(async()=>{$script}).then(value=>window.__stableAsync={done:true,value}).catch(error=>window.__stableAsync={done:true,error:String(error.stack||error)});true")
        waitFor("async operation", 45_000) { bool("window.__stableAsync?.done") }
        val out=JSONObject(JSONTokener(raw("JSON.stringify(window.__stableAsync)")).nextValue() as String)
        assertFalse(out.toString(),out.has("error"));return out.getJSONObject("value")
    }
    private fun waitFor(label: String, timeout: Long, condition: () -> Boolean) {
        val until=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout)
        while(System.nanoTime()<until){if(condition())return;Thread.sleep(200)}
        throw AssertionError("Timed out: $label; page="+raw("document.querySelector('#root')?.textContent?.slice(0,400)"))
    }
}
