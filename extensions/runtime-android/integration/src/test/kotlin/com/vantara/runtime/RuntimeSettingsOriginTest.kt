package com.vantara.runtime

import dev.vantara.runtime.api.RuntimeHttpAccess
import org.junit.Assert.*
import org.junit.Test

class RuntimeSettingsOriginTest {
    private val hash="4c639f9392d46e45f4ee84e8799c810cc1d11fba2f13ff7e32865c71987c2fb4"
    private val endpoint="https://firestore.googleapis.com/v1/projects/animewitcher-1c66d/databases/(default)/documents/Settings/constants?key=fixture"
    private fun body(id:String)="""{"fields":{"search_settings":{"mapValue":{"fields":{"app_id_v3":{"stringValue":"$id"},"api_key":{"stringValue":"not-copied-or-logged"}}}}}}""".toByteArray()
    private fun learn(id:String="TVNESH8OZY",pin:String=hash,requestUrl:String=endpoint,responseUrl:String=endpoint,status:Int=200,method:String="GET",data:ByteArray=body(id))=
        RuntimeNetworkPolicy.trustedSettingsOrigin(pin,"https://animewitcher.com",RuntimeHttpAccess.Request(requestUrl,method,emptyMap(),null,true),RuntimeHttpAccess.Response(responseUrl,status,mapOf("Content-Type" to listOf("application/json")),data))
    @Test fun actualSourceSettingsRotationAdmitsOnlyTheNewExactAlgoliaApplicationOrigin() {
        assertEquals("https://tvnesh8ozy-dsn.algolia.net",learn())
        assertEquals("https://newapp1234-dsn.algolia.net",learn("NEWAPP1234"))
        assertFalse(RuntimeNetworkPolicy.sourceOrigins(hash,"https://animewitcher.com").contains("https://tvnesh8ozy-dsn.algolia.net"))
        val synchronized=RuntimeNetworkPolicy.sourceOrigins(hash,"https://animewitcher.com",learn())
        assertEquals(setOf("https://animewitcher.com","https://firestore.googleapis.com","https://tvnesh8ozy-dsn.algolia.net"),synchronized)
        assertEquals(RuntimeNetworkPolicy.sourceOrigins("0".repeat(64),"https://animewitcher.com"),RuntimeNetworkPolicy.sourceOrigins("0".repeat(64),"https://animewitcher.com",learn()))
    }
    @Test fun matchingDisplayNamesOrUnreviewedPackageBytesDoNotGrantAccess() { assertNull(learn(pin="0".repeat(64))) }
    @Test fun foreignOrRedirectedSettingsAreNotPermissionEvidence() {
        for(url in listOf(endpoint.replace("firestore.googleapis.com","attacker.example"),endpoint.replace("animewitcher-1c66d","foreign-project"),endpoint.replace("Settings/constants","Settings/other"),endpoint.replace("https:","http:"))) {
            assertNull(learn(requestUrl=url));assertNull(learn(responseUrl=url))
        }
        assertNull(learn(method="POST"));assertNull(learn(status=403))
    }
    @Test fun settingsCannotInjectWildcardPrivateOrArbitraryDomains() {
        for(id in listOf("*","localhost","127.0.0.1","evil.example","TVNESH8OZY-dsn.algolia.net.evil","TVNESH8OZY/evil"))assertNull(learn(id))
        assertNull(learn(data="not JSON".toByteArray()));assertNull(learn(data=ByteArray(65537)))
    }
}
