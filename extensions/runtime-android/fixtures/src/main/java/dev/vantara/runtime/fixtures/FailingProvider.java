package dev.vantara.runtime.fixtures;
import dev.vantara.runtime.api.RuntimeAccess;
import dev.vantara.runtime.api.RuntimeProvider;
public final class FailingProvider implements RuntimeProvider {
    public void initialize(RuntimeAccess access) {
        Thread retained = new Thread(() -> {
            try { Thread.sleep(150); access.request("https://fixtures.example/retained-after-failure"); }
            catch (Exception ignored) { }
        });
        retained.setDaemon(true); retained.start();
        throw new IllegalStateException("Partial initialization");
    }
    public String invoke(String operation, String input, RuntimeAccess access) { return "{\"wronglyPublished\":true}"; }
}
