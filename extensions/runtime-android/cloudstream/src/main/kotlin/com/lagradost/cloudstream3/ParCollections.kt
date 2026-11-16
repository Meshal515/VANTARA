package com.lagradost.cloudstream3

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** Concurrent map: providers use it to fetch several servers of one episode at once. Order is kept. */
suspend fun <A,B> List<A>.amap(f:suspend (A)->B):List<B> = coroutineScope { map{ async{f(it)} }.awaitAll() }
