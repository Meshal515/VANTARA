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
}
