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
        // The rotated application is reachable on the public scope already; learning it changes no grant.
        assertEquals(setOf("*"),RuntimeNetworkPolicy.sourceOrigins(hash,"https://animewitcher.com"))
        assertEquals(setOf("*"),RuntimeNetworkPolicy.sourceOrigins(hash,"https://animewitcher.com",learn()))
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
    private val servers=endpoint.replace("Settings/constants","anime_list/work-1/episodes/episode-1/servers2/all_servers")
    private fun serverBody(link:String)="""{"fields":{"servers":{"arrayValue":{"values":[{"mapValue":{"fields":{"name":{"stringValue":"PD"},"link":{"stringValue":"$link"}}}}]}}}}""".toByteArray()
    @Test fun onlyReviewedPixeldrainMediaDeclaredByTheRealSourceDocumentGrantsAccess() {
        assertEquals("https://pixeldrain.com",learn(requestUrl=servers,responseUrl=servers,data=serverBody("https://pixeldrain.com/u/AbCd1234")))
    }
    @Test fun aServerDocumentCannotGrantArbitraryMediaHostsOrRedirectedDocuments() {
        for(url in listOf("https://pixeldrain.com.evil.example/u/AbCd1234","http://pixeldrain.com/u/AbCd1234","https://user:pass@pixeldrain.com/u/AbCd1234","https://pixeldrain.com/u/AbCd1234?redirect=evil","https://127.0.0.1/u/AbCd1234","https://pixeldrain.com/api/file/AbCd1234/info"))
            assertNull(learn(requestUrl=servers,responseUrl=servers,data=serverBody(url)))
        for(url in listOf(servers.replace("animewitcher-1c66d","foreign-project"),servers.replace("all_servers","other"),servers.replace("firestore.googleapis.com","attacker.example"))) {
            assertNull(learn(requestUrl=url,responseUrl=servers,data=serverBody("https://pixeldrain.com/u/AbCd1234")))
            assertNull(learn(requestUrl=servers,responseUrl=url,data=serverBody("https://pixeldrain.com/u/AbCd1234")))
        }
        assertNull(learn(pin="0".repeat(64),requestUrl=servers,responseUrl=servers,data=serverBody("https://pixeldrain.com/u/AbCd1234")))
    }
}
