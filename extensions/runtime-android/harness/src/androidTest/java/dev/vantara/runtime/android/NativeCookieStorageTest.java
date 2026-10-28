package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.vantara.runtime.http.*;
import okhttp3.*;
import org.junit.Test;
import java.nio.file.*;
import java.util.*;

/** Actual Android filesystem/API test. Controller reconstruction is not a full APK upgrade. */
public class NativeCookieStorageTest {
    @Test public void cookiesPersistOnAndroidWithoutAccountLeakOrLibraryMutation() throws Exception {
        Path root=Files.createTempDirectory(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir().toPath(),"cookie-native-");
        Path sentinel=root.resolve("user-library.json");Files.write(sentinel,"preserve-all-users".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        HttpUrl login=HttpUrl.get("https://source.example/login"),catalogue=HttpUrl.get("https://source.example/catalogue/list");
        HttpBroker.Scope owner=new HttpBroker.Scope("cloudstream","package","source","account",new HashSet<>(Arrays.asList("https://source.example")));
        try {
            new FileCookieVaults(root).forScope(owner).save(login,Arrays.asList(Cookie.parse(login,"session=actual; Path=/catalogue; Secure; HttpOnly")));
            assertEquals("actual",new FileCookieVaults(root).forScope(owner).load(catalogue).get(0).value());
            HttpBroker.Scope other=new HttpBroker.Scope("cloudstream","package","source","other-account",owner.origins());
            assertTrue(new FileCookieVaults(root).forScope(other).load(catalogue).isEmpty());
            assertEquals("preserve-all-users",new String(Files.readAllBytes(sentinel),java.nio.charset.StandardCharsets.UTF_8));
        }finally{try(java.util.stream.Stream<Path> paths=Files.walk(root)){for(Path p:paths.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.deleteIfExists(p);}}
    }
}
