package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.MovieLoadResponse
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.mapper
import com.fasterxml.jackson.databind.JsonNode
import org.junit.Assert.*
import org.junit.Test

/** Exact boxed-nullable ABI observed in Mehdi Anime4Up v4, with real retained metadata. */
class ProviderExternalIdsTest {
    private fun work() = MovieLoadResponse("عمل", "https://source.example/work", "Source", TvType.Movie, "opaque")
    private fun add(name: String, work: LoadResponse, id: Int?) {
        val method = LoadResponse.Companion.javaClass.getMethod(name, LoadResponse::class.java, Int::class.javaObjectType)
        assertEquals(Void.TYPE, method.returnType)
        method.invoke(LoadResponse.Companion, work, id)
    }

    @Test fun observedMethodsRetainSeparateIdsAndNullDoesNotEraseThem() {
        val work = work()
        add("addMalId", work, 21)
        add("addAniListId", work, 21519)
        add("addKitsuId", work, 12)
        add("addMalId", work, null)
        val data = mapper.valueToTree<JsonNode>(work).path("syncData")
        assertEquals("21", data.path("mal").asText())
        assertEquals("21519", data.path("anilist").asText())
        assertEquals("12", data.path("kitsu").asText())
        val simkl = mapper.readTree(data.path("simkl").asText())
        assertEquals("21", simkl.path("Mal").asText())
        assertEquals("21519", simkl.path("AniList").asText())
        val get = LoadResponse.Companion.javaClass.getMethod("getMalId", LoadResponse::class.java)
        assertEquals("21", get.invoke(LoadResponse.Companion, work))
        assertEquals(0, mapper.valueToTree<JsonNode>(work()).path("syncData").size())
    }
}
