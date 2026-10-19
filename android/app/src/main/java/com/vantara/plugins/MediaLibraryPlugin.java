package com.vantara.plugins;

import android.Manifest;
import android.content.ContentValues;
import android.graphics.BitmapFactory;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.OutputStream;

/** Saves app-created images and MP4 moments without broad media access on Android 10+. */
@CapacitorPlugin(name = "MediaLibrary", permissions = {
    @Permission(alias = "legacyStorage", strings = {Manifest.permission.WRITE_EXTERNAL_STORAGE})
})
public class MediaLibraryPlugin extends Plugin {
    @PluginMethod
    public void saveImage(PluginCall call) {
        saveMedia(call, false);
    }

    @PluginMethod
    public void saveVideo(PluginCall call) {
        saveMedia(call, true);
    }

    private void saveMedia(PluginCall call, boolean video) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyStorage", call, "storagePermission");
            return;
        }
        getBridge().execute(() -> writeMedia(call, video));
    }

    @PermissionCallback
    private void storagePermission(PluginCall call) {
        if (getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            call.reject("اسمح بحفظ الصور في إعدادات التطبيق ثم جرّب مرة ثانية", "STORAGE_PERMISSION_DENIED");
            return;
        }
        getBridge().execute(() -> writeMedia(call, "saveVideo".equals(call.getMethodName())));
    }

    private void writeMedia(PluginCall call, boolean video) {
        // Permission results arrive on the UI thread; every caller dispatches this I/O to the bridge worker.
        Uri uri = null;
        File legacyFile = null;
        try {
            GalleryImage image = video
                ? GalleryImage.parseVideo(call.getString("base64"), call.getString("mimeType"), call.getString("filename"))
                : GalleryImage.parse(call.getString("base64"), call.getString("mimeType"), call.getString("filename"));
            if (!video) {
                BitmapFactory.Options size = new BitmapFactory.Options();
                size.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.length, size);
                if (size.outWidth <= 0 || size.outHeight <= 0 || (long) size.outWidth * size.outHeight > 16_000_000) {
                    throw new IllegalArgumentException("Invalid or oversized image dimensions");
                }
            }
            String directoryName = video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES;
            Uri collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, image.filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, image.mimeType);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, directoryName + "/VANTARA");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            } else {
                File directory = new File(Environment.getExternalStoragePublicDirectory(directoryName), "VANTARA");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("Cannot create gallery folder");
                legacyFile = File.createTempFile(image.filename.substring(0, image.filename.lastIndexOf('.')) + "-", image.filename.substring(image.filename.lastIndexOf('.')), directory);
                values.put(MediaStore.Images.Media.DATA, legacyFile.getAbsolutePath());
                values.put(MediaStore.Images.Media.DISPLAY_NAME, legacyFile.getName());
            }
            uri = getContext().getContentResolver().insert(collection, values);
            if (uri == null) throw new java.io.IOException("Cannot create gallery image");
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
                if (output == null) throw new java.io.IOException("Cannot open gallery image");
                output.write(image.bytes);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Images.Media.IS_PENDING, 0);
                if (getContext().getContentResolver().update(uri, ready, null, null) != 1) throw new java.io.IOException("Cannot publish gallery image");
            } else {
                MediaScannerConnection.scanFile(getContext(), new String[] {legacyFile.getAbsolutePath()}, new String[] {image.mimeType}, null);
            }
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("filename", legacyFile == null ? image.filename : legacyFile.getName());
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) {
                try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) { }
            }
            if (legacyFile != null) legacyFile.delete();
            call.reject("تعذّر الحفظ في المعرض. تأكد من توفر مساحة ثم جرّب مرة ثانية", video ? "SAVE_VIDEO_FAILED" : "SAVE_IMAGE_FAILED", error);
        }
    }
}
