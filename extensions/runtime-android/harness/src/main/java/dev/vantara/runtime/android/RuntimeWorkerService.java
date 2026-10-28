package dev.vantara.runtime.android;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
/** Deliberate RED checkpoint. */
public final class RuntimeWorkerService extends Service {
    public IBinder onBind(Intent intent) { return null; }
}
