#define _GNU_SOURCE
#include <jni.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <linux/falloc.h>

/* Called synchronously inside read_piece_alert, before libtorrent releases its
 * shared buffer. No pointer is retained and no Java reflection/Unsafe is used. */
JNIEXPORT jbyteArray JNICALL
Java_com_vantara_addons_torrent_NativePieceBytes_copy(JNIEnv *env, jclass type, jlong address, jint length) {
    (void)type;
    if (address == 0 || length <= 0 || length > 16 * 1024 * 1024) {
        jclass error = (*env)->FindClass(env, "java/lang/IllegalArgumentException");
        (*env)->ThrowNew(env, error, "Invalid verified torrent piece");
        return NULL;
    }
    jbyteArray bytes = (*env)->NewByteArray(env, length);
    if (bytes != NULL) {
        (*env)->SetByteArrayRegion(env, bytes, 0, length, (const jbyte *)(uintptr_t)address);
    }
    return bytes;
}

/* النافذة المتحركة: يحرّر نطاقًا من ملف الفيديو على القرص (hole punch) ويبقي حجمه المنطقي.
 * ext4 وf2fs على أندرويد يدعمانه؛ الفشل يعيد false ولا يمس الملف. */
JNIEXPORT jboolean JNICALL
Java_com_vantara_addons_torrent_NativePieceBytes_punch(JNIEnv *env, jclass type, jstring path, jlong offset, jlong length) {
    (void)type;
    if (path == NULL || offset < 0 || length <= 0) return JNI_FALSE;
    const char *chars = (*env)->GetStringUTFChars(env, path, NULL);
    if (chars == NULL) return JNI_FALSE;
    int fd = open(chars, O_WRONLY | O_CLOEXEC);
    (*env)->ReleaseStringUTFChars(env, path, chars);
    if (fd < 0) return JNI_FALSE;
    int result = fallocate(fd, FALLOC_FL_PUNCH_HOLE | FALLOC_FL_KEEP_SIZE, (off_t)offset, (off_t)length);
    close(fd);
    return result == 0 ? JNI_TRUE : JNI_FALSE;
}
