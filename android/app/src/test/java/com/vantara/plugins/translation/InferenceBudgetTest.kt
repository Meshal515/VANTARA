package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException

class InferenceBudgetTest {
    @Test fun `cancel before acquisition rejects work`() {
        val budget = InferenceBudget(1000)
        budget.cancel()
        try { budget.check(); fail("cancelled work ran") } catch (_: CancellationException) {}
    }
    @Test fun `active termination callback runs once and is removed after exit`() {
        val budget = InferenceBudget(1000)
        var calls = 0
        val registration = budget.attach { calls++ }
        budget.cancel(); budget.cancel()
        assertEquals(1,calls)
        registration.close()
        assertEquals(0,budget.activeRuns())
    }
    @Test fun `deadline is monotonic and checked between expensive stages`() {
        var clock = 10L
        val budget = InferenceBudget(5) { clock }
        clock = 16
        try { budget.check(); fail("expired work ran") } catch (_: CancellationException) {}
    }
    @Test fun `detaching preserves a fresh owner`() {
        val old = InferenceBudget(1000)
        var calls = 0
        old.attach { calls++ }.close()
        old.cancel()
        val next = InferenceBudget(1000)
        next.check()
        assertEquals(0,calls)
    }
}
