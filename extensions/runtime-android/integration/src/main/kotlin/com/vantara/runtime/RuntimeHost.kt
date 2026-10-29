package com.vantara.runtime

import android.content.Context
import android.util.AtomicFile
import com.vantara.anime.AnimeEngine
import com.vantara.anime.RuntimeSourceBinding
import com.vantara.anime.adapters.*
import com.vantara.anime.registry.*
import com.vantara.anime.stream.Candidate
import com.vantara.addons.NativeAddonCandidates
import com.vantara.verification.VerificationCoordinator
import com.vantara.verification.VerificationPending
import com.vantara.verification.VerificationPolicy
import dev.vantara.runtime.android.*
import dev.vantara.runtime.api.RuntimeHttpAccess
import dev.vantara.runtime.http.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Clock
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** New-family storage and workers only. No changes to existing APK sources or user databases. */
class RuntimeHost(
    context: Context,
    private val engine: AnimeEngine,
    private val userAgent: String,
    private val vaults: HttpBroker.Vaults = FileCookieVaults(File(context.filesDir,"runtime-cloudstream-v1/cookies").toPath()),
    private val broker: HttpBroker = HttpBroker(OkHttpClient(), Dns.SYSTEM, PublicAddresses(),
        vaults, Clock.systemUTC()),
    private val sourceTransport: (AndroidRuntimeClient.Scope,HttpBroker)->AndroidRuntimeClient.HostHttpTransport = { scope,http -> BrokerHostTransport(scope,http) },
) {
    private val app = context.applicationContext
    private val directory = File(app.filesDir,"runtime-cloudstream-v1")
    private val lock = Any()
    private val slots = Semaphore(2)
    private val workers = ConcurrentHashMap<AndroidRuntimeClient,AndroidRuntimeClient.Scope>()
    private var epoch = 0L
    @Volatile private var closed=false
    private val packageEpochs=HashMap<String,Long>()
    private data class Owner(val id: String, val epoch: Long, val store: RuntimePackageStore)
    @Volatile private var owner = Owner("local",0,RuntimePackageStore(File(directory,"packages").toPath(),"local"))
    private val indexes = ConcurrentHashMap<String,Pair<Long,JsonArray>>()
    private data class Retry(val owner: Owner,val generation: Long,val installed: RuntimePackageStore.Installed,val source: JsonObject,val id: String,val operation: String,val input: JsonObject,val url: String,val userAgent: String,val scope: AndroidRuntimeClient.Scope)
    private val pending = ConcurrentHashMap<String,Retry>()
    private val activeVerifications = ConcurrentHashMap<String,Retry>()
    private data class DependencyKey(val owner:String,val pkg:String,val hash:String,val source:String)
    // Only exact origins attested by source-owned settings, never keys/cookies.
    private val dependencyOrigins=HashMap<DependencyKey,Set<String>>()
    /** Bound operations per visible source id, for diagnostics that need the raw provider answer. */
    private val invokers=ConcurrentHashMap<String,suspend (String,JsonObject)->JsonObject>()

    fun setProfile(id: String) = synchronized(lock) {
        check(!closed) { "PROFILE_CHANGED" }
        require(id.isNotBlank() && id.length <= 200) { "PROFILE_REQUIRED" }
        if (owner.id != id) {
            workers.keys.forEach { it.close() }; workers.clear(); epoch++
            engine.setRuntimeSources(emptyList())
            owner = Owner(id,epoch,RuntimePackageStore(File(directory,"packages").toPath(),id))
            indexes.clear()
            pending.clear();activeVerifications.clear();dependencyOrigins.clear()
        }
        refresh(owner)
    }
    private fun checkOwner(captured: Owner) { check(!closed && owner === captured) { "PROFILE_CHANGED" } }
    private fun checkPackage(o: Owner,pkg: String,generation: Long) {
        checkOwner(o);check((packageEpochs[pkg] ?: 0L)==generation) { "PACKAGE_CHANGED" }
    }
    private fun repositoryFile(o: Owner) = AtomicFile(File(directory,"repositories/${digest(o.id)}.json"))
    private fun repositories(o: Owner): JsonArray {
        val f = repositoryFile(o)
        if (!f.baseFile.exists() && !File(f.baseFile.path+".bak").exists()) return JsonArray(emptyList())
        require(f.baseFile.length() <= 256*1024) { "REPOSITORY_STORAGE_LIMIT" }
        return f.openRead().use { RuntimeJson.parse(it.bufferedReader().readText()).jsonArray }
    }
    private fun saveRepositories(o: Owner, rows: JsonArray) = synchronized(lock) {
        checkOwner(o); require(rows.size <= 32) { "REPOSITORY_LIMIT" }
        val bytes=rows.toString().toByteArray();require(bytes.size<=256*1024) { "REPOSITORY_STORAGE_LIMIT" }
        val f = repositoryFile(o); f.baseFile.parentFile?.mkdirs()
        val stream = f.startWrite()
        try { stream.write(bytes); f.finishWrite(stream) }
        catch (error: Throwable) { f.failWrite(stream); throw error }
    }
    private fun endpoint(url: String): HttpUrl {
        require(url.length in 1..8192 && url.none { it.code < 33 || it.code == 127 }) { "INVALID_ENDPOINT" }
        val value = url.toHttpUrl()
        require(value.isHttps && value.username.isEmpty() && value.password.isEmpty() && value.fragment == null) { "INVALID_ENDPOINT" }
        return value
    }
    /** A source's own site may still be plain HTTP; repositories and packages stay HTTPS-only. */
    private fun sourceEndpoint(url: String): HttpUrl {
        require(url.length in 1..8192 && url.none { it.code < 33 || it.code == 127 }) { "INVALID_ENDPOINT" }
        val value = url.toHttpUrl()
        require(value.username.isEmpty() && value.password.isEmpty() && value.fragment == null) { "INVALID_ENDPOINT" }
        return value
    }
    private fun repositoryOrigins(url: HttpUrl): Set<String> {
        val own = HttpBroker.origin(url)
        // These are public package distribution endpoints, never source-site permission grants.
        return if (url.host in setOf("github.com","raw.githubusercontent.com","objects.githubusercontent.com","release-assets.githubusercontent.com"))
            setOf(own,"https://github.com","https://raw.githubusercontent.com","https://objects.githubusercontent.com","https://release-assets.githubusercontent.com") else setOf(own)
    }
    private fun fetch(o: Owner,url: String): ByteArray {
        checkOwner(o)
        val parsed = endpoint(url)
        val scope = HttpBroker.Scope("cloudstream","repository","repository",o.id,repositoryOrigins(parsed))
        broker.open(scope).use { session ->
            val output = session.execute(HttpBroker.Input(parsed.toString(),"GET",Headers.headersOf("User-Agent",userAgent),null,true))
            require(output.status() == 200) { "REPOSITORY_HTTP_${output.status()}" }
            checkOwner(o); return output.body()
        }
    }
    suspend fun addRepository(url: String): JsonObject = withContext(Dispatchers.IO) {
        val o = owner; val canonical = endpoint(url).toString()
        val raw = RuntimeJson.parse(fetch(o,canonical).decodeToString()).jsonObject
        val lists = raw["pluginLists"]?.jsonArray ?: error("NOT_CLOUDSTREAM_REPOSITORY")
        require(lists.size in 1..16 && lists.all { it is JsonPrimitive && it.isString }) { "INVALID_REPOSITORY_INDEX" }
        lists.forEach { endpoint(it.jsonPrimitive.content) }
        val row = buildJsonObject {
            put("url",canonical); put("name",raw.text("name").take(160).ifBlank { endpoint(canonical).host })
            put("pluginLists",lists); raw["iconUrl"]?.let { put("iconUrl",it) }
        }
        val rows = repositories(o).filter { it.jsonObject.text("url") != canonical } + row
        saveRepositories(o,JsonArray(rows)); row
    }
    fun removeRepository(url: String) {
        val o = owner
        saveRepositories(o,JsonArray(repositories(o).filter { it.jsonObject.text("url") != url }))
        indexes.remove(o.id+"|"+url)
        // Unlinking a repository never uninstalls its sources.
    }
    private suspend fun index(o: Owner,url: String,force: Boolean=false): JsonArray = withContext(Dispatchers.IO) {
        checkOwner(o); val key=o.id+"|"+url
        indexes[key]?.takeIf { !force && System.currentTimeMillis()-it.first < 300000 }?.let { return@withContext it.second }
        val repo = repositories(o).map { it.jsonObject }.singleOrNull { it.text("url")==url } ?: error("REPOSITORY_NOT_SAVED")
        val rows = mutableListOf<JsonElement>()
        for (list in repo.getValue("pluginLists").jsonArray) {
            val data = RuntimeJson.parse(fetch(o,list.jsonPrimitive.content).decodeToString()).jsonArray
            require(rows.size + data.size <= 512) { "REPOSITORY_INDEX_LIMIT" }
            for (entry in data) {
                rows.add(RuntimeRepositoryEntry.decode(entry.jsonObject,url,repo.text("name")))
            }
        }
        checkOwner(o); val result=JsonArray(rows.distinctBy { it.jsonObject.text("pkg") }); indexes[key]=System.currentTimeMillis() to result; result
    }
    suspend fun extensions(url: String): JsonArray {
        val o=owner;val installed=o.store.inventory().installed().associateBy { it.packageId() }
        return JsonArray(index(o,url).map { raw ->
            val row=raw.jsonObject; val current=installed[row.text("pkg")]
            JsonObject(row + mapOf("installed" to JsonPrimitive(current!=null),"anime" to JsonPrimitive(true),"protocol" to JsonPrimitive("cloudstream"),
                "update" to JsonPrimitive(current!=null && (row["version"]?.jsonPrimitive?.intOrNull ?: 0)>current.version())))
        })
    }
    fun list(): JsonObject {
        val o=owner;val inventory=o.store.inventory()
        val unreadable=inventory.unreadable().map { buildJsonObject { put("pkg",it.packageId());put("error",it.code()) } }.toMutableList()
        val installed=inventory.installed().mapNotNull {
            try { installedRow(it,o.id) } catch (_: Exception) { unreadable.add(buildJsonObject { put("pkg",it.packageId());put("error","PACKAGE_METADATA_UNREADABLE") });null }
        }
        return buildJsonObject {
            put("repos",repositories(o))
            put("installed",JsonArray(installed))
            put("unreadable",JsonArray(unreadable))
        }
    }
    private fun installedRow(installed: RuntimePackageStore.Installed,account: String): JsonObject {
        val metadata=RuntimeJson.parse(installed.metadata()).jsonObject
        return JsonObject(metadata + mapOf("pkg" to JsonPrimitive(installed.packageId()),"version" to JsonPrimitive(installed.version()),
            "installed" to JsonPrimitive(true),"protocol" to JsonPrimitive("cloudstream"),"anime" to JsonPrimitive(true),
            "repo" to JsonPrimitive(metadata.text("repoUrl")),"repositoryName" to JsonPrimitive(metadata.text("repoName")),
            "sourceIds" to JsonArray(metadata["registration"]?.jsonObject?.get("sources")?.jsonArray.orEmpty().map { source -> JsonPrimitive(sourceId(installed.packageId(),source.jsonObject.text("name"),account)) })))
    }
    suspend fun install(repo: String,pkg: String,content: String): JsonObject = withContext(Dispatchers.IO) {
        val o=owner
        require(content in setOf("anime","cinema")) { "UNSUPPORTED_CONTENT" }
        val row=index(o,repo,true).map { it.jsonObject }.singleOrNull { it.text("pkg")==pkg } ?: error("PACKAGE_NOT_IN_REPOSITORY")
        val bytes=fetch(o,row.text("url"));val observed=digest(bytes)
        val declared=row.text("sha256").lowercase()
        require(declared.isBlank() || declared==observed) { "PACKAGE_HASH_MISMATCH" }
        directory.mkdirs(); val download=File.createTempFile("cs3-download-",".part",directory)
        try {
            download.outputStream().use { it.write(bytes) }
            installFile(o,download,observed,pkg,JsonObject(row+mapOf("content" to JsonPrimitive(content),"enabled" to JsonPrimitive(true))))
        } finally { download.delete() }
    }
    /** Also used by device integration tests with real pinned archives and an isolated test broker. */
    suspend fun installFile(file: File,hash: String,pkg: String,metadata: JsonObject): JsonObject = installFile(owner,file,hash,pkg,metadata)
    private suspend fun installFile(o: Owner,file: File,hash: String,pkg: String,metadata: JsonObject): JsonObject = slots.withPermit {
        require(pkg.matches(Regex("cs3_[0-9a-f]{32}"))) { "INVALID_PACKAGE_ID" }
        val generation=synchronized(lock) { checkOwner(o);packageEpochs[pkg] ?: 0L }
        o.store.stage(file,hash).use { candidate ->
            // Registration has no network permission. A plugin's load() cannot probe a source site.
            val scope=AndroidRuntimeClient.Scope("cloudstream",pkg,"registration",o.id,setOf("https://registration.example"))
            val registration=worker(o,generation,scope,candidate.dexFile(),candidate.candidate().dexHash(),candidate.candidate().entry(),
                AndroidRuntimeClient.HostTransport { _,_ -> throw IOException("INITIALIZATION_NETWORK_DENIED") }) { client ->
                RuntimeJson.parse(client.invokeJson("capabilities","{}",3000).await()).jsonObject
            }
            val sources=RuntimeRegistration.validate(registration,pkg)
            val installed=synchronized(lock) {
                checkPackage(o,pkg,generation)
                val previous=o.store.current(pkg)?.let { RuntimeJson.parse(it.metadata()).jsonObject }
                val stored=JsonObject(metadata+mapOf("registration" to registration,"enabled" to (previous?.get("enabled") ?: metadata["enabled"] ?: JsonPrimitive(true))))
                val retained=o.store.inventory().installed().filter { it.packageId()!=pkg }
                val retainedCount=retained.sumOf { existing -> runCatching { RuntimeJson.parse(existing.metadata()).jsonObject.getValue("registration").jsonObject.getValue("sources").jsonArray.size }.getOrDefault(0) }
                require(retained.size<128 && retainedCount+sources.size<=128) { "RUNTIME_SOURCE_LIMIT" }
                candidate.activate(pkg,stored.toString()).also { stopPackage(pkg);refresh(o) }
            }
            installedRow(installed,o.id)
        }
    }
    fun enable(pkg: String,enabled: Boolean) = synchronized(lock) {
        val o=owner;val current=o.store.current(pkg) ?: error("PACKAGE_NOT_INSTALLED")
        val data=RuntimeJson.parse(current.metadata()).jsonObject
        o.store.updateMetadata(pkg,JsonObject(data+mapOf("enabled" to JsonPrimitive(enabled))).toString()); if(!enabled)stopPackage(pkg);refresh(o)
    }
    /**
     * The provider's raw answer for one operation (for example `videoLinks` with its `missingExtractors`).
     * Same worker, scope and policy as normal use; only the result is not reshaped.
     */
    suspend fun diagnose(sourceId: String,operation: String,input: JsonObject): JsonObject {
        val call=invokers[sourceId] ?: error("SOURCE_NOT_INSTALLED")
        return call(operation,input)
    }
    fun uninstall(pkg: String) = synchronized(lock) { val o=owner;o.store.uninstall(pkg);stopPackage(pkg);refresh(o) }
    suspend fun seasons(anime: SourceAnime): List<SourceAnime> {
        val o=owner;checkOwner(o)
        require(anime.sourceId.startsWith("addon|cs3|cs3_") && engine.runtimeSource(anime.sourceId)!=null) { "SOURCE_NOT_INSTALLED" }
        val adapter=engine.adapter(anime.sourceId) ?: error("SOURCE_DISABLED")
        val result=adapter.seasons(anime);checkOwner(o);return result
    }
    private fun stopPackage(pkg: String) {
        packageEpochs[pkg]=(packageEpochs[pkg] ?: 0L)+1L
        workers.filterValues { it.packageId()==pkg }.keys.forEach { it.close();workers.remove(it) }
        pending.entries.removeAll { it.value.installed.packageId()==pkg }
        activeVerifications.entries.removeAll { it.value.installed.packageId()==pkg }
        dependencyOrigins.keys.removeAll { it.pkg==pkg }
    }
    private fun refresh(o: Owner) {
        checkOwner(o)
        val bindings=mutableListOf<RuntimeSourceBinding>()
        for (installed in o.store.inventory().installed()) {
            try {
                val metadata=RuntimeJson.parse(installed.metadata()).jsonObject
                val enabled=metadata["enabled"]?.jsonPrimitive?.booleanOrNull != false
                val content=metadata.text("content").takeIf { it in setOf("anime","cinema") } ?: "anime"
                val packageBindings=mutableListOf<RuntimeSourceBinding>()
                for (raw in RuntimeRegistration.validate(metadata.getValue("registration").jsonObject,installed.packageId())) {
                    val source=raw.jsonObject;val id=sourceId(installed.packageId(),source.text("name"),o.id);val origin=sourceEndpoint(source.text("mainUrl"))
                    val name=source.text("name")
                    // A publisher's VPN note is shown to the user, never turned into a block: the decision is theirs.
                    val advisory=if(metadata.text("description").contains("VPN",true) || RuntimeRegistration.vpnMightBeNeeded(source))
                        "ينبّه ناشر هذا المصدر إلى أن الموقع قد يحظر بعض الشبكات؛ إن تعذّر التحميل جرّب شبكة أخرى أو VPN." else null
                    val entry=SourceEntry(id,name,source.text("lang").ifBlank { "und" },enabled=enabled,content=content,domains=Domains(origin.toString()),advisory=advisory)
                    val call:suspend (String,JsonObject)->JsonObject={ operation,input -> invoke(o,installed,source,id,operation,input) }
                    invokers[id]=call
                    val adapter=RuntimeSourceAdapter(id,name,call)
                    packageBindings.add(RuntimeSourceBinding(entry,adapter,installed.packageId(),installed.version().toString(),metadata.text("repoName"),metadata.text("repoUrl"),metadata.text("iconUrl").ifBlank { null }))
                }
                require(bindings.size+packageBindings.size<=128) { "RUNTIME_SOURCE_LIMIT" };bindings.addAll(packageBindings)
            } catch (_: Exception) { android.util.Log.w("VantaraRuntime","PACKAGE_METADATA_UNREADABLE:${installed.packageId()}") }
        }
        engine.setRuntimeSources(bindings)
    }
    private suspend fun invoke(o: Owner,installed: RuntimePackageStore.Installed,source: JsonObject,id: String,operation: String,input: JsonObject): JsonObject = slots.withPermit {
        val key=DependencyKey(o.id,installed.packageId(),installed.packageHash(),id)
        val origins=RuntimeNetworkPolicy.sourceOrigins(installed.packageHash(),source.text("mainUrl"),
            synchronized(lock) { checkOwner(o);dependencyOrigins[key].orEmpty() })
        val learned=java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        val started=System.nanoTime()
        var rejected:RuntimeFailure?=null
        val initial=try { invokeOnce(o,installed,source,id,operation,input,origins,{ learned.add(it) }) }
        catch(failure:RuntimeFailure) { rejected=failure;null }
        val permissionChanged=RuntimeNetworkPolicy.PUBLIC_INTERNET !in origins && learned.any { it !in origins }
        // Some published providers catch a denied media request and return an
        // empty result. Attested media still needs the same single scope sync.
        if(!permissionChanged || operation !in setOf("catalogue","search","details","episodes","videoLinks") || (rejected!=null && rejected.code!="ORIGIN_NOT_ALLOWED")) {
            rejected?.let { throw it };return@withPermit initial!!
        }
        run {
            // A permission sync replay, once, only after an attested settings
            // migration. Keep the original load10s + operation15s total budget.
            val remaining=25000L-java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)
            if(remaining<=0)throw IllegalStateException("OPERATION_TIMEOUT")
            val synchronizedOrigins=RuntimeNetworkPolicy.sourceOrigins(installed.packageHash(),source.text("mainUrl"),synchronized(lock) { checkOwner(o);dependencyOrigins[key].orEmpty() })
            try { withTimeout(remaining) { invokeOnce(o,installed,source,id,operation,input,synchronizedOrigins,{ learned.add(it) }) } }
            catch(timeout:TimeoutCancellationException){throw IllegalStateException("OPERATION_TIMEOUT",timeout)}
        }
    }
    private suspend fun invokeOnce(o:Owner,installed:RuntimePackageStore.Installed,source:JsonObject,id:String,operation:String,input:JsonObject,origins:Set<String>,learned:(String)->Unit):JsonObject {
        val generation=synchronized(lock) { checkOwner(o);packageEpochs[installed.packageId()] ?: 0L }
        val current=o.store.current(installed.packageId()) ?: error("PACKAGE_NOT_INSTALLED")
        check(current.packageHash()==installed.packageHash()) { "PACKAGE_CHANGED" }
        val metadata=RuntimeJson.parse(current.metadata()).jsonObject
        check(metadata["enabled"]?.jsonPrimitive?.booleanOrNull != false) { "SOURCE_DISABLED" }
        val scope=AndroidRuntimeClient.Scope("cloudstream",installed.packageId(),id,o.id,origins)
        val bound=sourceTransport(scope,broker)
        val transport=object: AndroidRuntimeClient.HostHttpTransport {
            override fun exchange(caller: AndroidRuntimeClient.Scope,request: RuntimeHttpAccess.Request): RuntimeHttpAccess.Response {
                synchronized(lock) { checkPackage(o,installed.packageId(),generation) }
                val headers=java.util.TreeMap<String,List<String>>(String.CASE_INSENSITIVE_ORDER);headers.putAll(request.headers())
                headers.putIfAbsent("User-Agent",listOf(userAgent))
                val outbound=RuntimeHttpAccess.Request(request.url(),request.method(),headers,request.body(),request.followRedirects())
                return try {
                    val result=bound.exchange(caller,outbound)
                    RuntimeNetworkPolicy.trustedSettingsOrigin(installed.packageHash(),source.text("mainUrl"),outbound,result)?.let { origin ->
                        synchronized(lock) {
                            checkPackage(o,installed.packageId(),generation)
                            val key=DependencyKey(o.id,installed.packageId(),installed.packageHash(),id)
                            val retained=dependencyOrigins[key].orEmpty().filterNot { origin.endsWith("-dsn.algolia.net") && it.endsWith("-dsn.algolia.net") }.toSet()
                            dependencyOrigins[key]=retained+origin
                            learned(origin)
                        }
                    }
                    result
                }
                catch (failure: RuntimeFailure) {
                    if(failure.code=="VERIFICATION_REQUIRED") {
                        val actualUserAgent=headers["User-Agent"]?.firstOrNull() ?: userAgent
                        synchronized(lock) {
                            checkPackage(o,installed.packageId(),generation)
                            pending[id]=Retry(o,generation,installed,source,id,operation,input,request.url(),actualUserAgent,scope)
                            VerificationCoordinator.require(sourceEndpoint(request.url()),actualUserAgent,kind="cloudstream",sourceName=source.text("name"))
                        }
                    }
                    throw failure
                }
            }
            override fun close() { bound.close() }
        }
        val payload=JsonObject(input+mapOf("source" to source.getValue("name")))
        try {
            val result=worker(o,generation,scope,installed.dexFile(),installed.dexHash(),installed.entry(),transport) { client -> RuntimeJson.parse(client.invokeJson(operation,payload.toString(),15000).await()) }
            synchronized(lock) { checkPackage(o,installed.packageId(),generation) }
            val latest=o.store.current(installed.packageId()) ?: error("PACKAGE_NOT_INSTALLED")
            check(latest.packageHash()==installed.packageHash() && RuntimeJson.parse(latest.metadata()).jsonObject["enabled"]?.jsonPrimitive?.booleanOrNull!=false) { "PACKAGE_CHANGED" }
            // Search's published ABI returns a list; all other operations return objects.
            return if(result is JsonArray) buildJsonObject { put("items",result);put("hasNext",false) } else result.jsonObject
        } finally { transport.close() }
    }
    private suspend fun <T> worker(o: Owner,generation: Long,scope: AndroidRuntimeClient.Scope,dex: File,hash: String,entry: String,transport: AndroidRuntimeClient.HostTransport,run: suspend (AndroidRuntimeClient)->T): T {
        val client=synchronized(lock) {
            checkPackage(o,scope.packageId(),generation)
            AndroidRuntimeClient(app,scope,transport).also { workers[it]=scope }
        }
        try { client.loadCloudStream(dex,hash,entry).await();return run(client) }
        finally { workers.remove(client);client.close() }
    }
    fun verificationHosts(): List<String> = pending.values.filter { it.owner===owner }.map { sourceEndpoint(it.url).host }.distinct()
    fun beginVerification(host: String): VerificationPending = synchronized(lock) {
        val retry=pending.values.firstOrNull { it.owner===owner && sourceEndpoint(it.url).host==host } ?: error("VERIFICATION_NOT_PENDING")
        checkPackage(retry.owner,retry.installed.packageId(),retry.generation)
        val original=VerificationCoordinator.pending().firstOrNull { it.host==host } ?: error("VERIFICATION_NOT_PENDING")
        require(original.userAgent==retry.userAgent) { "VERIFICATION_SESSION_MISMATCH" }
        val item=VerificationCoordinator.begin(host) ?: error("VERIFICATION_BUSY")
        activeVerifications[item.token]=retry;item
    }
    fun verificationProfile(item: VerificationPending): String = synchronized(lock) {
        val retry=activeVerifications[item.token] ?: error("VERIFICATION_EXPIRED")
        checkPackage(retry.owner,retry.installed.packageId(),retry.generation)
        "runtime_"+digest(retry.scope.sourceId()) // sourceId already includes stable account and package identity.
    }
    suspend fun completeVerification(item: VerificationPending,clearance: String): JsonObject {
        val retry=activeVerifications.remove(item.token) ?: error("VERIFICATION_EXPIRED")
        synchronized(lock) {
            checkPackage(retry.owner,retry.installed.packageId(),retry.generation)
            require(VerificationCoordinator.pending().any { it.host==item.host && it.token==item.token && it.state=="active" }) { "VERIFICATION_EXPIRED" }
            require(VerificationPolicy.clearance("cf_clearance=$clearance")==clearance) { "INVALID_CLEARANCE" }
            val url=sourceEndpoint(retry.url)
            require(url.host==item.host && HttpBroker.origin(url)==item.origin && item.userAgent==retry.userAgent) { "VERIFICATION_SESSION_MISMATCH" }
            val scope=HttpBroker.Scope(retry.scope.family(),retry.scope.packageId(),retry.scope.sourceId(),retry.scope.sessionId(),retry.scope.allowedOrigins())
            // Precisely one host-only clearance, scoped to the challenged source/account.
            // No login cookies, app CookieManager, localStorage or existing sessions are copied/cleared.
            val cookie=Cookie.Builder().name("cf_clearance").value(clearance).hostOnlyDomain(url.host).path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+1800000).build()
            vaults.forScope(scope).save(url,listOf(cookie))
            broker.verificationSucceeded(scope,HttpBroker.origin(url))
        }
        // Exactly one replay of the real source operation; a repeated challenge remains a failure.
        val response=invoke(retry.owner,retry.installed,retry.source,retry.id,retry.operation,retry.input)
        pending.remove(retry.id,retry)
        return buildJsonObject { put("ok",true);put("host",item.host);put("state","verified");put("replayedOperation",retry.operation);put("result",response) }
    }
    fun close() = synchronized(lock) { closed=true;workers.keys.forEach { it.close() };workers.clear();pending.clear();activeVerifications.clear();dependencyOrigins.clear() }
    companion object {
        fun digest(value: String)=digest(value.toByteArray())
        fun digest(bytes: ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        fun packageId(repository: String,internalName: String)="cs3_"+digest(repository+"\u0000"+internalName).take(32)
        fun sourceId(pkg: String,name: String,account: String="local")="addon|cs3|$pkg|"+digest(name).take(24)+"|u"+digest(account).take(24)
    }
}

internal fun JsonObject.text(key: String)=get(key)?.let { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
internal suspend fun <T> CompletableFuture<T>.await(): T = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel(true) }
    whenComplete { value,error -> if (continuation.isActive) { if(error==null)continuation.resume(value) else continuation.resumeWithException(error.cause ?: error) } }
}
