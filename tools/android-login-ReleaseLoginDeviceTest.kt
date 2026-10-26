package com.vantara.login

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.app.BuildConfig
import com.vantara.app.MainActivity
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs only in the isolated Release fixture workflow; never contacts production. */
@RunWith(AndroidJUnit4::class)
class ReleaseLoginDeviceTest {
    private val ins = InstrumentationRegistry.getInstrumentation()
    private lateinit var activity: MainActivity
    private lateinit var web: WebView
    private val phase get() = InstrumentationRegistry.getArguments().getString("loginPhase") ?: "candidate"

    @Test fun realReleaseLoginWithFullLocalStorage() {
        val evidence = JSONObject().put("phase", phase).put("buildType", BuildConfig.BUILD_TYPE)
        try {
            assertEquals("This gate must execute Release, not Debug", "release", BuildConfig.BUILD_TYPE)
            assertFalse("Release must remain non-debuggable", ins.targetContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
            activity = ins.startActivitySync(Intent(ins.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            ins.runOnMainSync { web = activity.bridge.webView }
            if (phase == "restart") {
                waitFor("home without another PIN after actual process restart", 45_000) { bool("!!document.querySelector('.v35') && !document.querySelector('.vpin')") }
                val resumed = async("""
                    const info=await (await fetch('http://localhost:8765/__fixture/info')).json();
                    const id=await Capacitor.Plugins.SystemUi.deviceId();
                    const store=(await import('/lib/session-store.js')).createSessionStore();
                    const saved=await store.read();
                    const renew=await fetch('http://localhost:8765/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:info.userId,deviceId:localStorage.getItem('vantara.device.id'),deviceCredential:localStorage.getItem('vantara.device.credential'),pinGrant:saved?.pinGrant})});
                    const proof=await (await fetch('http://localhost:8765/__fixture/proof')).json();
                    return {home:true,pinShown:!!document.querySelector('.vpin'),restoredGrantSession200:renew.status===200,
                      sameNativeIdentity:localStorage.getItem('vantara.device.id')==='android:'+id.identifier,
                      credentialPreserved:localStorage.getItem('vantara.device.credential')==='release-fixture-credential-unchanged-20261026',
                      accountStillActive:proof.accountStillActive,queuedOpAppliedExactlyOnce:proof.queuedOpAppliedExactlyOnce};
                """)
                assertTrue(resumed.toString(), resumed.getBoolean("sameNativeIdentity"))
                assertTrue(resumed.toString(), resumed.getBoolean("credentialPreserved"))
                assertTrue(resumed.toString(), resumed.getBoolean("accountStillActive"))
                assertTrue(resumed.toString(), resumed.getBoolean("restoredGrantSession200"))
                assertTrue(resumed.toString(), resumed.getBoolean("queuedOpAppliedExactlyOnce"))
                evidence.put("result", resumed).put("passed", true)
                return
            }
            waitFor("fixture accounts gate; loopback must work without changing mixed-content policy", 40_000) {
                bool("!!document.querySelector('.gate__enter') && !!document.querySelector('.gate__name')?.textContent")
            }
            if (phase == "baseline") {
                val setup = async("""
                    const info=await (await fetch('http://localhost:8765/__fixture/info')).json();
                    const native=await Capacitor.Plugins.SystemUi.deviceId();
                    const deviceId='android:'+native.identifier;
                    const deviceCredential='release-fixture-credential-unchanged-20261026';
                    const response=await fetch('http://localhost:8765/__fixture/trust',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId,deviceCredential})});
                    if(!response.ok)throw new Error('fixture trust failed');
                    localStorage.setItem('vantara.device.id',deviceId);
                    localStorage.setItem('vantara.device.credential',deviceCredential);
                    localStorage.setItem('vantara.gate.lastAccount',info.userId);
                    // Owner exists before reload; the fixture queue must never cross an anonymous account boundary.
                    localStorage.setItem('vantara.user',JSON.stringify({userId:info.userId,username:'release_fixture',displayName:'Release Test',pinDigits:4}));
                    localStorage.setItem('vantara.public-views.v1','1');
                    localStorage.setItem('vantara.private-usage.v1','1');
                    localStorage.setItem('vantara.cursor','0');
                    localStorage.setItem('vantara.mirror',JSON.stringify({profiles:{[info.userId]:{user_id:info.userId,display_name:'Release Test',rev:0}}}));
                    localStorage.setItem('vantara.queue',JSON.stringify([{opId:info.queuedOp,kind:'usage.add',payload:{activeMs:1234,day:new Date().toISOString().slice(0,10)},at:Date.now()}]));
                    return {setup:true};
                """)
                assertTrue(setup.toString(), setup.getBoolean("setup"))
                ins.runOnMainSync { web.reload() }
                waitFor("selected fixture account after reload", 30_000) { bool("document.querySelector('.gate__name')?.textContent==='Release Test'") }
            } else {
                waitFor("preserved fixture account after APK update", 30_000) { bool("document.querySelector('.gate__name')?.textContent==='Release Test'") }
            }
            val prepared = async("""
                const info=await (await fetch('http://localhost:8765/__fixture/info')).json();
                const id=await Capacitor.Plugins.SystemUi.deviceId();
                const deviceId=localStorage.getItem('vantara.device.id');
                const deviceCredential=localStorage.getItem('vantara.device.credential');
                if(deviceId!=='android:'+id.identifier||deviceCredential!=='release-fixture-credential-unchanged-20261026')throw new Error('fixture identity changed');
                window.__releaseLogin={storageErrors:[],http:[],identity:deviceId,credential:deviceCredential};
                const originalSet=Storage.prototype.setItem;
                Storage.prototype.setItem=function(key,value){try{return originalSet.call(this,key,value)}catch(e){window.__releaseLogin.storageErrors.push({key,name:e.name});throw e}};
                const originalFetch=window.fetch.bind(window);
                window.fetch=async function(input,init){const response=await originalFetch(input,init);const path=new URL(String(input),location.href).pathname;if(path.startsWith('/v1/'))window.__releaseLogin.http.push({path,status:response.status});return response};
                const untrusted=await fetch('http://localhost:8765/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:info.userId,deviceId,deviceCredential:deviceCredential+'-wrong',pin:'2580'})});
                const untrustedBody=await untrusted.json();
                if(untrusted.status!==401||untrustedBody.error!=='device_untrusted')throw new Error('device protection missing');
                let blocks=0;
                if(!localStorage.getItem('__release_login_quota_0')){
                  const chunk='x'.repeat(65536);
                  try{for(;blocks<256;blocks++)localStorage.setItem('__release_login_quota_'+blocks,chunk)}catch(e){if(e.name!=='QuotaExceededError')throw e}
                  let tail='';for(let n=32768;n>=1;n=Math.floor(n/2)){try{localStorage.setItem('__release_login_quota_tail',tail+'x'.repeat(n));tail+='x'.repeat(n)}catch(e){if(e.name!=='QuotaExceededError')throw e}}
                }
                let full=false;try{localStorage.setItem('__release_login_quota_probe','x'.repeat(2048))}catch(e){full=e.name==='QuotaExceededError'}
                return {quotaFull:full,deviceProtection:true,sameNativeIdentity:true,credentialPreserved:true};
            """)
            assertTrue(prepared.toString(), prepared.getBoolean("quotaFull"))
            evidence.put("prepared", prepared)
            raw("document.querySelector('.gate__enter').click();true")
            waitFor("PIN keypad", 10_000) { bool("!!document.querySelector('.vpin')") }
            if (phase != "baseline") {
                enterPin("1111")
                waitFor("wrong PIN denied by real worker", 15_000) { bool("document.querySelector('.vpin__note')?.textContent.includes('غير صحيح')") }
                evidence.put("wrongPinRejected", true)
            }
            enterPin("2580")
            if (phase == "baseline") {
                waitFor("baseline server success followed by real browser storage quota exception", 20_000) {
                    bool("window.__releaseLogin.http.some(r=>r.path==='/v1/session'&&r.status===200) && window.__releaseLogin.storageErrors.some(r=>r.key==='vantara.token'&&r.name==='QuotaExceededError')")
                }
                evidence.put("result", json("({session200:window.__releaseLogin.http.some(r=>r.path==='/v1/session'&&r.status===200),tokenQuotaExceeded:window.__releaseLogin.storageErrors.some(r=>r.key==='vantara.token'&&r.name==='QuotaExceededError'),misleadingNetworkMessage:!!document.querySelector('.vpin__note')?.textContent.includes('اتصال'),home:!!document.querySelector('.v35'),deviceIdUnchanged:localStorage.getItem('vantara.device.id')===window.__releaseLogin.identity,credentialUnchanged:localStorage.getItem('vantara.device.credential')===window.__releaseLogin.credential})"))
                assertTrue(evidence.toString(), evidence.getJSONObject("result").getBoolean("misleadingNetworkMessage"))
                assertFalse(evidence.toString(), evidence.getJSONObject("result").getBoolean("home"))
            } else {
                waitFor("home after successful PIN with localStorage still full", 30_000) { bool("!!document.querySelector('.v35') && !document.querySelector('.vpin')") }
                val verified = async("""
                    const info=await (await fetch('http://localhost:8765/__fixture/info')).json();
                    const store=(await import('/lib/account-store.js')).createAccountStore();
                    let proof,snapshot;
                    for(let n=0;n<45;n++){
                      proof=await (await fetch('http://localhost:8765/__fixture/proof')).json();snapshot=await store.read('snapshot',info.userId);
                      if(proof.queuedOpAppliedExactlyOnce&&window.__releaseLogin.http.some(r=>r.path==='/v1/sync'&&r.status===200)&&window.__releaseLogin.http.some(r=>r.path==='/v1/ops'&&r.status===200)&&snapshot?.mirror?.accounts?.[info.userId])break;
                      await new Promise(resolve=>setTimeout(resolve,1000));
                    }
                    return {home:true,session200:window.__releaseLogin.http.some(r=>r.path==='/v1/session'&&r.status===200),sync200:window.__releaseLogin.http.some(r=>r.path==='/v1/sync'&&r.status===200),ops200:window.__releaseLogin.http.some(r=>r.path==='/v1/ops'&&r.status===200),
                      durableAccountSnapshot:!!snapshot?.mirror?.accounts?.[info.userId],queuedOpAppliedExactlyOnce:proof.queuedOpAppliedExactlyOnce,
                      accountStillActive:proof.accountStillActive,deviceProtection:proof.counts.untrusted401>0,pinProtection:proof.counts.pinWrong401>0,
                      deviceIdUnchanged:localStorage.getItem('vantara.device.id')===window.__releaseLogin.identity,
                      credentialUnchanged:localStorage.getItem('vantara.device.credential')===window.__releaseLogin.credential};
                """, 55_000)
                for (key in listOf("home","session200","sync200","ops200","durableAccountSnapshot","queuedOpAppliedExactlyOnce","accountStillActive","deviceProtection","pinProtection","deviceIdUnchanged","credentialUnchanged")) {
                    assertTrue("$key: $verified", verified.getBoolean(key))
                }
                evidence.put("result", verified)
            }
            evidence.put("passed", true)
        } finally {
            val result = android.os.Bundle().apply { putString("releaseLoginProof", evidence.toString()) }
            ins.sendStatus(0, result)
            if (::activity.isInitialized) ins.runOnMainSync { activity.finish() }
        }
    }

    private fun enterPin(pin: String) {
        for (digit in pin) {
            raw("document.querySelector('.vpin__key[data-digit=\"$digit\"]').click();true")
            Thread.sleep(120)
        }
    }
    private fun raw(script: String): String {
        val done = CountDownLatch(1)
        var value = "null"
        ins.runOnMainSync { web.evaluateJavascript(script) { value = it ?: "null"; done.countDown() } }
        assertTrue("WebView evaluation completed", done.await(10, TimeUnit.SECONDS))
        return value
    }
    private fun bool(script: String) = raw("Boolean($script)") == "true"
    private fun json(script: String): JSONObject {
        val encoded = JSONTokener(raw("JSON.stringify($script)")).nextValue()
        return JSONObject(encoded as String)
    }
    private fun async(script: String, timeout: Long = 30_000): JSONObject {
        raw("window.__releaseAsync={done:false};Promise.resolve().then(async()=>{$script}).then(value=>window.__releaseAsync={done:true,value}).catch(error=>window.__releaseAsync={done:true,error:{name:error.name,message:String(error.message)}});true")
        waitFor("async WebView fixture operation", timeout) { bool("window.__releaseAsync?.done") }
        val out = json("window.__releaseAsync")
        assertFalse("WebView fixture operation: $out", out.has("error"))
        return out.getJSONObject("value")
    }
    private fun waitFor(label: String, timeout: Long, condition: () -> Boolean) {
        val until = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeout)
        while (System.nanoTime() < until) { if (condition()) return; Thread.sleep(200) }
        val state = if (::web.isInitialized) raw("JSON.stringify({gate:!!document.querySelector('.gate'),home:!!document.querySelector('.v35'),pin:!!document.querySelector('.vpin'),message:document.querySelector('.vpin__note')?.textContent||document.querySelector('.gate__message')?.textContent||''})") else "no WebView"
        throw AssertionError("Timed out: $label; state=$state")
    }
}
