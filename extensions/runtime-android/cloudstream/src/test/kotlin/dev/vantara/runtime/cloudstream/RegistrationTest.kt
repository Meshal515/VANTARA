package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.plugins.BasePlugin
import com.lagradost.cloudstream3.utils.ExtractorApi
import org.junit.Assert.*
import org.junit.Test

class RegistrationTest {
    class LegacyEntrypoint:BasePlugin() {
        override fun load(){registerMainAPI(object:MainAPI(){override var name="legacy";override var mainUrl="https://legacy.example"})}
    }
    class ModernEntrypoint:com.lagradost.cloudstream3.plugins.Plugin()
    @Test fun actualHostAdmissionAcceptsLegacyBasePluginEntrypoints() {
        val type=LegacyEntrypoint::class.java
        val plugin=PluginAdmission.instantiate(type,checkNotNull(type.classLoader))
        val observed=Registration.collect {PluginAdmission.initialize(plugin,null)}
        assertEquals("legacy",observed.sources.single().name)
    }
    @Test fun modernPluginStillRequiresARealScopedAndroidContext() {
        val type=ModernEntrypoint::class.java
        val plugin=PluginAdmission.instantiate(type,checkNotNull(type.classLoader))
        try {PluginAdmission.initialize(plugin,null);fail("Modern plugin loaded without a worker Context")}
        catch(expected:IllegalStateException){assertEquals("PLUGIN_CONTEXT_REQUIRED",expected.message)}
    }

    @Test fun onlyCompletedInitializationPublishesRegisteredProviders() {
        val plugin=object:BasePlugin(){override fun load(){registerMainAPI(object:MainAPI(){override var name="actual";override var mainUrl="https://source.example"});registerExtractorAPI(object:ExtractorApi(){override val name="extractor"})}}
        val result=Registration.collect{plugin.load()}
        assertEquals("actual",result.sources.single().name);assertEquals("extractor",result.extractors.single().name)
    }
    @Test fun failedRegistrationCannotLeakToNextGeneration() {
        val plugin=object:BasePlugin(){override fun load(){registerMainAPI(MainAPI());error("initialization failed")}}
        try{Registration.collect{plugin.load()};fail("Failed initialization published")}catch(expected:IllegalStateException){assertEquals("initialization failed",expected.message)}
        assertTrue(Registration.collect{}.sources.isEmpty())
    }
    @Test fun registrationOutsideLoadIsRejected() {
        try{object:BasePlugin(){}.registerMainAPI(MainAPI());fail("Late registration allowed")}
        catch(expected:IllegalStateException){assertEquals("REGISTRATION_OUTSIDE_INITIALIZATION",expected.message)}
    }
    @Test fun nestedRegistrationCannotReplaceOwnersStagingArea() {
        try{Registration.collect{Registration.collect{}};fail("Nested registration accepted")}
        catch(expected:IllegalStateException){assertEquals("REGISTRATION_ALREADY_ACTIVE",expected.message)}
        assertTrue(Registration.collect{}.sources.isEmpty())
    }
}
