package com.vantara.runtime
import org.junit.Assert.*
import org.junit.Test
class RuntimeRecoveryGateTest {
    @Test fun needsThreeConsecutiveFaultsWithinWindowAndRateLimitsComparisons() {
        val gate=RuntimeRecoveryGate()
        assertFalse(gate.onFailure("account|rev|source|catalogue",1000))
        assertFalse(gate.onFailure("account|rev|source|catalogue",1001))
        assertTrue(gate.onFailure("account|rev|source|catalogue",1002))
        assertFalse(gate.onFailure("account|rev|source|catalogue",1003))
        assertFalse(gate.onFailure("account|rev|source|catalogue",601002))
        assertFalse(gate.onFailure("account|rev|source|catalogue",601003))
        assertTrue(gate.onFailure("account|rev|source|catalogue",601004))
    }
    @Test fun successfulOperationResetsFailureCountAndDifferentProfilesDoNotShareIt() {
        val gate=RuntimeRecoveryGate()
        assertFalse(gate.onFailure("account-a",0))
        assertFalse(gate.onFailure("account-a",1))
        assertFalse(gate.onFailure("account-b",1))
        gate.onSuccess("account-a")
        assertFalse(gate.onFailure("account-a",2))
        assertFalse(gate.onFailure("account-a",3))
        assertTrue(gate.onFailure("account-a",4))
        gate.clear()
        assertFalse(gate.onFailure("account-a",5))
    }
    @Test fun emptyJsonResultMustNotEraseTwoRecordedFunctionalFailures() {
        val gate=RuntimeRecoveryGate()
        assertFalse(gate.onFailure("source|catalogue",0))
        assertFalse(gate.onFailure("source|catalogue",1))
        val empty=kotlinx.serialization.json.buildJsonObject { put("items",kotlinx.serialization.json.JsonArray(emptyList())) }
        val health=RuntimeOperationHealth.assess("catalogue",kotlinx.serialization.json.JsonObject(emptyMap()),empty,kotlinx.serialization.json.JsonObject(emptyMap()))
        RuntimeOperationHealth.recordSuccess(gate,"source|catalogue",health)
        assertTrue("Empty catalogue was treated as success and erased recovery evidence",gate.onFailure("source|catalogue",2))
    }

}
