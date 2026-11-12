package com.vantara.runtime

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RuntimeRepositoryEntryTest {
    private val repo="https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json"
    private fun decode(value:JsonObject):JsonObject {
        val type=Class.forName("com.vantara.runtime.RuntimeRepositoryEntry")
        return try { type.getMethod("decode",JsonObject::class.java,String::class.java,String::class.java).invoke(null,value,repo,"3rabi عربي") as JsonObject }
        catch(error:java.lang.reflect.InvocationTargetException){throw error.targetException}
    }
    private fun row(name:String,url:String="https://packages.example/$name.cs3")=buildJsonObject { put("internalName",name);put("name",name);put("url",url);put("version",1) }
    @Test fun actualArabicRepositoryAll43EntriesRemainAvailableIncludingSpaceNamedPackage() {
        val data=javaClass.getResourceAsStream("/arabi-index-20261029.json")!!.bufferedReader().use { RuntimeJson.parse(it.readText()).jsonArray }
        assertEquals(43,data.size)
        val result=data.map { decode(it.jsonObject) }
        assertEquals(43,result.map { it.text("pkg") }.distinct().size)
        assertTrue(result.any { it.text("internalName")=="Animewitcher" })
        assertTrue(result.any { it.text("internalName")=="AnimeRift" })
        val spaced=result.single { it.text("internalName")=="Aia2tv 2" }
        assertEquals("https://raw.githubusercontent.com/Abodabodd/re-3arabi/builds/Aia2tv%202.cs3",spaced.text("url"))
        assertTrue(result.all { it.text("pkg").matches(Regex("cs3_[0-9a-f]{32}")) })
    }
    @Test fun namesAreOpaqueMetadataAndNeverBecomePackageStoragePaths() {
        for(name in listOf("Animewitcher","Aia2tv 2","مصدر عربي")) {
            val result=decode(row(name))
            assertEquals(name,result.text("internalName"))
            assertEquals(RuntimeHost.packageId(repo,name),result.text("pkg"))
            assertEquals(repo,result.text("repoUrl"))
        }
    }
    @Test fun spacedArtifactPathIsEncodedWithoutChangingItsPackageIdentity() {
        val result=decode(row("ValidName","https://packages.example/Folder Name/Aia2tv 2.cs3"))
        assertEquals("https://packages.example/Folder%20Name/Aia2tv%202.cs3",result.text("url"))
        assertEquals(RuntimeHost.packageId(repo,"ValidName"),result.text("pkg"))
    }
    @Test fun controlsAndUnsafeDownloadEndpointsStayRejected() {
        for(name in listOf(""," ","bad\u0000id","bad\nid","../source","bad\\source")) {
            try { decode(row(name,"https://packages.example/source.cs3"));fail("Invalid name accepted") }
            catch(expected:IllegalArgumentException){assertEquals("INVALID_PACKAGE_ID",expected.message)}
        }
        for(url in listOf("http://packages.example/a.cs3","https://user:password@packages.example/a.cs3","https://packages.example/a.cs3#other","https://packages.example/a\n.cs3")) {
            try { decode(row("Good",url));fail("Unsafe endpoint accepted") }
            catch(expected:IllegalArgumentException){assertEquals("INVALID_ENDPOINT",expected.message)}
        }
    }
}
