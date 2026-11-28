// قياس جدولة الكتل (0004): قارئ أو قارئان ينتظران موضعًا داخل قطعة، والسؤال متى تُكتب كتلة الموضع على القرص ومتى يكتمل
// أول 1MB متصل منه (ما يحتاجه الخيار B لأول صورة)، ثم قفزة إلى قطعة بعيدة. نفس الظروف بتلميح القراءة وبلا تلميح.
// كل كتلة تُقرأ من القرص لحظة تنبيهها وتُقارن بالأصل (سلامة البيانات)، والتكرار من torrent_status.
//
// hint-bench <magnet> <save_dir> <source_file> <offset_frac> <hints:0|1> [tail:0|1]
//   offset_frac: موضع القارئ داخل القطعة 1 (0..1). tail=1: قارئ ثانٍ عند آخر 64KB من الملف (فهرس MKV) معًا.
#include <libtorrent/session.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <fcntl.h>
#include <unistd.h>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace lt = libtorrent;
using clk = std::chrono::steady_clock;

static bool pread_all(int fd, char* buf, size_t n, off_t at) {
    size_t done = 0;
    while (done < n) { ssize_t r = ::pread(fd, buf + done, n - done, at + off_t(done)); if (r <= 0) return false; done += size_t(r); }
    return true;
}

struct Target {
    int piece = -1;
    int64_t offset = 0;       // داخل القطعة
    int64_t want = 0;         // البايتات المتصلة المطلوبة من الموضع
    std::vector<bool> written;
    double firstMs = -1, contigMs = -1, pieceMs = -1;
};

int main(int argc, char** argv) {
    if (argc < 6) { std::fprintf(stderr, "usage\n"); return 2; }
    std::string const magnet = argv[1], save = argv[2], source = argv[3];
    double const frac = std::atof(argv[4]);
    bool const hints = std::atoi(argv[5]) != 0;
    bool const tail = argc > 6 && std::atoi(argv[6]) != 0;

    lt::settings_pack sp;
    sp.set_int(lt::settings_pack::alert_mask, lt::alert_category::status | lt::alert_category::piece_progress | lt::alert_category::block_progress | lt::alert_category::error);
    sp.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:0");
    sp.set_bool(lt::settings_pack::enable_dht, false);
    sp.set_bool(lt::settings_pack::enable_lsd, false);
    sp.set_bool(lt::settings_pack::enable_upnp, false);
    sp.set_bool(lt::settings_pack::enable_natpmp, false);
    sp.set_bool(lt::settings_pack::enable_outgoing_utp, false);
    sp.set_bool(lt::settings_pack::enable_incoming_utp, false);
    // الباذرون الثلاثة خلف وسطاء على 127.0.0.1 بمنافذ مختلفة: هم ثلاثة مشاركين (libtorrent يقبل واحدًا لكل عنوان افتراضيًا)
    sp.set_bool(lt::settings_pack::allow_multiple_connections_per_ip, true);
    // كإعدادات أندرويد (TorrentEngine.streamingSettings مع المكتبة المخصصة)
    sp.set_int(lt::settings_pack::request_timeout, 4);
    sp.set_int(lt::settings_pack::piece_timeout, 8);
    sp.set_int(lt::settings_pack::max_out_request_queue, 250);
    sp.set_int(lt::settings_pack::request_queue_time, 1);
    sp.set_int(lt::settings_pack::whole_pieces_threshold, 0);
    sp.set_bool(lt::settings_pack::piece_extent_affinity, false);
    sp.set_bool(lt::settings_pack::strict_end_game_mode, false);
    sp.set_bool(lt::settings_pack::close_redundant_connections, false);
    sp.set_int(lt::settings_pack::tick_interval, 100);
    sp.set_int(lt::settings_pack::initial_picker_threshold, 0);
    lt::session ses(sp);

    lt::add_torrent_params p = lt::parse_magnet_uri(magnet);
    p.save_path = save;
    lt::torrent_handle h = ses.add_torrent(p);
    int const src = ::open(source.c_str(), O_RDONLY);
    if (src < 0) { std::perror("source"); return 2; }
    off_t const fileSize = ::lseek(src, 0, SEEK_END);

    auto const start = clk::now();
    auto ms = [&] { return std::chrono::duration<double, std::milli>(clk::now() - start).count(); };
    std::shared_ptr<lt::torrent_info const> ti;
    std::map<int, Target*> byPiece;
    Target head, end, seek;
    int fd = -1, pieceLen = 0, blocksPer = 0;
    long checked = 0, mismatched = 0, hashFailed = 0;
    double metadataMs = -1, seekStartMs = -1;
    bool seeking = false, done = false;

    auto arm = [&](Target& t, int piece, int64_t offset, int64_t want, int reader) {
        t.piece = piece; t.offset = offset; t.want = want;
        t.written.assign(size_t(ti->piece_size(lt::piece_index_t(piece)) / 16384 + 2), false);
        byPiece[piece] = &t;
        h.piece_priority(lt::piece_index_t(piece), lt::top_priority);
        h.set_piece_deadline(lt::piece_index_t(piece), 0);
#ifdef VANTARA_LT_READ_HINTS
        if (hints) h.vantara_set_read_hint(reader, lt::piece_index_t(piece), int(offset));
#else
        (void)reader;
        if (hints) { std::fprintf(stderr, "libtorrent without VANTARA_LT_READ_HINTS\n"); std::exit(3); }
#endif
    };
    auto contiguous = [&](Target const& t) {
        int64_t const size = ti->piece_size(lt::piece_index_t(t.piece));
        int64_t at = t.offset;
        while (at < size && at < t.offset + t.want) {
            size_t const b = size_t(at / 16384);
            if (!t.written[b]) break;
            at = std::min<int64_t>((at / 16384 + 1) * 16384, size);
        }
        return at - t.offset;
    };

    while (!done && ms() < 120000) {
        ses.wait_for_alert(std::chrono::milliseconds(20));
        std::vector<lt::alert*> alerts;
        ses.pop_alerts(&alerts);
        for (lt::alert* a : alerts) {
            if (lt::alert_cast<lt::metadata_received_alert>(a) || (!ti && h.torrent_file())) {
                if (ti) continue;
                ti = h.torrent_file();
                if (!ti) continue;
                metadataMs = ms();
                pieceLen = ti->piece_length();
                blocksPer = pieceLen / 16384;
                std::vector<lt::download_priority_t> none(size_t(ti->num_pieces()), lt::dont_download);
                h.prioritize_pieces(none);
                int64_t const off = int64_t(double(pieceLen) * frac) / 16384 * 16384;
                arm(head, 1, off, std::min<int64_t>(1 << 20, pieceLen - off), 1);
                if (tail) {
                    int64_t const at = int64_t(fileSize) - 65536;
                    arm(end, int(at / pieceLen), at % pieceLen, 65536, 2);
                }
                fd = ::open((save + "/" + ti->files().file_path(lt::file_index_t(0))).c_str(), O_RDONLY);
            } else if (auto* b = lt::alert_cast<lt::block_finished_alert>(a)) {
                int const piece = int(static_cast<std::int32_t>(b->piece_index));
                auto it = byPiece.find(piece);
                if (fd < 0) fd = ti ? ::open((save + "/" + ti->files().file_path(lt::file_index_t(0))).c_str(), O_RDONLY) : -1;
                // سلامة البيانات: كل كتلة مقروءة من القرص لحظة تنبيهها تطابق الأصل
                if (fd >= 0 && ti) {
                    off_t const at = off_t(piece) * pieceLen + off_t(b->block_index) * 16384;
                    size_t const n = size_t(std::min<off_t>(16384, fileSize - at));
                    std::vector<char> disk(n), orig(n);
                    if (pread_all(fd, disk.data(), n, at) && pread_all(src, orig.data(), n, at)) { ++checked; if (std::memcmp(disk.data(), orig.data(), n)) ++mismatched; }
                }
                if (it == byPiece.end()) continue;
                Target& t = *it->second;
                if (size_t(b->block_index) < t.written.size()) t.written[size_t(b->block_index)] = true;
                double const now = &t == &seek ? ms() - seekStartMs : ms();
                if (t.firstMs < 0 && t.written[size_t(t.offset / 16384)]) t.firstMs = now;
                if (t.contigMs < 0 && contiguous(t) >= t.want) t.contigMs = now;
            } else if (auto* f = lt::alert_cast<lt::piece_finished_alert>(a)) {
                auto it = byPiece.find(int(static_cast<std::int32_t>(f->piece_index)));
                if (it != byPiece.end() && it->second->pieceMs < 0) it->second->pieceMs = it->second == &seek ? ms() - seekStartMs : ms();
            } else if (lt::alert_cast<lt::hash_failed_alert>(a)) ++hashFailed;
        }
        bool const startDone = head.contigMs >= 0 && head.pieceMs >= 0 && (!tail || (end.contigMs >= 0 && end.pieceMs >= 0));
        if (startDone && !seeking && ti) {
            // القفزة: قطعة بعيدة في ثلثي الملف، والسرب متصل
            seeking = true; seekStartMs = ms();
            int const q = int(int64_t(fileSize) * 2 / 3 / pieceLen);
            int64_t const off = int64_t(double(pieceLen) * frac) / 16384 * 16384;
            arm(seek, q, off, std::min<int64_t>(1 << 20, pieceLen - off), 1);
        }
        if (seeking && seek.contigMs >= 0 && seek.pieceMs >= 0) done = true;
    }
    lt::torrent_status const st = h.status();
    std::printf("{\"hints\":%d,\"piece\":%d,\"offset_frac\":%.2f,\"metadata_ms\":%.0f,"
        "\"first_ms\":%.0f,\"contig_ms\":%.0f,\"piece_ms\":%.0f,"
        "\"tail_first_ms\":%.0f,\"tail_contig_ms\":%.0f,"
        "\"seek_first_ms\":%.0f,\"seek_contig_ms\":%.0f,\"seek_piece_ms\":%.0f,"
        "\"downloaded\":%lld,\"redundant\":%lld,\"failed\":%lld,\"hash_failed\":%ld,\"checked\":%ld,\"mismatched\":%ld,\"done\":%s}\n",
        hints ? 1 : 0, pieceLen, frac, metadataMs, head.firstMs, head.contigMs, head.pieceMs,
        end.firstMs, end.contigMs, seek.firstMs, seek.contigMs, seek.pieceMs,
        (long long)st.total_payload_download, (long long)st.total_redundant_bytes, (long long)st.total_failed_bytes,
        hashFailed, checked, mismatched, done ? "true" : "false");
    return done && mismatched == 0 ? 0 : 1;
}
