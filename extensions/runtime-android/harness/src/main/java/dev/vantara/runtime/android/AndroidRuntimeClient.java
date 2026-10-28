package dev.vantara.runtime.android;

import android.content.Context;
import java.io.File;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/** Deliberate RED checkpoint; replaced after the instrumentation acceptance test fails. */
public final class AndroidRuntimeClient implements AutoCloseable {
    public interface HostTransport { String request(Scope scope, String url) throws Exception; }
    public record Scope(String family, String packageId, String sourceId, String sessionId, Set<String> allowedOrigins) {}
    public record Identity(int pid, int uid) {}
    public AndroidRuntimeClient(Context context, Scope scope, HostTransport transport) {}
    public CompletableFuture<Identity> connect() { CompletableFuture result = new CompletableFuture(); result.completeExceptionally(new UnsupportedOperationException("WORKER_NOT_IMPLEMENTED")); return result; }
    public CompletableFuture<Void> load(File dex, String hash, String entry) { CompletableFuture result = new CompletableFuture(); result.completeExceptionally(new UnsupportedOperationException("WORKER_NOT_IMPLEMENTED")); return result; }
    public CompletableFuture<String> invoke(String operation, String input, long timeoutMs) { CompletableFuture result = new CompletableFuture(); result.completeExceptionally(new UnsupportedOperationException("WORKER_NOT_IMPLEMENTED")); return result; }
    public boolean isClosed() { return true; }
    public void close() {}
}
