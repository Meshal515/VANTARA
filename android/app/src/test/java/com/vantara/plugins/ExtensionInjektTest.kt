package com.vantara.plugins

import kotlinx.serialization.json.Json
import kotlinx.serialization.protobuf.ProtoBuf
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.InjektModule
import uy.kohesive.injekt.api.InjektRegistrar
import uy.kohesive.injekt.api.get

/** What Mihon/Aniyomi's AppModule gives extensions must resolve in VANTARA too, or their static initializers fail. */
class ExtensionInjektTest {
    @Test fun extensionsResolveTheSerializationFormatsMihonProvides() {
        Injekt.importModule(object : InjektModule { override fun InjektRegistrar.registerInjectables() { registerExtensionFormats() } })
        assertSame("Manga Million's static initializer takes ProtoBuf from Injekt", ProtoBuf, Injekt.get<ProtoBuf>())
        assertTrue(Injekt.get<Json>().configuration.ignoreUnknownKeys)
    }
}
