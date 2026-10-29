package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class SourceCapabilitiesTest {
    @Test fun metadataUsesTheExistingContractIncludingEscapedSourceAndSectionValues() {
        val type=runCatching { Class.forName("dev.vantara.runtime.cloudstream.SourceCapabilities") }.getOrNull()
        assertNotNull("Metadata needs a synchronous non-reflective encoding path",type)
        val api=object:MainAPI() {
            override var name="مصدر \"اختبار\""
            override var mainUrl="https://source.example"
            override var lang="ar"
            override var hasMainPage=true
            override val mainPage=listOf(MainPageData("قسم","/page?x=\"value\"",true))
        }
        val encoded=type!!.getMethod("encode",List::class.java).invoke(null,listOf(api)) as String
        val result=Json.parseToJsonElement(encoded).jsonObject
        assertEquals("cloudstream-original-v1",result.getValue("profile").jsonPrimitive.content)
        assertTrue(result.getValue("executed").jsonPrimitive.boolean)
        assertFalse(result.getValue("sourceFunctionsTested").jsonPrimitive.boolean)
        val source=result.getValue("sources").jsonArray.single().jsonObject
        assertEquals(api.name,source.getValue("name").jsonPrimitive.content)
        assertEquals(api.mainUrl,source.getValue("mainUrl").jsonPrimitive.content)
        val section=source.getValue("mainPages").jsonArray.single().jsonObject
        assertEquals("/page?x=\"value\"",section.getValue("data").jsonPrimitive.content)
        assertTrue(section.getValue("horizontalImages").jsonPrimitive.boolean)
    }
}
