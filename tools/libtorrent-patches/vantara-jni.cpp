// VANTARA (read-hints) JNI. يُلحق بغلاف jlibtorrent المولّد (swig/libtorrent_jni.cpp) فيُترجم داخل libjlibtorrent.so نفسها
// مع رؤوس libtorrent نفسها: لا ربط ببنى libtorrent من خارج المكتبة. المقبض يُقرأ من حقل swigCPtr في كائن
// com.frostwire.jlibtorrent.swig.torrent_handle (مؤشر torrent_handle الذي يملكه الكائن). Kotlin: NativeReadHint.
#include <jni.h>
#include "libtorrent/torrent_handle.hpp"

namespace {
libtorrent::torrent_handle* vantara_handle(JNIEnv* env, jobject handle)
{
    if (handle == nullptr) return nullptr;
    jclass const cls = env->GetObjectClass(handle);
    if (cls == nullptr) return nullptr;
    jfieldID const field = env->GetFieldID(cls, "swigCPtr", "J");
    env->DeleteLocalRef(cls);
    if (field == nullptr) { env->ExceptionClear(); return nullptr; }
    return reinterpret_cast<libtorrent::torrent_handle*>(env->GetLongField(handle, field));
}
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_vantara_addons_torrent_NativeReadHint_set0(
    JNIEnv* env, jclass, jobject handle, jint reader, jint piece, jint offset)
{
    libtorrent::torrent_handle* const h = vantara_handle(env, handle);
    if (h == nullptr || !h->is_valid()) return JNI_FALSE;
    try { h->vantara_set_read_hint(reader, libtorrent::piece_index_t(piece), offset); }
    catch (...) { return JNI_FALSE; }
    return JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL Java_com_vantara_addons_torrent_NativeReadHint_clear0(
    JNIEnv* env, jclass, jobject handle, jint reader)
{
    libtorrent::torrent_handle* const h = vantara_handle(env, handle);
    if (h == nullptr || !h->is_valid()) return;
    try { h->vantara_clear_read_hint(reader); } catch (...) {}
}
