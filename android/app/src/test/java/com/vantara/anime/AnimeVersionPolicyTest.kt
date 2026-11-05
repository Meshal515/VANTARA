package com.vantara.anime

import com.vantara.anime.loader.AnimeVersionPolicy
import org.junit.Assert.*
import org.junit.Test

class AnimeVersionPolicyTest {
    @Test fun catalogueCannotClaimANewerVersionThanTheSignedApk() {
        assertThrows(IllegalArgumentException::class.java) {
            AnimeVersionPolicy.archive("14.29",29,"14.28",28)
        }
        assertThrows(IllegalArgumentException::class.java) {
            AnimeVersionPolicy.archive("14.28",29,"14.28",28)
        }
    }
    @Test fun absentLegacyVersionCodeStillRequiresTheDeclaredVersionName() {
        AnimeVersionPolicy.archive("14.28",0,"14.28",28)
        assertThrows(IllegalArgumentException::class.java) { AnimeVersionPolicy.archive("14.29",0,"14.28",28) }
    }
    @Test fun publisherVersionCodePreventsDowngradesButAllowsRealVersionNamingChanges() {
        assertThrows(IllegalArgumentException::class.java) { AnimeVersionPolicy.update("14.28",28,"14.27",27) }
        AnimeVersionPolicy.update("14.28",28,"14.1",29)
    }
    @Test fun existingRecordsWithoutVersionCodesCompareNumericVersionsNotLexicalText() {
        AnimeVersionPolicy.update("14.9",0,"14.10",10)
        assertThrows(IllegalArgumentException::class.java) { AnimeVersionPolicy.update("14.10",0,"14.9",9) }
    }
}
