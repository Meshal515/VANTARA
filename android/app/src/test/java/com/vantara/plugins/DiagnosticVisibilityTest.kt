package com.vantara.plugins

import org.junit.Assert.*
import org.junit.Test

class DiagnosticVisibilityTest {
    @Test fun compiledBuildDeniesStableEvenWithEnabledPreference() {
        assertEquals(com.vantara.app.BuildConfig.DEBUG, DiagnosticVisibility.forBuild(true))
        assertFalse(DiagnosticVisibility.forBuild(false))
    }
    @Test fun stableDeniesBothPreferences() {
        assertFalse(DiagnosticVisibility.allowed(false, false))
        assertFalse(DiagnosticVisibility.allowed(false, true))
    }
    @Test fun debugNeedsExplicitPreference() {
        assertFalse(DiagnosticVisibility.allowed(true, false))
        assertTrue(DiagnosticVisibility.allowed(true, true))
    }
}
