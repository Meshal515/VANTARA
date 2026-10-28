package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CatalogueDispatchTest {
    @Test fun legacyProviderWithoutSectionListStillReceivesRealCatalogueCall()=runBlocking {
        var called=false
        val legacy=object:MainAPI(){
            override val hasMainPage=true
            override suspend fun getMainPage(page:Int,request:MainPageRequest):HomePageResponse {
                called=true;assertEquals(2,page);assertEquals("",request.data)
                return newHomePageResponse("أحدث الأعمال",listOf(newAnimeSearchResponse("عمل","https://source.example/work",fix=false)),true)
            }
        }
        assertEquals("عمل",SourceOperations.catalogue(legacy,2,0).items.single().list.single().name);assertTrue(called)
    }
    @Test fun declaredSectionsKeepTheirActualRequestMetadata()=runBlocking {
        val modern=object:MainAPI(){
            override val hasMainPage=true;override val mainPage=listOf(MainPageData("films","/films",true))
            override suspend fun getMainPage(page:Int,request:MainPageRequest):HomePageResponse {assertEquals("/films",request.data);assertTrue(request.horizontalImages);return newHomePageResponse(request.name,emptyList(),false)}
        }
        assertEquals("films",SourceOperations.catalogue(modern,1,0).items.single().name)
    }
    @Test fun unsupportedBaseProviderDoesNotReturnFakeCatalogue()=runBlocking {
        try{SourceOperations.catalogue(MainAPI(),1,0);fail("Fake catalogue success")}
        catch(expected:UnsupportedOperationException){assertEquals("catalogue",expected.message)}
    }
    @Test fun legacySearchPaginationIsNotSilentlyInvented()=runBlocking {
        val legacy=object:MainAPI(){override suspend fun search(query:String)=emptyList<SearchResponse>()}
        assertFalse(legacy.search("work",1)!!.hasNext)
        try{legacy.search("work",2);fail("Invented pagination")}
        catch(expected:UnsupportedOperationException){assertEquals("search pagination",expected.message)}
    }
}
