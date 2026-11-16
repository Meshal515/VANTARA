package dev.vantara.runtime.api;

/** Host-owned capability. No Android Context, file store, cookies or identity setters. */
public interface RuntimeAccess {
    String request(String httpsUrl) throws Exception;
}
