package dev.vantara.runtime.cloudstream

import android.content.Context
import com.lagradost.cloudstream3.plugins.BasePlugin
import com.lagradost.cloudstream3.plugins.Plugin

/** Supports both genuine CloudStream entrypoint contracts. Old published
 * extensions often extend BasePlugin directly; modern ones extend Plugin
 * and require a Context during load(). Both are legitimate published APIs.
 * Never loosen the class-loader identity or dynamic-code verification gates.
 */
internal object PluginAdmission {
    fun instantiate(type:Class<*>,loader:ClassLoader):BasePlugin {
        check(type.classLoader===loader&&BasePlugin::class.java.isAssignableFrom(type)){"ABI_MISMATCH"}
        return type.getDeclaredConstructor().newInstance() as BasePlugin
    }
    fun initialize(candidate:BasePlugin,context:Context?) {
        if(candidate is Plugin)candidate.load(checkNotNull(context){"PLUGIN_CONTEXT_REQUIRED"})
        else candidate.load()
    }
}
