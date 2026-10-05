package com.vantara.plugins.translation
import org.junit.Test
import org.junit.Assert.*
class PixelCacheTest {
 @Test fun `retained pixels obey byte and entry budgets and oversize frames are not retained`() {
  val cache=PixelCache<ByteArray>(2,100) {it.size.toLong()}
  cache["a"]=ByteArray(60);cache["b"]=ByteArray(60)
  assertNull(cache["a"]);assertNotNull(cache["b"])
  cache["huge"]=ByteArray(101);assertNull(cache["huge"])
  cache["c"]=ByteArray(20);cache["d"]=ByteArray(20)
  assertNull(cache["b"]);assertEquals(40,cache.retainedBytes)
  cache.remove("c");assertEquals(20,cache.retainedBytes)
  cache.clear();assertEquals(0,cache.retainedBytes)
 }
}
