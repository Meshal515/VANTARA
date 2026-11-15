package com.vantara.runtime

import org.junit.Assert.*
import org.junit.Test

class RuntimeNetworkPolicyTest {
    private fun origins(hash:String,url:String):Set<*> {
        val type=Class.forName("com.vantara.runtime.RuntimeNetworkPolicy")
        return type.getMethod("sourceOrigins",String::class.java,String::class.java).invoke(null,hash,url) as Set<*>
    }
    @Test fun everyPackageReachesThePublicInternetLikeItsOriginalApp() {
        assertEquals(setOf("*"),origins("0".repeat(64),"https://animewitcher.com"))
        assertEquals(setOf("*"),origins("1".repeat(64),"http://plain-http.example"))
    }
    @Test fun credentialsInTheSourceEndpointAreStillRefused() {
        try { origins("0".repeat(64),"https://user:secret@other.example");fail("credentials accepted") }
        catch(expected:java.lang.reflect.InvocationTargetException){assertTrue(expected.cause is IllegalArgumentException)}
    }
}
