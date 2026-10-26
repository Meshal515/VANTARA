import com.frostwire.jlibtorrent.SessionManager;

/**
 * Isolated native compatibility gate. This MUST NOT load torrents, publish
 * listening ports outside its test process, or touch production account data.
 * The real Windows worker / torrent data-source migration follows separately.
 */
public final class JlibtorrentNativeProbe {
    private JlibtorrentNativeProbe() { }

    public static void main(String[] args) {
        final long startNs = System.nanoTime();
        final SessionManager session = new SessionManager(false);
        try {
            session.start();
            if (!session.isRunning()) {
                throw new IllegalStateException("libtorrent JNI session failed to start");
            }
            long milliseconds = (System.nanoTime() - startNs) / 1_000_000L;
            System.out.println("jlibtorrent_windows_native_ready_ms=" + milliseconds);
            System.out.println("jni_backend=jlibtorrent-rasterbar");
            System.out.println("jni_platform=windows-x86_64");
        } finally {
            session.stop();
        }
        if (session.isRunning()) {
            throw new IllegalStateException("libtorrent JNI session did not stop");
        }
        System.out.println("jlibtorrent_windows_native_shutdown_ok=true");
    }
}
