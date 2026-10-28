package dev.vantara.runtime.fixtures;

import dev.vantara.runtime.api.RuntimeAccess;
import dev.vantara.runtime.api.RuntimeProvider;
import java.io.FileInputStream;
import android.os.Process;
import android.system.Os;
import android.system.OsConstants;
import android.system.ErrnoException;
import org.json.JSONObject;

/** Authored test executable, shipped only as instrumentation asset, not in the host. */
public final class FixtureProvider implements RuntimeProvider {
    private boolean initialized;
    public void initialize(RuntimeAccess access) { initialized = true; }
    public String invoke(String operation, String input, RuntimeAccess access) throws Exception {
        if (!initialized) throw new IllegalStateException("Not initialized");
        JSONObject args = new JSONObject(input);
        switch (args.optString("fixtureAction")) {
            case "exit": System.exit(73); throw new AssertionError("Process exit returned");
            case "hang": access.request("https://fixtures.example/hang-start"); while (true) { Thread.yield(); }
            case "oversize": char[] text = new char[65537]; java.util.Arrays.fill(text,'x'); return new String(text);
            case "throw": throw new IllegalArgumentException("provider failure");
            case "broker": return access.request(args.getString("url"));
            case "probe":
                boolean fileDenied = false, socketDenied = false;
                try (FileInputStream stream = new FileInputStream(args.getString("hostFile"))) {
                    stream.read();
                } catch (java.io.IOException expected) { fileDenied = true; }
                try { Os.close(Os.socket(OsConstants.AF_INET, OsConstants.SOCK_STREAM, 0)); }
                catch (ErrnoException e) { socketDenied = e.errno == OsConstants.EACCES || e.errno == OsConstants.EPERM; }
                return new JSONObject().put("pid", Process.myPid()).put("uid", Process.myUid())
                    .put("hostFileDenied", fileDenied).put("socketDenied", socketDenied).toString();
            default:
                if (operation.equals("details")) return "{\"item\":{\"id\":\"fixture\",\"title\":\"عمل تجريبي\"}}";
                if (operation.equals("videoLinks") || operation.equals("pages")) return "{\"items\":[{\"url\":\"https://fixtures.example/resource\"}]}";
                return "{\"items\":[{\"id\":\"fixture\",\"title\":\"عمل تجريبي\"}]}";
        }
    }
}
