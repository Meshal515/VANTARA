package com.vantara.runtime

import org.junit.Assert.*
import org.junit.Test

class RuntimeNetworkPolicyTest {
    private val pin="4c639f9392d46e45f4ee84e8799c810cc1d11fba2f13ff7e32865c71987c2fb4"
    private fun origins(hash:String,url:String):Set<*> {
        val type=Class.forName("com.vantara.runtime.RuntimeNetworkPolicy")
        return type.getMethod("sourceOrigins",String::class.java,String::class.java).invoke(null,hash,url) as Set<*>
    }
    @Test fun reviewedWitcherArchiveAdmitsItsRealCatalogueAndEpisodeServices() {
        assertEquals(setOf("https://animewitcher.com","https://d8lh9i7zl7-dsn.algolia.net","https://firestore.googleapis.com"),origins(pin,"https://animewitcher.com"))
    }
    @Test fun namesOrUnreviewedArchivesNeverGrantThirdPartyNetworkAccess() {
        assertEquals(setOf("https://animewitcher.com"),origins("0".repeat(64),"https://animewitcher.com"))
        assertEquals(setOf("https://other.example"),origins(pin,"https://other.example"))
    }
}
