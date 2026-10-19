package com.vantara.plugins;

import org.junit.Test;
import java.util.Base64;
import static org.junit.Assert.*;

public class GalleryImageTest {
    private static final byte[] PNG = new byte[] {(byte)137, 80, 78, 71, 13, 10, 26, 10, 1};

    @Test public void keepsImageBytesAndNormalizesFilenameExtension() {
        GalleryImage image = GalleryImage.parse(Base64.getEncoder().encodeToString(PNG), "image/png", "../frame.jpg");
        assertArrayEquals(PNG, image.bytes);
        assertEquals("image/png", image.mimeType);
        assertEquals("frame.png", image.filename);
    }

    @Test public void acceptsJpegAndRejectsMismatchedOrMalformedData() {
        byte[] jpeg = new byte[] {(byte)255, (byte)216, (byte)255, (byte)224, 1};
        assertEquals("capture.jpeg", GalleryImage.parse(Base64.getEncoder().encodeToString(jpeg), "image/jpeg", "capture.png").filename);
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parse(Base64.getEncoder().encodeToString(PNG), "image/jpeg", "x"));
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parse("***", "image/png", "x"));
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parse("", "image/png", "x"));
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parse("AAAA", "image/gif", "x"));
    }

    @Test public void validatesBoundedMp4PayloadAndUsesSafeVideoFilename() {
        byte[] mp4 = new byte[] {0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109};
        GalleryImage video = GalleryImage.parseVideo(Base64.getEncoder().encodeToString(mp4), "video/mp4", "../moment.png");
        assertArrayEquals(mp4, video.bytes);
        assertEquals("moment.mp4", video.filename);
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parseVideo("AAAA", "video/mp4", "x"));
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parseVideo(Base64.getEncoder().encodeToString(mp4), "video/webm", "x"));
        assertThrows(IllegalArgumentException.class, () -> GalleryImage.parseVideo("A".repeat(22_369_625), "video/mp4", "x"));
    }
}
