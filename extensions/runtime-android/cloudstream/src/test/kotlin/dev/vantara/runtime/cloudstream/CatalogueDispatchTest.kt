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
    // انحدار الفحص الحي: 17 من 43 مصدرًا بدت فارغة أو معطوبة لأن القسم الأول وحده كان يُطلب
    private fun sections(vararg behaviour:String)=object:MainAPI(){
        override val hasMainPage=true
        override val mainPage=behaviour.mapIndexed{i,_->MainPageData("قسم $i","/$i")}
        val asked=mutableListOf<String>()
        override suspend fun getMainPage(page:Int,request:MainPageRequest):HomePageResponse {
            asked+=request.data
            return when(behaviour[request.data.drop(1).toInt()]) {
                "throw"->throw NullPointerException("selector")
                "empty"->newHomePageResponse(request,emptyList(),false)
                else->newHomePageResponse(request,listOf(newAnimeSearchResponse("عمل ${request.data}","https://s.example${request.data}",fix=false)),true)
            }
        }
    }
    @Test fun brokenOrEmptyFirstSectionDoesNotHideTheRest()=runBlocking {
        val home=SourceOperations.home(sections("throw","empty","ok","ok"),1)
        assertEquals(listOf("عمل /2","عمل /3"),home.items.flatMap{it.list}.map{it.name});assertTrue(home.hasNext)
    }
    @Test fun stopsOnceEnoughSectionsAreFilled()=runBlocking {
        val api=sections("ok","ok","ok","ok","ok")
        SourceOperations.home(api,1,enough=2);assertEquals(listOf("/0","/1"),api.asked)
    }
    @Test fun budgetStopsNewSectionsButFirstAlwaysRuns()=runBlocking {
        var now=0L;val api=sections("empty","ok")
        val home=SourceOperations.home(api,1,budgetMs=5,clock={now.also{now+=10}})
        assertEquals(listOf("/0"),api.asked);assertTrue(home.items.all{it.list.isEmpty()})
    }
    @Test fun allSectionsFailingReportsTheRealFailure()=runBlocking {
        try{SourceOperations.home(sections("throw","throw"),1);fail("Fake catalogue success")}
        catch(expected:NullPointerException){assertEquals("selector",expected.message)}
    }
}
