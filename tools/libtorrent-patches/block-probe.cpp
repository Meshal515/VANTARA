// إثبات افتراض الخيار B: لحظة block_finished_alert تكون بايتات الكتلة على القرص مقروءة بملف مستقل ومطابقة للأصل.
// block-probe <magnet> <save_dir> <source_file>
#include <libtorrent/session.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/torrent_info.hpp>
#include <fcntl.h>
#include <unistd.h>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <vector>
#include <string>

namespace lt = libtorrent;

static bool pread_all(int fd, char* buf, size_t n, off_t at) {
    size_t done = 0;
    while (done < n) { ssize_t r = ::pread(fd, buf + done, n - done, at + off_t(done)); if (r <= 0) return false; done += size_t(r); }
    return true;
}

int main(int argc, char** argv) {
    if (argc < 4) { std::fprintf(stderr, "usage\n"); return 2; }
    lt::settings_pack sp;
    sp.set_int(lt::settings_pack::alert_mask, lt::alert_category::all);
    sp.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:0");
    sp.set_bool(lt::settings_pack::enable_dht, false);
    sp.set_bool(lt::settings_pack::enable_lsd, false);
    sp.set_bool(lt::settings_pack::enable_upnp, false);
    sp.set_bool(lt::settings_pack::enable_natpmp, false);
    lt::session ses(sp);
    lt::add_torrent_params p = lt::parse_magnet_uri(argv[1]);
    p.save_path = argv[2];
    lt::torrent_handle h = ses.add_torrent(p);
    int const src = ::open(argv[3], O_RDONLY);
    if (src < 0) { std::perror("source"); return 2; }
    int file = -1; long blocks = 0, checked = 0, mismatched = 0, unreadable = 0, pieces = 0, failed = 0;
    int pieceLength = 0;
    std::string path;
    auto const start = std::chrono::steady_clock::now();
    bool done = false;
    while (!done && std::chrono::steady_clock::now() - start < std::chrono::seconds(120)) {
        ses.wait_for_alert(std::chrono::milliseconds(200));
        std::vector<lt::alert*> alerts;
        ses.pop_alerts(&alerts);
        for (lt::alert* a : alerts) {
            if (auto* m = lt::alert_cast<lt::metadata_received_alert>(a)) {
                auto ti = m->handle.torrent_file();
                pieceLength = ti->piece_length();
                path = std::string(argv[2]) + "/" + ti->files().file_path(lt::file_index_t(0));
            } else if (auto* b = lt::alert_cast<lt::block_finished_alert>(a)) {
                ++blocks;
                if (path.empty()) { auto ti = h.torrent_file(); pieceLength = ti->piece_length(); path = std::string(argv[2]) + "/" + ti->files().file_path(lt::file_index_t(0)); }
                if (file < 0) file = ::open(path.c_str(), O_RDONLY);
                if (file < 0) { ++unreadable; continue; }
                int const piece = static_cast<int>(b->piece_index);
                off_t const at = off_t(piece) * pieceLength + off_t(b->block_index) * 16384;
                off_t const srcSize = ::lseek(src, 0, SEEK_END);
                size_t const n = size_t(std::min<off_t>(16384, srcSize - at));
                std::vector<char> disk(n), orig(n);
                if (!pread_all(file, disk.data(), n, at)) { ++unreadable; continue; }
                pread_all(src, orig.data(), n, at);
                ++checked;
                if (std::memcmp(disk.data(), orig.data(), n) != 0) ++mismatched;
            } else if (lt::alert_cast<lt::piece_finished_alert>(a)) { ++pieces;
            } else if (lt::alert_cast<lt::hash_failed_alert>(a)) { ++failed;
            } else if (lt::alert_cast<lt::torrent_finished_alert>(a)) { done = true; }
        }
    }
    std::printf("{\"blocks\":%ld,\"checked\":%ld,\"mismatched\":%ld,\"unreadable\":%ld,\"pieces\":%ld,\"hash_failed\":%ld,\"finished\":%s}\n",
        blocks, checked, mismatched, unreadable, pieces, failed, done ? "true" : "false");
    return (done && mismatched == 0 && unreadable == 0 && checked == blocks && checked > 0) ? 0 : 1;
}
