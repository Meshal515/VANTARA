package dev.vantara.runtime.http;

import org.junit.*;
import static org.junit.Assert.*;
import okhttp3.*;
import java.nio.file.*;
import java.util.*;

/** Disk reconstruction tests: no in-memory map can make the restart assertions pass. */
public class FileCookieVaultsTest {
    Path directory;
    HttpUrl url=HttpUrl.get("https://source.vantara.example/chapter");
    HttpBroker.Scope scope(String family,String pkg,String source,String account) {
        return new HttpBroker.Scope(family,pkg,source,account,Set.of("https://source.vantara.example"));
    }
    HttpBroker.Scope owner(){return scope("cloudstream","pkg","source","account");}
    @Before public void setup() throws Exception {directory=Files.createTempDirectory("runtime-cookie-restart");}
    @After public void cleanup() throws Exception {try(var paths=Files.walk(directory)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}}
    @Test public void cookiesSurviveNewVaultProcessStateWithoutTouchingOtherFiles() throws Exception {
        Path sentinel=directory.resolve("user-library.json");Files.writeString(sentinel,"keep-existing-user-data");
        var vault=new FileCookieVaults(directory).forScope(owner());
        vault.save(url,List.of(Cookie.parse(url,"clearance=valid; Path=/; Secure; HttpOnly")));
        var recovered=new FileCookieVaults(directory).forScope(owner());
        assertEquals("valid",recovered.load(url).get(0).value());
        assertEquals("keep-existing-user-data",Files.readString(sentinel));
    }
    @Test public void everyIdentityDimensionSeparatesSessions() {
        var vaults=new FileCookieVaults(directory);vaults.forScope(owner()).save(url,List.of(Cookie.parse(url,"secret=private; Path=/; Secure")));
        for(var other:List.of(scope("other","pkg","source","account"),scope("cloudstream","other","source","account"),scope("cloudstream","pkg","other","account"),scope("cloudstream","pkg","source","other")))
            assertTrue(new FileCookieVaults(directory).forScope(other).load(url).isEmpty());
    }
    @Test public void deletionAndCookiePathSurviveReconstruction() {
        var vaults=new FileCookieVaults(directory);var a=vaults.forScope(owner());
        a.save(url,List.of(Cookie.parse(url,"keep=ok; Path=/chapter; Secure"),Cookie.parse(url,"remove=old; Path=/; Secure")));
        a.save(url,List.of(Cookie.parse(url,"remove=expired; Path=/; Max-Age=0; Secure")));
        var recovered=new FileCookieVaults(directory).forScope(owner());
        assertEquals(1,recovered.load(url).size());assertTrue(recovered.load(HttpUrl.get("https://source.vantara.example/other")).isEmpty());
    }
    @Test public void independentlyOpenedHandlesCannotLoseEachOthersCookies() {
        var vaults=new FileCookieVaults(directory);var a=vaults.forScope(owner());var b=vaults.forScope(owner());
        a.save(url,List.of(Cookie.parse(url,"first=1; Path=/; Secure")));b.save(url,List.of(Cookie.parse(url,"second=2; Path=/; Secure")));
        assertEquals(2,new FileCookieVaults(directory).forScope(owner()).load(url).size());
    }
    @Test public void corruptOwnedFileFailsExplicitlyAndIsNeverReinitialized() throws Exception {
        new FileCookieVaults(directory).forScope(owner()).save(url,List.of(Cookie.parse(url,"secret=private; Path=/; Secure")));
        Path file;try(var paths=Files.list(directory)){file=paths.filter(p->p.toString().endsWith(".cookies")).findFirst().orElseThrow();}
        byte[] corrupt={1,2,3};Files.write(file,corrupt);
        try {new FileCookieVaults(directory).forScope(owner()).load(url);fail("Corrupt session silently reset");}
        catch(IllegalStateException expected){assertEquals("COOKIE_STORAGE_CORRUPT",expected.getMessage());}
        assertArrayEquals(corrupt,Files.readAllBytes(file));
    }
    @Test public void loginMaySetAndDeleteCookiesForAnotherPath() {
        HttpUrl login=HttpUrl.get("https://source.vantara.example/login");
        HttpUrl catalogue=HttpUrl.get("https://source.vantara.example/catalogue/list");
        var vaults=new FileCookieVaults(directory);var handle=vaults.forScope(owner());
        handle.save(login,List.of(Cookie.parse(login,"session=actual; Path=/catalogue; Secure; HttpOnly")));
        assertEquals("actual",new FileCookieVaults(directory).forScope(owner()).load(catalogue).get(0).value());
        assertTrue(handle.load(login).isEmpty());
        handle.save(login,List.of(Cookie.parse(login,"session=deleted; Path=/catalogue; Max-Age=0; Secure")));
        assertTrue(new FileCookieVaults(directory).forScope(owner()).load(catalogue).isEmpty());
    }
    @Test public void responseCannotMintCookieForUnrelatedHost() {
        var vault=new FileCookieVaults(directory).forScope(owner());
        Cookie unrelated=new Cookie.Builder().name("invalid").value("secret").domain("other.example").path("/").secure().build();
        vault.save(url,List.of(unrelated));
        assertTrue(vault.load(HttpUrl.get("https://other.example/")).isEmpty());
    }
}
