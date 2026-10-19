package com.vantara.plugins;

import java.util.Base64;

/** Small, bounded bridge payload. Pixel decoding is checked separately on Android. */
final class GalleryImage {
    final byte[] bytes;
    final String mimeType;
    final String filename;

    private GalleryImage(byte[] bytes, String mimeType, String filename) {
        this.bytes = bytes;
        this.mimeType = mimeType;
        this.filename = filename;
    }

    static GalleryImage parse(String base64, String mimeType, String filename) {
        if (!"image/png".equals(mimeType) && !"image/jpeg".equals(mimeType)) {
            throw new IllegalArgumentException("Only PNG and JPEG images can be saved");
        }
        if (base64 == null || base64.isEmpty() || base64.length() > 45_000_000) {
            throw new IllegalArgumentException("Missing or oversized image");
        }
        byte[] bytes = Base64.getDecoder().decode(base64);
        boolean png = bytes.length >= 8 && (bytes[0] & 255) == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71
            && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10;
        boolean jpeg = bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255;
        if (!("image/png".equals(mimeType) ? png : jpeg)) throw new IllegalArgumentException("Invalid image format");
        return new GalleryImage(bytes, mimeType, safeName(filename, png ? ".png" : ".jpeg"));
    }

    static GalleryImage parseVideo(String base64, String mimeType, String filename) {
        if (!"video/mp4".equals(mimeType) || base64 == null || base64.isEmpty() || base64.length() > 22_369_624) {
            throw new IllegalArgumentException("Only MP4 videos up to 16 MiB can be saved");
        }
        byte[] bytes = Base64.getDecoder().decode(base64);
        if (bytes.length > 16 * 1024 * 1024 || bytes.length < 12 || bytes[4] != 'f' || bytes[5] != 't' || bytes[6] != 'y' || bytes[7] != 'p') {
            throw new IllegalArgumentException("Invalid MP4 video");
        }
        return new GalleryImage(bytes, mimeType, safeName(filename, ".mp4"));
    }

    private static String safeName(String filename, String extension) {
        String name = filename == null ? "" : filename.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("(?i)\\.(png|jpe?g|mp4)$", "");
        name = name.replaceAll("[^A-Za-z0-9_-]", "_");
        if (name.isEmpty()) name = "VANTARA-" + System.currentTimeMillis();
        if (name.length() > 100) name = name.substring(0, 100);
        return name + extension;
    }
}
