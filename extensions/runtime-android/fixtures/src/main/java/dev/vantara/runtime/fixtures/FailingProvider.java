package dev.vantara.runtime.fixtures;
import dev.vantara.runtime.api.RuntimeAccess;
import dev.vantara.runtime.api.RuntimeProvider;
public final class FailingProvider implements RuntimeProvider {
    public void initialize(RuntimeAccess access) { throw new IllegalStateException("Partial initialization"); }
    public String invoke(String operation, String input, RuntimeAccess access) { return "{\"wronglyPublished\":true}"; }
}
