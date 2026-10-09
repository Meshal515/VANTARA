#include <jni.h>
#include <stdint.h>

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
