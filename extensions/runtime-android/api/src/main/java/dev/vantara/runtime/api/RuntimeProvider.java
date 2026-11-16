package dev.vantara.runtime.api;

/** Original VANTARA profile, not a CloudStream/Aniyomi/Mihon binary ABI. */
public interface RuntimeProvider {
    void initialize(RuntimeAccess access) throws Exception;
    String invoke(String operation, String inputJson, RuntimeAccess access) throws Exception;
}
