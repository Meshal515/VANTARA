package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.mapper
import org.junit.Assert.*
import org.junit.Test

/** Resolve every observed method/field descriptor; metadata alone never proves it links. */
class ObservedAbiTest {
    private fun descriptor(type:Class<*>):String=when {
        type.isArray->type.name.replace('.','/')
        !type.isPrimitive->"L"+type.name.replace('.','/')+";"
        else->mapOf(Void.TYPE to "V",Boolean::class.javaPrimitiveType to "Z",Byte::class.javaPrimitiveType to "B",Char::class.javaPrimitiveType to "C",Short::class.javaPrimitiveType to "S",Int::class.javaPrimitiveType to "I",Long::class.javaPrimitiveType to "J",Float::class.javaPrimitiveType to "F",Double::class.javaPrimitiveType to "D").getValue(type)
    }
    @Test fun everyPinnedPublicHostReferenceHasExactExecutableDescriptor()=assertResolves("/API_REQUIREMENTS.json")
    /** All 43 plugins of the Arabic 3rabi repository, not only the four originally pinned packages. */
    @Test fun everyArabicRepositoryHostReferenceHasExactExecutableDescriptor()=assertResolves("/CS3_HOST_SURFACE_ARB.json")
    private fun assertResolves(resource:String) {
        val data=mapper.readTree(javaClass.getResourceAsStream(resource)?:error("ABI observations missing: $resource"))
        val absent=linkedSetOf<String>()
        for(profile in data.path("profiles")) {
            for(reference in profile.path("requiredHostMethods")) {
                val text=reference.asText();val owner=text.substringBefore(";->").removePrefix("L").replace('/','.');val member=text.substringAfter(";->")
                try {
                    val type=Class.forName(owner,false,javaClass.classLoader)
                    val found=if(member.startsWith("<init>"))type.constructors.any{c->"<init>("+c.parameterTypes.joinToString(""){descriptor(it)}+")V"==member}
                    else type.methods.any{m->m.name+"("+m.parameterTypes.joinToString(""){descriptor(it)}+")"+descriptor(m.returnType)==member}
                    if(!found)absent.add(text)
                }catch(failure:LinkageError){absent.add(text+" ["+failure.javaClass.simpleName+"]")}catch(failure:ClassNotFoundException){absent.add(text+" [class missing]")}
            }
            for(reference in profile.path("requiredHostFields")) {
                val text=reference.asText();val owner=text.substringBefore(";->").removePrefix("L").replace('/','.');val member=text.substringAfter(";->")
                try {if(Class.forName(owner,false,javaClass.classLoader).fields.none{it.name+":"+descriptor(it.type)==member})absent.add(text)}catch(failure:ClassNotFoundException){absent.add(text+" [class missing]")}
            }
        }
        assertTrue("Unresolved published-package host references:\n"+absent.joinToString("\n"),absent.isEmpty())
    }
}
