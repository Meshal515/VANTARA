package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.*
import java.io.IOException

object SourceOperations {
    suspend fun catalogue(source:MainAPI,page:Int,index:Int):HomePageResponse {
        if(!source.hasMainPage)throw UnsupportedOperationException("catalogue")
        require(page>0&&index>=0){"Invalid catalogue selection"}
        // Older providers return every home section themselves and do not declare mainPage.
        val section=if(source.mainPage.isEmpty()&&index==0)MainPageRequest("","",false)
            else source.mainPage.getOrNull(index)?.let{MainPageRequest(it.name,it.data,it.horizontalImages)}?:throw UnsupportedOperationException("catalogue section")
        return source.getMainPage(page,section)?:throw IOException("NO_CATALOGUE_RESULT")
    }

    /**
     * الصفحة الرئيسية كما يبنيها CloudStream: أقسام المصدر كلها لا الأول وحده، والقسم المعطوب أو
     * الفارغ يُتخطّى. كان طلب القسم 0 وحده يجعل مصدرًا سليمًا يبدو فارغًا أو معطوبًا إن تعطّل قسمه الأول
     * في الموقع. يتوقف عند [enough] أقسام فيها أعمال أو عند انتهاء [budgetMs] (مهلة العملية 15 ثانية).
     * لا يرمي إلا إن لم يُرجع أي قسم شيئًا، وحينها بأول عطل حقيقي.
     */
    suspend fun home(source:MainAPI,page:Int,budgetMs:Long=10_000,enough:Int=3,clock:()->Long={System.nanoTime()/1_000_000}):HomePageResponse {
        if(!source.hasMainPage)throw UnsupportedOperationException("catalogue")
        require(page>0){"Invalid catalogue selection"}
        if(source.mainPage.isEmpty())return catalogue(source,page,0)
        val started=clock()
        val lists=mutableListOf<HomePageList>();var hasNext=false;var failure:Throwable?=null
        for(index in source.mainPage.indices) {
            val filled=lists.count{it.list.isNotEmpty()}
            if(filled>=enough || (index>0 && clock()-started>=budgetMs))break
            try{val result=catalogue(source,page,index);lists+=result.items;hasNext=hasNext||result.hasNext}
            catch(cancel:kotlinx.coroutines.CancellationException){throw cancel}
            catch(fatal:VirtualMachineError){throw fatal}
            catch(error:Throwable){if(failure==null)failure=error}
        }
        if(lists.none{it.list.isNotEmpty()})failure?.let{throw it}
        return HomePageResponse(lists,hasNext)
    }
}
