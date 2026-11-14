// VANTARA torrent host — محرك libtorrent الأصلي لنسخة ويندوز.
//
// لماذا ملف تنفيذي مستقل: نسخة APK تعتمد libtorrent عبر jlibtorrent (JNI خاص بأندرويد)، ولا يصلح نقل
// تلك المكتبة إلى ويندوز. هنا libtorrent-rasterbar 2.0 الأصلي نفسه، وسياسات APK الناجحة منقولة حرفيًا
// (TorrentPolicy/TorrentSwarm/TorrentHotswap وstreamingSettings في android/.../torrent).
//
// الواجهة HTTP محلية (127.0.0.1 + Basic auth) ومتوافقة مع الجزء الذي يستخدمه apps/desktop/src/services.mjs
// من واجهة rqbit؛ فيبقى المشغّل والوكيل والنافذة المتحركة وStremio كما هي، ويبقى rqbit بديلًا احتياطيًا.
//
//   GET  /                                   صحة المحرك
//   POST /torrents?list_only=true            (جسم: magnet) بيانات الملفات + المشاركون المعروفون
//   POST /torrents?only_files=N[&overwrite=true][&initial_peers=a,b]  إضافة/إعادة استخدام للتنزيل
//   GET  /torrents/:id/stats/v1              السرعة والمشاركون والمنزّل
//   GET  /torrents/:id/haves                 حقل القطع (Msb0) + x-bitfield-len
//   POST /torrents/:id/{pause,start,delete,forget}
//   GET  /torrents/:id/stream/:file          Range؛ لا يرسل إلا بايتات قطع اجتازت التحقق
//
// الترخيص: libtorrent BSD-3-Clause، Boost BSL-1.0، OpenSSL Apache-2.0 (THIRD-PARTY-NOTICES).

#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/bencode.hpp>
#include <libtorrent/ip_filter.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/session.hpp>
#include <libtorrent/session_params.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/peer_info.hpp>
#include <libtorrent/write_resume_data.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/load_torrent.hpp>
#include <libtorrent/version.hpp>
#include <libtorrent/hasher.hpp>
#include <libtorrent/mmap_disk_io.hpp>
#include <libtorrent/posix_disk_io.hpp>
#if __has_include(<libtorrent/pread_disk_io.hpp>)
#include <libtorrent/pread_disk_io.hpp>
#define VANTARA_HAS_PREAD 1
#endif
#include <boost/asio.hpp>

#include <algorithm>
#include <cctype>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
#include <csignal>
#include <signal.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;
namespace asio = boost::asio;
using tcp = asio::ip::tcp;
using clk = std::chrono::steady_clock;
using namespace std::chrono_literals;

// توافق libtorrent 2.0 (لينكس: 2.0.10) و2.1 (vcpkg على ويندوز: 2.1.x بلا الدوال المهملة، TORRENT_ABI_VERSION=100).
// 2.1 أخفى torrent_info::files() وpeer_info::ip وadd_files وfrom_span؛ بدائلها في 2.1 وحدها، فنختار
// عند الترجمة. لا نعيد تسمية ملفات التورنت، فـlayout() يساوي files() عمليًا.
namespace ltc {
#if LIBTORRENT_VERSION_NUM >= 20100
inline lt::file_storage const& files(lt::torrent_info const& ti) { return ti.layout(); }
inline lt::tcp::endpoint endpoint(lt::peer_info const& p) { return p.remote_endpoint(); }
#else
inline lt::file_storage const& files(lt::torrent_info const& ti) { return ti.files(); }
inline lt::tcp::endpoint endpoint(lt::peer_info const& p) { return p.ip; }
#endif
}  // namespace ltc

static constexpr const char* VERSION = "1.0.0";

// ───────────────────────────── سياسات APK المنقولة ─────────────────────────────
namespace policy {
// TorrentPolicy.PUBLIC_TRACKERS — تُدمج بعد متتبّعات الإضافة، بحد 48.
static const std::vector<std::string> PUBLIC_TRACKERS = {
    "udp://tracker.opentrackr.org:1337/announce", "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce", "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce", "udp://explodie.org:6969/announce",
    "udp://tracker.theoks.net:6969/announce", "udp://opentracker.io:6969/announce",
    "udp://tracker.dler.org:6969/announce", "udp://tracker-udp.gbitt.info:80/announce",
    "http://tracker.opentrackr.org:1337/announce", "https://tracker.gbitt.info:443/announce",
};
static constexpr int MAX_ANNOUNCE = 48;
// قابلتان للتجربة فقط بمتغيرات بيئة (VANTARA_LT_WINDOW/AHEAD)؛ الافتراضي كالـAPK بلا تغيير
static int WINDOW = 12;                    // TorrentPolicy.window count
static int AHEAD_PIECES = 64;
// قراءة القطع المكتملة التالية من القرص قبل أن يطلبها القارئ (الـAPK: state.readAhead لقطعة واحدة). 0 = السلوك الحالي
// بلا قراءة مسبقة؛ تجربة قياس فقط عبر VANTARA_LT_READAHEAD حتى تثبت النتائج المتكررة.
static int READAHEAD = 0;    // ما بعد النافذة بأولوية عادية (JS يوقف/يستأنف حسب المساحة)
// محرك القرص: الافتراضي ما تختاره libtorrent (default). قياس فقط عبر VANTARA_LT_DISK=mmap|posix|pread، لأن
// قياس ويندوز أظهر read_piece يتأخر 6–12 ث بينما التنزيل 6–9MB/s (القرص هو عنق الزجاجة، لا السرب).
static std::string DISK_IO = "default";
// تسليم مباشر (قياس فقط عبر VANTARA_LT_DIRECT=1): بعد have_piece تُقرأ القطعة من الملف مباشرة وتُطابق بصمتها SHA-1
// مع التورنت قبل التسليم، فلا تنتظر خلف طابور القرص في libtorrent. أي فشل أو عدم تطابق يرجع إلى read_piece.
static bool DIRECT_READ = false;

// TorrentPolicy.deadlines: القطعة المقروءة الآن أولًا (0ms)، ثم الطرفان، ثم الباقي بتدرّج يتسع.
std::vector<std::pair<int, int>> deadlines(std::vector<int> const& window, std::vector<int> const& pendingEdges) {
    std::vector<std::pair<int, int>> out;
    std::set<int> seen;
    if (!window.empty()) { out.emplace_back(window.front(), 0); seen.insert(window.front()); }
    for (int piece : pendingEdges) if (seen.insert(piece).second) out.emplace_back(piece, 250 * int(out.size()));
    int const base = 250 * int(out.size());
    for (size_t i = 1; i < window.size(); ++i) {
        int const piece = window[i];
        int const k = int(i) - 1;
        if (seen.insert(piece).second) out.emplace_back(piece, base + (k < 3 ? k * 250 : 750 + (k - 2) * 750));
    }
    return out;
}
// TorrentHotswap: مشارك بطيء يحتجز القطعة المنتظرة أكثر من 1.5 ث يُحجب 60 ث فتُطلب كتلتها من أسرع.
static constexpr auto HOTSWAP_WAIT = 1500ms;
static constexpr auto HOTSWAP_BAN = 60s;
static constexpr int SLOW_BPS = 16 * 1024;
static constexpr int MAX_VICTIMS = 2;
}  // namespace policy

// ───────────────────────────── أدوات صغيرة ─────────────────────────────
static std::string jsonEscape(std::string const& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; }
                else out += char(c);
        }
    }
    return out;
}
static std::string base64(std::string const& in) {
    static const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, bits = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c; bits += 8;
        while (bits >= 0) { out.push_back(t[(val >> bits) & 0x3F]); bits -= 6; }
    }
    if (bits > -6) out.push_back(t[((val << 8) >> (bits + 8)) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}
static std::string urlDecode(std::string const& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size() && std::isxdigit((unsigned char)s[i + 1]) && std::isxdigit((unsigned char)s[i + 2])) {
            out += char(std::stoi(s.substr(i + 1, 2), nullptr, 16)); i += 2;
        } else if (s[i] == '+') out += ' ';
        else out += s[i];
    }
    return out;
}
static std::string lower(std::string s) { for (auto& c : s) c = char(std::tolower((unsigned char)c)); return s; }
static std::vector<std::string> split(std::string const& s, char sep) {
    std::vector<std::string> out; std::string cur;
    for (char c : s) { if (c == sep) { out.push_back(cur); cur.clear(); } else cur += c; }
    out.push_back(cur);
    return out;
}

// المسارات العامة فقط (TorrentEngine.PRIVATE_RANGES): لا مشاركين أو متتبّعات على الشبكة المحلية.
static lt::ip_filter publicNetworkFilter() {
    lt::ip_filter f;
    auto rule = [&](char const* lo, char const* hi) { f.add_rule(asio::ip::make_address(lo), asio::ip::make_address(hi), lt::ip_filter::blocked); };
    rule("0.0.0.0", "0.255.255.255"); rule("10.0.0.0", "10.255.255.255"); rule("100.64.0.0", "100.127.255.255");
    rule("127.0.0.0", "127.255.255.255"); rule("169.254.0.0", "169.254.255.255"); rule("172.16.0.0", "172.31.255.255");
    rule("192.168.0.0", "192.168.255.255"); rule("224.0.0.0", "255.255.255.255"); rule("::", "::1");
    rule("fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"); rule("fe80::", "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
    rule("ff00::", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
    return f;
}

// ───────────────────────────── حالة التورنت ─────────────────────────────
struct Reader { int64_t piece = -1; clk::time_point at; };

struct Torrent {
    int id = -1;
    lt::torrent_handle h;
    std::string infoHash;
    bool managed = false;        // أضيف للتنزيل (only_files) لا لمجرد البيانات
    int file = -1;
    bool paused = false;
    std::vector<std::string> seenPeers;
    // البث
    std::map<uint64_t, Reader> readers;
    std::set<int> deadlined;
    int windowStart = -1;
    int waitingPiece = -1;
    clk::time_point waitingSince;
    std::map<int, std::shared_ptr<std::vector<char>>> pieceCache;  // read_piece (حتى 6 قطع)
    // زمن read_piece (من الطلب إلى التنبيه): هل البطء في القرص لا في السرب؟
    std::map<int, clk::time_point> readStart;
    int64_t readLastMs = -1, readMaxMs = 0; double readAvgMs = 0; int readCount = 0;
    std::deque<int> cacheOrder;
    std::set<int> reading;
    std::map<int, std::string> readErrors;
    std::map<int, int> readFailures;
    // قطعة لم تطابق بصمتها (الكتابة لم تصل الملف بعد): تُعاد مباشرة كل 150ms حتى 20 مرة، وread_piece معها احتياطًا.
    // بعد 20 محاولة: read_piece وحدها. قياس #7: 7 من 24 قطعة لم تطابق أول مرة ثم رجعت للطريق البطيء كله.
    struct DirectRetry { int attempts = 0; clk::time_point next; };
    std::map<int, DirectRetry> directRetry;
    std::set<int> directFailed;   // استنفدت المحاولات: read_piece لها فقط
    std::set<int> directPending;  // قطع في طابور القراءة المسبقة المباشرة (خيط مستقل)
    int directHits = 0, directMisses = 0, directAhead = 0;
    int errorRecoveries = 0;
};

static void applyOverrides(lt::settings_pack& s, std::string const& raw) {
    std::stringstream in(raw);
    std::string item;
    while (std::getline(in, item, ',')) {
        auto const eq = item.find('=');
        if (eq == std::string::npos) continue;
        std::string const name = item.substr(0, eq), value = item.substr(eq + 1);
        int const idx = lt::setting_by_name(name);
        if (idx < 0) { std::cerr << "override: unknown setting " << name << "\n"; continue; }
        switch (idx & lt::settings_pack::type_mask) {
            case lt::settings_pack::string_type_base: s.set_str(idx, value); break;
            case lt::settings_pack::int_type_base: s.set_int(idx, std::stoi(value)); break;
            case lt::settings_pack::bool_type_base: s.set_bool(idx, value == "1" || value == "true"); break;
        }
        std::cerr << "override: " << name << "=" << value << "\n";
    }
}

class Engine {
public:
    Engine(std::string dir, std::string stateDir, int listenPort, bool allowPrivate, std::string testPeer = {})
        : dir_(std::move(dir)), stateDir_(std::move(stateDir)), allowPrivate_(allowPrivate), testPeer_(std::move(testPeer)) {
        lt::settings_pack s;
        // streamingSettings() في TorrentEngine.kt (قيست على أسراب Torrentio حقيقية)
        s.set_int(lt::settings_pack::connections_limit, 400);
        s.set_int(lt::settings_pack::active_downloads, -1);
        s.set_int(lt::settings_pack::active_seeds, -1);
        s.set_int(lt::settings_pack::active_limit, -1);
        s.set_int(lt::settings_pack::max_peerlist_size, 1000);
        s.set_int(lt::settings_pack::upload_rate_limit, 0);
        s.set_int(lt::settings_pack::max_queued_disk_bytes, 8 * 1024 * 1024);
        s.set_bool(lt::settings_pack::validate_https_trackers, true);
        s.set_int(lt::settings_pack::stop_tracker_timeout, 1);
        s.set_bool(lt::settings_pack::enable_lsd, false);
        s.set_bool(lt::settings_pack::ssrf_mitigation, true);
        s.set_bool(lt::settings_pack::apply_ip_filter_to_trackers, !allowPrivate_);
        s.set_bool(lt::settings_pack::announce_to_all_trackers, true);
        s.set_bool(lt::settings_pack::announce_to_all_tiers, true);
        s.set_bool(lt::settings_pack::strict_end_game_mode, false);
        s.set_bool(lt::settings_pack::close_redundant_connections, false);
        s.set_int(lt::settings_pack::connection_speed, 200);
        s.set_int(lt::settings_pack::torrent_connect_boost, 100);
        s.set_int(lt::settings_pack::peer_connect_timeout, 15);
        s.set_int(lt::settings_pack::handshake_timeout, 15);
        s.set_int(lt::settings_pack::tracker_receive_timeout, 6);
        s.set_int(lt::settings_pack::tracker_completion_timeout, 15);
        s.set_int(lt::settings_pack::request_timeout, 4);
        s.set_int(lt::settings_pack::piece_timeout, 8);
        s.set_int(lt::settings_pack::max_out_request_queue, 250);
        s.set_int(lt::settings_pack::request_queue_time, 1);
        s.set_int(lt::settings_pack::whole_pieces_threshold, 0);
        s.set_bool(lt::settings_pack::piece_extent_affinity, false);
        // TCP فقط كما Stremio وAPK: uTP ضاعف زمن الوصول في 8 مقارنات من 8 على أسراب حقيقية
        s.set_bool(lt::settings_pack::enable_outgoing_utp, false);
        s.set_bool(lt::settings_pack::enable_incoming_utp, false);
        s.set_bool(lt::settings_pack::enable_upnp, true);
        s.set_bool(lt::settings_pack::enable_natpmp, true);
        s.set_bool(lt::settings_pack::enable_dht, true);
        // محلي: نسمح بعناوين الشبكة الخاصة للاختبار فقط؛ الإنتاج لا يتصل بها
        if (allowPrivate_) { s.set_bool(lt::settings_pack::allow_multiple_connections_per_ip, true); s.set_bool(lt::settings_pack::enable_dht, false); s.set_bool(lt::settings_pack::enable_upnp, false); s.set_bool(lt::settings_pack::enable_natpmp, false); }
        s.set_str(lt::settings_pack::listen_interfaces, (allowPrivate_ ? "127.0.0.1:" : "0.0.0.0:") + std::to_string(listenPort) + (allowPrivate_ ? "" : ",[::]:" + std::to_string(listenPort)));
        s.set_str(lt::settings_pack::user_agent, std::string("VANTARA/") + VERSION + " libtorrent/" + lt::version());
        s.set_int(lt::settings_pack::alert_mask, lt::alert_category::status | lt::alert_category::error | lt::alert_category::storage | lt::alert_category::piece_progress | (std::getenv("VANTARA_TORRENT_LOG") ? lt::alert_category::peer | lt::alert_category::connect : lt::alert_category_t{}));
        // تجارب القياس فقط: VANTARA_LT_SETTINGS="اسم=قيمة,..." بأسماء settings_pack نفسها، فوق إعدادات الـAPK.
        // بلا المتغير لا يتغير شيء. كل إعداد يُطبع على stderr حتى يُعرف ما قيس.
        if (const char* raw = std::getenv("VANTARA_LT_SETTINGS")) applyOverrides(s, raw);
        lt::session_params params(std::move(s));
        if (policy::DISK_IO == "mmap") params.disk_io_constructor = lt::mmap_disk_io_constructor;
        else if (policy::DISK_IO == "posix") params.disk_io_constructor = lt::posix_disk_io_constructor;
#ifdef VANTARA_HAS_PREAD
        else if (policy::DISK_IO == "pread") params.disk_io_constructor = lt::pread_disk_io_constructor;
#endif
        else policy::DISK_IO = "default";
        std::cerr << "disk_io: " << policy::DISK_IO << "\n";
        // جدول DHT المحفوظ (مثل dht.state في APK): لا يبدأ كل تشغيل من عقد الإقلاع
        if (!stateDir_.empty()) {
            std::ifstream in(fs::u8path(stateDir_) / "dht.state", std::ios::binary);
            std::vector<char> buf((std::istreambuf_iterator<char>(in)), {});
            if (!buf.empty()) {
                try {
                    auto loaded = lt::read_session_params(buf, lt::session::save_dht_state);
                    params.dht_state = std::move(loaded.dht_state);
                } catch (...) {}
            }
        }
        ses_ = std::make_unique<lt::session>(std::move(params));
        if (!allowPrivate_) ses_->set_ip_filter(publicNetworkFilter());
        // libtorrent 2.0 يربط الاتصالات الصادرة بمقابس الاستماع: تورنت يُضاف قبل فتحها يفشل أول اتصال
        // بالمشاركين المعروفين (initial_peers) ولا يُعاد قبل ~60 ث. الواجهة لا تُفتح قبل الاستماع (حد 5 ث).
        for (auto const deadline = clk::now() + 5s; clk::now() < deadline;) {
            ses_->wait_for_alert(100ms);
            std::vector<lt::alert*> alerts;
            ses_->pop_alerts(&alerts);
            bool listening = false;
            for (auto* a : alerts) if (lt::alert_cast<lt::listen_succeeded_alert>(a)) listening = true;
            if (listening) break;
        }
        alerts_ = std::thread([this] { alertLoop(); });
        if (policy::DIRECT_READ) direct_ = std::thread([this] { directLoop(); });
    }

    ~Engine() { stop(); }

    void stop() {
        if (stopping_.exchange(true)) return;
        cv_.notify_all();
        if (alerts_.joinable()) alerts_.join();
        if (direct_.joinable()) direct_.join();
        saveDht();
    }

    struct Result { int status = 200; std::string body; std::string type = "application/json"; std::vector<std::pair<std::string, std::string>> headers{}; };

    // ── list_only / add ──
    Result add(std::string const& magnet, std::map<std::string, std::string> const& q, int timeoutMs) {
        lt::error_code ec;
        lt::add_torrent_params p = lt::parse_magnet_uri(magnet, ec);
        if (ec || !p.info_hashes.has_v1()) return {400, R"({"error":"invalid magnet"})"};
        std::string const hash = [&] { std::ostringstream h; h << p.info_hashes.v1; return h.str(); }();
        bool const listOnly = q.count("list_only") && q.at("list_only") == "true";
        int onlyFile = -1;
        if (q.count("only_files")) {
            try { onlyFile = std::stoi(q.at("only_files")); } catch (...) { return {400, R"({"error":"invalid only_files"})"}; }
            if (onlyFile < 0) return {400, R"({"error":"invalid only_files"})"};
        }
        // overwrite=true (إعادة بناء بعد تفريغ القرص) يأتي بعد delete، فالتورنت يُضاف من جديد دائمًا.
        std::vector<std::string> initialPeers;
        if (q.count("initial_peers")) for (auto& x : split(q.at("initial_peers"), ',')) if (!x.empty()) initialPeers.push_back(x);

        std::shared_ptr<Torrent> t;
        {
            std::lock_guard<std::mutex> lock(m_);
            auto it = byHash_.find(hash);
            if (it != byHash_.end()) t = it->second;
        }
        if (!t) {
            // متتبّعات الإضافة أولًا ثم العامة (TorrentPolicy.mergeTrackers)
            std::set<std::string> seen;
            std::vector<std::string> trackers;
            for (auto const& tr : p.trackers) { std::string k = lower(tr); while (!k.empty() && k.back() == '/') k.pop_back(); if (seen.insert(k).second) trackers.push_back(tr); }
            for (auto const& tr : policy::PUBLIC_TRACKERS) { std::string k = lower(tr); if (seen.insert(k).second) trackers.push_back(tr); }
            if (int(trackers.size()) > policy::MAX_ANNOUNCE) trackers.resize(policy::MAX_ANNOUNCE);
            p.trackers = trackers;
            p.tracker_tiers.assign(trackers.size(), 0);
            p.save_path = dir_;
            p.flags &= ~lt::torrent_flags::auto_managed;
            p.flags &= ~lt::torrent_flags::paused;
            p.flags &= ~lt::torrent_flags::duplicate_is_error;
            // قبل وصول البيانات لا نعرف الملفات: لا شيء يُنزَّل حتى نختار الملف (لا هدر بيانات)
            p.file_priorities.assign(std::max(onlyFile + 1, 65536), lt::dont_download);
            if (onlyFile >= 0) p.file_priorities[size_t(onlyFile)] = lt::default_priority;
            lt::torrent_handle h = ses_->add_torrent(std::move(p), ec);
            if (ec) return {500, "{\"error\":\"" + jsonEscape(ec.message()) + "\"}"};
            t = std::make_shared<Torrent>();
            t->h = h; t->infoHash = hash;
            std::lock_guard<std::mutex> lock(m_);
            t->id = nextId_++;
            byHash_[hash] = t; byId_[t->id] = t;
        }
        for (auto const& peer : initialPeers) connectPeer(t->h, peer);
        // اختبار فقط: باذر محلي معروف (يُقبل حصرًا مع --allow-private-peers)
        if (allowPrivate_ && !testPeer_.empty()) connectPeer(t->h, testPeer_);
        if (!waitMetadata(t, timeoutMs)) return {504, R"({"error":"metadata timeout"})"};
        auto ti = t->h.torrent_file();
        if (!ti) return {504, R"({"error":"metadata timeout"})"};
        if (onlyFile >= ti->num_files()) return {400, R"({"error":"only_files out of range"})"};
        if (listOnly && !t->managed) keepInterested(*t, *ti);
        if (!listOnly && onlyFile >= 0) {
            std::lock_guard<std::mutex> lock(m_);
            selectFile(*t, *ti, onlyFile);
        }
        return {200, describe(*t, *ti, listOnly)};
    }

    Result stats(int id) {
        auto t = find(id);
        if (!t) return {404, R"({"error":"not found"})"};
        lt::torrent_status st = t->h.status(lt::torrent_handle::query_accurate_download_counters);
        std::ostringstream o;
        o << "{\"state\":\"" << (t->paused ? "paused" : "live") << "\",\"engine\":\"libtorrent\",\"finished\":" << (st.is_finished ? "true" : "false")
          << ",\"total_bytes\":" << st.total_wanted << ",\"progress_bytes\":" << st.total_wanted_done
          << ",\"live\":{\"download_speed\":{\"mbps\":" << (st.download_payload_rate / 1048576.0) << "},\"upload_speed\":{\"mbps\":" << (st.upload_payload_rate / 1048576.0)
          << "},\"snapshot\":{\"downloaded_and_checked_bytes\":" << st.total_done << ",\"downloaded_and_checked_pieces\":" << st.num_pieces
          << ",\"peer_stats\":{\"live\":" << st.num_peers << ",\"seen\":" << (st.list_peers) << ",\"seeds\":" << st.num_seeds << "}}}"
          << ",\"waiting_piece\":" << t->waitingPiece << "}";
        return {200, o.str()};
    }

    // تشخيص البطء (للقياس): سرعة التنزيل الفعلية، المشاركون ومن يسمح لنا بالتنزيل، النافذة والقطعة المنتظرة وكتلها،
    // ومن يرسلها وبأي سرعة. يقارنه swarm-ab بما وصل للقارئ فعلًا في الثانية نفسها.
    Result diag(int id) {
        auto t = find(id);
        if (!t) return {404, R"({"error":"not found"})"};
        lt::torrent_status st = t->h.status();
        std::vector<lt::peer_info> peers;
        t->h.get_peer_info(peers);
        int unchokedUs = 0, sending = 0, onWaiting = 0;
        std::vector<int> waitSpeeds;
        int waiting, windowStart; int64_t waitedMs = -1;
        size_t readsInFlight; int64_t readLast, readMax; double readAvg; int readCount, directHits, directMisses, directAhead;
        { std::lock_guard<std::mutex> lock(m_); waiting = t->waitingPiece; windowStart = t->windowStart;
          readsInFlight = t->reading.size(); readLast = t->readLastMs; readMax = t->readMaxMs; readAvg = t->readAvgMs; readCount = t->readCount; directHits = t->directHits; directMisses = t->directMisses; directAhead = t->directAhead;
          if (waiting >= 0) waitedMs = std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - t->waitingSince).count(); }
        for (auto const& p : peers) {
            if (bool(p.flags & lt::peer_info::interesting) && !bool(p.flags & lt::peer_info::remote_choked)) ++unchokedUs;
            if (p.down_speed > 0) ++sending;
            if (waiting >= 0 && int(static_cast<std::int32_t>(p.downloading_piece_index)) == waiting) { ++onWaiting; waitSpeeds.push_back(p.down_speed); }
        }
        std::vector<lt::partial_piece_info> queue;
        t->h.get_download_queue(queue);
        int wBlocks = -1, wFinished = -1, wWriting = -1, wRequested = -1;
        for (auto const& q : queue) if (int(static_cast<std::int32_t>(q.piece_index)) == waiting) { wBlocks = q.blocks_in_piece; wFinished = q.finished; wWriting = q.writing; wRequested = q.requested; }
        std::ostringstream o;
        o << "{\"rate_bps\":" << st.download_payload_rate << ",\"total_rate_bps\":" << st.download_rate << ",\"peers\":" << st.num_peers
          << ",\"seeds\":" << st.num_seeds << ",\"unchoked_us\":" << unchokedUs << ",\"sending\":" << sending << ",\"list_peers\":" << st.list_peers
          << ",\"pieces\":" << st.num_pieces << ",\"partial\":" << queue.size() << ",\"window_start\":" << windowStart << ",\"window\":" << policy::WINDOW
          << ",\"waiting\":{\"piece\":" << waiting << ",\"ms\":" << waitedMs << ",\"blocks\":" << wBlocks << ",\"finished\":" << wFinished
          << ",\"writing\":" << wWriting << ",\"requested\":" << wRequested << ",\"peers\":" << onWaiting << ",\"speeds\":[";
        for (size_t i = 0; i < waitSpeeds.size(); ++i) o << (i ? "," : "") << waitSpeeds[i];
        o << "]},\"reads\":{\"in_flight\":" << readsInFlight << ",\"last_ms\":" << readLast << ",\"avg_ms\":" << int64_t(readAvg)
          << ",\"max_ms\":" << readMax << ",\"count\":" << readCount << ",\"readahead\":" << policy::READAHEAD << ",\"direct\":" << (policy::DIRECT_READ ? 1 : 0) << ",\"direct_hits\":" << directHits << ",\"direct_misses\":" << directMisses << ",\"direct_ahead\":" << directAhead << "},\"disk_io\":\"" << policy::DISK_IO << "\",\"swaps\":" << swaps_ << "}";
        return {200, o.str()};
    }

    Result haves(int id) {
        auto t = find(id);
        if (!t) return {404, R"({"error":"not found"})"};
        lt::torrent_status st = t->h.status(lt::torrent_handle::query_pieces);
        int const n = st.pieces.size();
        std::string bits(size_t((n + 7) / 8), '\0');
        for (int i = 0; i < n; ++i) if (st.pieces.get_bit(lt::piece_index_t(i))) bits[size_t(i >> 3)] |= char(0x80 >> (i & 7));
        Result r{200, bits, "application/octet-stream"};
        r.headers.emplace_back("x-bitfield-len", std::to_string(n));
        return r;
    }

    Result action(int id, std::string const& what) {
        auto t = find(id);
        if (!t) return {404, R"({"error":"not found"})"};
        if (what == "pause") { t->h.pause(); t->paused = true; }
        else if (what == "start") { t->h.resume(); t->paused = false; }
        else if (what == "delete" || what == "forget") {
            {
                std::lock_guard<std::mutex> lock(m_);
                byId_.erase(id); byHash_.erase(t->infoHash);
            }
            ses_->remove_torrent(t->h, what == "delete" ? lt::session::delete_files : lt::remove_flags_t{});
            cv_.notify_all();
        } else return {404, R"({"error":"unknown action"})"};
        return {200, "{}"};
    }

    std::shared_ptr<Torrent> find(int id) {
        std::lock_guard<std::mutex> lock(m_);
        auto it = byId_.find(id);
        return it == byId_.end() ? nullptr : it->second;
    }

    // ── البث: Range فوق قطع متحقق منها فقط ──
    // يعيد false إن انقطع الاتصال أو أُزيل التورنت.
    template <class Send>
    bool stream(std::shared_ptr<Torrent> const& t, int fileIndex, int64_t from, int64_t to, uint64_t readerId, Send&& send) {
        auto ti = t->h.torrent_file();
        if (!ti) return false;
        auto const& files = ltc::files(*ti);
        int64_t const offset = files.file_offset(lt::file_index_t(fileIndex));
        int const pieceLength = ti->piece_length();
        int64_t pos = from;
        while (pos <= to) {
            if (stopping_) return false;
            int64_t const absolute = offset + pos;
            int const piece = int(absolute / pieceLength);
            int const inPiece = int(absolute % pieceLength);
            reposition(t, *ti, fileIndex, piece, readerId);
            std::shared_ptr<std::vector<char>> data = waitPiece(t, piece);
            if (!data) return false;
            int64_t const take = std::min<int64_t>({int64_t(data->size()) - inPiece, to - pos + 1});
            if (take <= 0) return false;
            if (!send(data->data() + inPiece, size_t(take))) return false;
            pos += take;
        }
        return true;
    }

    void dropReader(std::shared_ptr<Torrent> const& t, uint64_t readerId) {
        std::lock_guard<std::mutex> lock(m_);
        t->readers.erase(readerId);
    }

    uint64_t newReader() { return ++readerSeq_; }

private:
    static void connectPeer(lt::torrent_handle const& h, std::string const& value) {
        // صيغة SocketAddr: a.b.c.d:port أو [v6]:port (initialPeers في services.mjs يفلتر العام فقط)
        auto colon = value.rfind(':');
        if (colon == std::string::npos) return;
        std::string host = value.substr(0, colon);
        if (host.size() > 2 && host.front() == '[' && host.back() == ']') host = host.substr(1, host.size() - 2);
        try {
            int port = std::stoi(value.substr(colon + 1));
            if (port < 1 || port > 65535) return;
            boost::system::error_code ec;
            auto address = asio::ip::make_address(host, ec);
            if (!ec) h.connect_peer(tcp::endpoint(address, std::uint16_t(port)));
        } catch (...) {}
    }

    bool waitMetadata(std::shared_ptr<Torrent> const& t, int timeoutMs) {
        auto const deadline = clk::now() + std::chrono::milliseconds(std::max(1000, timeoutMs));
        std::unique_lock<std::mutex> lock(m_);
        while (!t->h.torrent_file()) {
            if (stopping_ || !byId_.count(t->id)) return false;
            if (cv_.wait_until(lock, std::min(deadline, clk::now() + 200ms)) == std::cv_status::timeout && clk::now() >= deadline) return !!t->h.torrent_file();
        }
        return true;
    }

    std::string describe(Torrent& t, lt::torrent_info const& ti, bool listOnly) {
        auto const& files = ltc::files(ti);
        std::ostringstream o;
        std::string const folder = fs::absolute(fs::u8path(dir_)).u8string();
        o << "{\"id\":" << (listOnly ? std::string("null") : std::to_string(t.id)) << ",\"output_folder\":\"" << jsonEscape(folder) << "\",\"details\":{\"info_hash\":\"" << t.infoHash
          << "\",\"name\":\"" << jsonEscape(ti.name()) << "\",\"total_pieces\":" << ti.num_pieces() << ",\"piece_length\":" << ti.piece_length()
          << ",\"output_folder\":\"" << jsonEscape(folder) << "\",\"files\":[";
        for (int i = 0; i < files.num_files(); ++i) {
            lt::file_index_t const f(i);
            std::string const path = files.file_path(f);
            if (i) o << ',';
            o << "{\"name\":\"" << jsonEscape(path) << "\",\"length\":" << files.file_size(f) << ",\"components\":[";
            auto parts = split(path, path.find('\\') != std::string::npos ? '\\' : '/');
            for (size_t k = 0; k < parts.size(); ++k) o << (k ? "," : "") << '"' << jsonEscape(parts[k]) << '"';
            o << "]}";
        }
        o << "]},\"seen_peers\":[";
        std::vector<lt::peer_info> peers;
        t.h.get_peer_info(peers);
        int n = 0;
        for (auto const& peer : peers) {
            if (n >= 50) break;
            auto const ep = ltc::endpoint(peer);
            std::string addr = ep.address().is_v6() ? "[" + ep.address().to_string() + "]" : ep.address().to_string();
            o << (n++ ? "," : "") << '"' << addr << ':' << ep.port() << '"';
        }
        o << "]}";
        return o.str();
    }

    // ملف واحد بأولوية؛ بقية الملفات لا تُنزَّل. تسلسلي + الطرفان (فهرس MP4/MKV) بموعد قريب.
    void selectFile(Torrent& t, lt::torrent_info const& ti, int index) {
        std::vector<lt::download_priority_t> prio(size_t(ti.num_files()), lt::dont_download);
        prio[size_t(index)] = lt::default_priority;
        t.h.prioritize_files(prio);
        t.h.unset_flags(lt::torrent_flags::auto_managed | lt::torrent_flags::stop_when_ready | lt::torrent_flags::upload_mode);
        if (!std::getenv("VANTARA_LT_NO_SEQUENTIAL")) t.h.set_flags(lt::torrent_flags::sequential_download);  // تجربة قياس فقط
        if (!t.paused) t.h.resume();
        t.managed = true;
        t.file = index;
        auto const edges = edgePieces(ti, index);
        // قبل أول قارئ: الطرفان فقط (فهرس الحاوية). التسلسلي بأولوية الملف الافتراضية كان يرسل طلبات القطع 1،2،3…
        // فور الإضافة، فإن قفز المشغل مباشرة (استئناف) انتظرت قطعة القفز خلف ما أُرسل للباذر: قيس على ويندوز 11/95
        // قطعة قبل موضع القراءة (~2.7ث عند 1MB/s). نافذة القارئ (setWindow) تضع الأولويات لحظة وصول أول قراءة.
        {
            std::vector<lt::download_priority_t> pieces(size_t(ti.num_pieces()), lt::dont_download);
            for (int p : edges) pieces[size_t(p)] = lt::top_priority;
            t.h.prioritize_pieces(pieces);
        }
        auto const wanted = policy::deadlines({edges.front()}, std::vector<int>(edges.begin() + 1, edges.end()));
        for (auto [piece, deadline] : wanted) {
            t.h.piece_priority(lt::piece_index_t(piece), lt::top_priority);
            t.h.set_piece_deadline(lt::piece_index_t(piece), deadline);
            t.deadlined.insert(piece);
        }
    }

    /**
     * بعد list_only لا نطلب شيئًا، فيخنقنا الباذر (choke) ولا يفك الخنق إلا في جولته التالية حين نضيف الملف:
     * قيس ~700ms قبل أول بايت مقابل 20–50ms للإضافة المباشرة. مثل تسخين APK (TorrentPrefetch.warmPieces):
     * نبقى «مهتمين» بأول قطعة من أكبر ملف فيديو بأولوية منخفضة، فيُفك الخنق قبل أن يختار المشغّل الملف.
     */
    static void keepInterested(Torrent& t, lt::torrent_info const& ti) {
        auto const& files = ltc::files(ti);
        int best = -1;
        int64_t bestSize = 0;
        for (int i = 0; i < files.num_files(); ++i) {
            std::string const name = lower(files.file_path(lt::file_index_t(i)));
            bool const video = name.size() > 4 && (name.rfind(".mkv") == name.size() - 4 || name.rfind(".mp4") == name.size() - 4 || name.rfind(".avi") == name.size() - 4 || name.rfind(".m4v") == name.size() - 4 || name.rfind(".webm") == name.size() - 5);
            if (video && files.file_size(lt::file_index_t(i)) > bestSize) { best = i; bestSize = files.file_size(lt::file_index_t(i)); }
        }
        if (best < 0) return;
        int const first = int(files.file_offset(lt::file_index_t(best)) / ti.piece_length());
        // أولوية الملف نفسه منخفضة (لا 0): قطعة ملف أولويته 0 تُخزَّن في ملف .parts ثم تُنقل عند اختياره،
        // والقراءة أثناء النقل أعطت «End of file» وأوقفت التورنت (ثبت في القياس). ثم نصفّر كل القطع إلا الأولى.
        std::vector<lt::download_priority_t> fileprio(size_t(files.num_files()), lt::dont_download);
        fileprio[size_t(best)] = lt::low_priority;
        t.h.prioritize_files(fileprio);
        std::vector<lt::download_priority_t> pieces(size_t(ti.num_pieces()), lt::dont_download);
        pieces[size_t(first)] = lt::low_priority;
        t.h.prioritize_pieces(pieces);
    }

    // TorrentPolicy.edges: أول قطعة وآخر قطعتين من الملف
    static std::vector<int> edgePieces(lt::torrent_info const& ti, int index) {
        auto const& files = ltc::files(ti);
        int64_t const offset = files.file_offset(lt::file_index_t(index));
        int64_t const size = files.file_size(lt::file_index_t(index));
        if (size <= 0) return {0};
        int const first = int(offset / ti.piece_length());
        int const last = int((offset + size - 1) / ti.piece_length());
        std::vector<int> out{first};
        for (int p : {last - 1, last}) if (p >= first && std::find(out.begin(), out.end(), p) == out.end()) out.push_back(p);
        return out;
    }

    // TorrentEngine.prioritize: نافذة 12 قطعة بمواعيد متدرجة + الطرفان المعلّقان + ما بعدها بأولوية عادية،
    // وما قبل موضع القراءة لا يُطلب (رجوع/قفز لا يهدر السرعة على ما خلف المشاهدة).
    void reposition(std::shared_ptr<Torrent> const& t, lt::torrent_info const& ti, int fileIndex, int piece, uint64_t readerId) {
        std::lock_guard<std::mutex> lock(m_);
        t->readers[readerId] = Reader{piece, clk::now()};
        // القارئ الأحدث يقود النافذة (mpv يفتح قارئًا جديدًا عند القفز)
        uint64_t primary = readerId;
        clk::time_point latest{};
        for (auto const& [id, r] : t->readers) if (r.at >= latest) { latest = r.at; primary = id; }
        if (primary != readerId) return;
        if (piece == t->windowStart) return;
        t->windowStart = piece;
        auto const& files = ltc::files(ti);
        int64_t const offset = files.file_offset(lt::file_index_t(fileIndex));
        int64_t const size = files.file_size(lt::file_index_t(fileIndex));
        int const first = int(offset / ti.piece_length());
        int const last = int((offset + size - 1) / ti.piece_length());
        std::vector<int> window;
        for (int p = piece; p <= std::min(last, piece + policy::WINDOW - 1); ++p) window.push_back(p);
        std::vector<int> pending;
        for (int p : edgePieces(ti, fileIndex)) if (std::find(window.begin(), window.end(), p) == window.end() && !t->h.have_piece(lt::piece_index_t(p))) pending.push_back(p);
        auto const wanted = policy::deadlines(window, pending);
        std::set<int> keep;
        for (auto const& w : wanted) keep.insert(w.first);
        // الفرق فقط: مسح كل المواعيد يلغي طلبات جارية عند المشاركين
        for (int p : t->deadlined) if (!keep.count(p)) t->h.reset_piece_deadline(lt::piece_index_t(p));
        std::vector<lt::download_priority_t> prio(size_t(ti.num_pieces()), lt::dont_download);
        int const aheadEnd = std::min(last, piece + std::max(policy::AHEAD_PIECES, policy::WINDOW));
        for (int p = piece; p <= last; ++p) prio[size_t(p)] = p <= aheadEnd ? lt::download_priority_t(4) : lt::low_priority;
        for (int p : edgePieces(ti, fileIndex)) if (p >= first) prio[size_t(p)] = std::max(prio[size_t(p)], lt::download_priority_t(6));
        for (auto const& [p, deadline] : wanted) prio[size_t(p)] = deadline == 0 ? lt::top_priority : lt::download_priority_t(6);
        t->h.prioritize_pieces(prio);
        for (auto const& [p, deadline] : wanted) if (deadline == 0 || !t->deadlined.count(p)) t->h.set_piece_deadline(lt::piece_index_t(p), deadline);
        t->deadlined = keep;
    }

    std::shared_ptr<std::vector<char>> waitPiece(std::shared_ptr<Torrent> const& t, int piece) {
        std::unique_lock<std::mutex> lock(m_);
        bool waited = false;
        for (;;) {
            if (stopping_ || !byId_.count(t->id)) return nullptr;
            auto cached = t->pieceCache.find(piece);
            if (cached != t->pieceCache.end()) {
                if (waited && t->waitingPiece == piece) t->waitingPiece = -1;
                prefetchLocked(t, piece);
                return cached->second;
            }
            if (t->readErrors.count(piece)) {
                // قراءة فشلت مرتين: لا ننتظر للأبد؛ يغلق الاتصال فيعيد services المحاولة أو يبدّل المصدر
                if (++t->readFailures[piece] > 2) { std::cerr << "piece " << piece << " read failed: " << t->readErrors[piece] << '\n'; return nullptr; }
                t->readErrors.erase(piece); t->reading.erase(piece);
            }
            // خطأ تخزين يوقف التورنت كله: نحاول مسحه واستئنافه مرة، ثم نفشل صراحة بدل التعليق
            if (lt::torrent_status const st = t->h.status({}); st.errc) {
                if (t->errorRecoveries++ >= 1) { std::cerr << "torrent error persists: " << st.errc.message() << '\n'; return nullptr; }
                t->h.clear_error();
                t->h.resume();
            }
            if (t->h.have_piece(lt::piece_index_t(piece))) {
                // القطعة في يد خيط القراءة المسبقة: ننتظره (يوقظنا عند التخزين) بدل قراءتها مرتين
                if (policy::DIRECT_READ && t->directPending.count(piece)) { waited = true; cv_.wait_for(lock, 50ms); continue; }
                auto const retry = t->directRetry.find(piece);
                bool const directDue = retry == t->directRetry.end() || clk::now() >= retry->second.next;
                if (policy::DIRECT_READ && !t->directFailed.count(piece) && directDue) {
                    auto const started = clk::now();
                    lock.unlock();
                    auto data = directRead(t->h, piece);
                    lock.lock();
                    if (data) {
                        ++t->directHits;
                        recordReadLocked(*t, std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - started).count());
                        cacheLocked(*t, piece, std::move(data));
                        continue;
                    }
                    ++t->directMisses;
                    auto& r = t->directRetry[piece];
                    if (++r.attempts >= 20) t->directFailed.insert(piece);
                    r.next = clk::now() + 150ms;
                }
                if (t->reading.insert(piece).second) { t->readStart[piece] = clk::now(); t->h.read_piece(lt::piece_index_t(piece)); }
                prefetchLocked(t, piece);
            } else if (t->waitingPiece != piece) {
                t->waitingPiece = piece; t->waitingSince = clk::now();
            }
            waited = true;
            cv_.wait_for(lock, policy::DIRECT_READ && t->directRetry.count(piece) && !t->directFailed.count(piece) ? 150ms : 250ms);
        }
    }

    // القطع المكتملة التالية تُطلب من القرص مسبقًا بالتوازي (حتى READAHEAD)، فلا ينتظر القارئ زمن القرص لكل قطعة
    // مع التسليم المباشر: القطع التالية تُقرأ من ملفها في خيط مستقل (لا طابور libtorrent، فلا تزاحم الكتابة)
    void prefetchLocked(std::shared_ptr<Torrent> const& tp, int piece) {
        if (policy::READAHEAD <= 0) return;
        Torrent& t = *tp;
        auto const ti = t.h.torrent_file();
        if (!ti) return;
        for (int k = 1; k <= policy::READAHEAD; ++k) {
            int const p = piece + k;
            if (p >= ti->num_pieces()) break;
            if (t.pieceCache.count(p) || t.reading.count(p) || t.directPending.count(p)) continue;
            if (!t.h.have_piece(lt::piece_index_t(p))) break;
            if (auto r = t.directRetry.find(p); r != t.directRetry.end() && clk::now() < r->second.next) continue;
            if (policy::DIRECT_READ && !t.directFailed.count(p)) { t.directPending.insert(p); directQueue_.emplace_back(tp, p); continue; }
            t.reading.insert(p); t.readStart[p] = clk::now(); t.h.read_piece(lt::piece_index_t(p));
        }
    }

    void directLoop() {
        std::unique_lock<std::mutex> lock(m_);
        while (!stopping_) {
            if (directQueue_.empty()) { cv_.wait_for(lock, 100ms); continue; }
            auto [weak, p] = directQueue_.front();
            directQueue_.pop_front();
            auto t = weak.lock();
            if (!t || !byId_.count(t->id)) continue;
            if (t->pieceCache.count(p)) { t->directPending.erase(p); continue; }
            auto const h = t->h;
            lock.unlock();
            auto data = directRead(h, p);
            lock.lock();
            t->directPending.erase(p);
            if (data) { ++t->directHits; ++t->directAhead; cacheLocked(*t, p, std::move(data)); }
            else { ++t->directMisses; auto& r = t->directRetry[p]; ++r.attempts; r.next = clk::now() + 150ms; }
            cv_.notify_all();
        }
    }

    // القطعة من ملفها مباشرة (ملفات الحشو أصفار)، ثم مطابقة SHA-1 مع التورنت. nullptr عند أي شك.
    std::shared_ptr<std::vector<char>> directRead(lt::torrent_handle const& h, int piece) {
        try {
            auto const ti = h.torrent_file();
            if (!ti || !ti->info_hashes().has_v1()) return nullptr;
            auto const& layout = ltc::files(*ti);
            lt::piece_index_t const pi(piece);
            int const size = ti->piece_size(pi);
            auto buf = std::make_shared<std::vector<char>>(size_t(size), char(0));
            int64_t off = 0;
            for (auto const& sl : ti->map_block(pi, 0, size)) {
                if (!layout.pad_file_at(sl.file_index)) {
                    std::ifstream in(fs::u8path(layout.file_path(sl.file_index, dir_)), std::ios::binary);
                    if (!in) return nullptr;
                    in.seekg(std::streamoff(sl.offset));
                    in.read(buf->data() + off, std::streamsize(sl.size));
                    if (in.gcount() != std::streamsize(sl.size)) return nullptr;
                }
                off += sl.size;
            }
            if (lt::hasher(buf->data(), size).final() != ti->hash_for_piece(pi)) return nullptr;
            return buf;
        } catch (...) { return nullptr; }
    }

    void recordReadLocked(Torrent& t, int64_t ms) {
        t.readLastMs = ms; t.readMaxMs = std::max(t.readMaxMs, ms); ++t.readCount;
        t.readAvgMs += (double(ms) - t.readAvgMs) / t.readCount;
    }

    void cacheLocked(Torrent& t, int p, std::shared_ptr<std::vector<char>> data) {
        t.directRetry.erase(p);
        t.pieceCache[p] = std::move(data);
        t.cacheOrder.push_back(p);
        while (t.cacheOrder.size() > size_t(std::max(6, policy::READAHEAD + 2))) { t.pieceCache.erase(t.cacheOrder.front()); t.cacheOrder.pop_front(); }
    }

    void storePiece(lt::read_piece_alert const* a) {
        std::lock_guard<std::mutex> lock(m_);
        for (auto& [id, t] : byId_) {
            if (t->h != a->handle) continue;
            int const p = int(static_cast<std::int32_t>(a->piece));
            t->reading.erase(p);
            if (auto s = t->readStart.find(p); s != t->readStart.end()) {
                recordReadLocked(*t, std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - s->second).count());
                t->readStart.erase(s);
            }
            if (a->error) { t->readErrors[p] = a->error.message(); break; }
            cacheLocked(*t, p, std::make_shared<std::vector<char>>(a->buffer.get(), a->buffer.get() + a->size));
            break;
        }
    }

    // TorrentHotswap.victims: من يرسل القطعة المنتظرة أبطأ بكثير من غيره، مع وجود من هو أسرع منه 3 مرات
    void hotswap() {
        std::vector<std::shared_ptr<Torrent>> list;
        {
            std::lock_guard<std::mutex> lock(m_);
            for (auto& [id, t] : byId_) if (t->waitingPiece >= 0 && clk::now() - t->waitingSince >= policy::HOTSWAP_WAIT) list.push_back(t);
        }
        if (list.empty() || allowPrivate_) return;
        bool changed = false;
        for (auto const& t : list) {
            std::vector<lt::peer_info> peers;
            t->h.get_peer_info(peers);
            std::vector<int> others;
            for (auto const& p : peers) if (int(static_cast<std::int32_t>(p.downloading_piece_index)) != t->waitingPiece && p.down_speed > 0) others.push_back(p.down_speed);
            if (others.empty()) continue;
            std::sort(others.begin(), others.end());
            int const typical = others[others.size() / 2], fastest = others.back();
            std::vector<std::pair<int, asio::ip::address>> victims;
            for (auto const& p : peers)
                if (int(static_cast<std::int32_t>(p.downloading_piece_index)) == t->waitingPiece && p.down_speed < std::max(policy::SLOW_BPS, typical / 4) && fastest >= std::max(p.down_speed * 3, policy::SLOW_BPS))
                    victims.emplace_back(p.down_speed, ltc::endpoint(p).address());
            std::sort(victims.begin(), victims.end(), [](auto& a, auto& b) { return a.first < b.first; });
            for (size_t i = 0; i < victims.size() && i < size_t(policy::MAX_VICTIMS); ++i) { banned_[victims[i].second] = clk::now() + policy::HOTSWAP_BAN; changed = true; ++swaps_; }
            std::lock_guard<std::mutex> lock(m_);
            t->waitingSince = clk::now();
        }
        for (auto it = banned_.begin(); it != banned_.end();) { if (it->second <= clk::now()) { it = banned_.erase(it); changed = true; } else ++it; }
        if (changed) {
            auto f = publicNetworkFilter();
            for (auto const& [ip, until] : banned_) f.add_rule(ip, ip, lt::ip_filter::blocked);
            ses_->set_ip_filter(f);
        }
    }

    void saveDht() {
        if (stateDir_.empty() || !ses_) return;
        try {
            auto buf = lt::write_session_params_buf(ses_->session_state(lt::session::save_dht_state), lt::session::save_dht_state);
            fs::create_directories(fs::u8path(stateDir_));
            auto tmp = fs::u8path(stateDir_) / "dht.state.tmp";
            { std::ofstream out(tmp, std::ios::binary | std::ios::trunc); out.write(buf.data(), std::streamsize(buf.size())); }
            fs::rename(tmp, fs::u8path(stateDir_) / "dht.state");
        } catch (...) {}
    }

    void alertLoop() {
        auto lastHotswap = clk::now(), lastSave = clk::now();
        while (!stopping_) {
            ses_->wait_for_alert(200ms);
            std::vector<lt::alert*> alerts;
            ses_->pop_alerts(&alerts);
            bool notify = false;
            for (lt::alert* a : alerts) {
                if (auto* r = lt::alert_cast<lt::read_piece_alert>(a)) { storePiece(r); notify = true; }
                else if (lt::alert_cast<lt::piece_finished_alert>(a) || lt::alert_cast<lt::metadata_received_alert>(a) || lt::alert_cast<lt::torrent_removed_alert>(a) || lt::alert_cast<lt::hash_failed_alert>(a)) notify = true;
                else if (auto* e = lt::alert_cast<lt::torrent_error_alert>(a)) { std::cerr << "torrent error: " << e->message() << '\n'; notify = true; }
                if (debug_ && (lt::alert_cast<lt::peer_error_alert>(a) || lt::alert_cast<lt::peer_disconnected_alert>(a) || lt::alert_cast<lt::peer_connect_alert>(a) || lt::alert_cast<lt::listen_failed_alert>(a) || lt::alert_cast<lt::listen_succeeded_alert>(a)))
                    std::cerr << "[vantara-torrent] " << a->message() << '\n';
            }
            if (notify) cv_.notify_all();
            if (clk::now() - lastHotswap >= 1s) { hotswap(); lastHotswap = clk::now(); }
            if (clk::now() - lastSave >= 60s) { saveDht(); lastSave = clk::now(); }
        }
    }

    std::string dir_, stateDir_;
    bool allowPrivate_;
    std::string testPeer_;
    std::unique_ptr<lt::session> ses_;
    std::mutex m_;
    std::condition_variable cv_;
    std::map<int, std::shared_ptr<Torrent>> byId_;
    std::unordered_map<std::string, std::shared_ptr<Torrent>> byHash_;
    std::map<asio::ip::address, clk::time_point> banned_;
    int nextId_ = 0;
    std::atomic<uint64_t> readerSeq_{0};
    std::atomic<int> swaps_{0};
    std::atomic<bool> stopping_{false};
    std::thread alerts_;
    std::thread direct_;
    std::deque<std::pair<std::weak_ptr<Torrent>, int>> directQueue_;
    bool debug_ = std::getenv("VANTARA_TORRENT_LOG") != nullptr;
};

// ───────────────────────────── خادم HTTP محلي ─────────────────────────────
struct Request { std::string method, path; std::map<std::string, std::string> query, headers; std::string body; };

static bool readRequest(tcp::socket& sock, Request& req) {
    asio::streambuf buf;
    boost::system::error_code ec;
    std::size_t n = asio::read_until(sock, buf, "\r\n\r\n", ec);
    if (ec || n > 16384) return false;
    std::string head(asio::buffers_begin(buf.data()), asio::buffers_begin(buf.data()) + std::ptrdiff_t(n));
    buf.consume(n);
    std::istringstream in(head);
    std::string line, target, version;
    std::getline(in, line);
    std::istringstream first(line);
    first >> req.method >> target >> version;
    if (req.method.empty() || target.empty() || target[0] != '/') return false;
    while (std::getline(in, line) && line != "\r") {
        auto colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string value = line.substr(colon + 1);
        while (!value.empty() && (value.front() == ' ')) value.erase(0, 1);
        while (!value.empty() && (value.back() == '\r' || value.back() == ' ')) value.pop_back();
        req.headers[lower(line.substr(0, colon))] = value;
    }
    auto qpos = target.find('?');
    req.path = urlDecode(target.substr(0, qpos));
    if (qpos != std::string::npos)
        for (auto& kv : split(target.substr(qpos + 1), '&')) {
            if (kv.empty()) continue;
            auto eq = kv.find('=');
            req.query[urlDecode(kv.substr(0, eq))] = eq == std::string::npos ? "" : urlDecode(kv.substr(eq + 1));
        }
    size_t length = 0;
    if (req.headers.count("content-length")) {
        try { length = std::stoul(req.headers["content-length"]); } catch (...) { return false; }
        if (length > 65536) return false;
    }
    req.body.assign(asio::buffers_begin(buf.data()), asio::buffers_end(buf.data()));
    if (req.body.size() < length) {
        std::vector<char> rest(length - req.body.size());
        asio::read(sock, asio::buffer(rest), ec);
        if (ec) return false;
        req.body.append(rest.begin(), rest.end());
    }
    req.body.resize(std::min(req.body.size(), length));
    return true;
}

static void writeAll(tcp::socket& sock, std::string const& data) {
    boost::system::error_code ec;
    asio::write(sock, asio::buffer(data), ec);
}

static std::string statusText(int s) {
    switch (s) { case 200: return "OK"; case 206: return "Partial Content"; case 400: return "Bad Request"; case 401: return "Unauthorized";
        case 404: return "Not Found"; case 416: return "Range Not Satisfiable"; case 504: return "Gateway Timeout"; default: return "Error"; }
}

static void respond(tcp::socket& sock, Engine::Result const& r) {
    std::ostringstream o;
    o << "HTTP/1.1 " << r.status << ' ' << statusText(r.status) << "\r\nContent-Type: " << r.type << "\r\nContent-Length: " << r.body.size() << "\r\nConnection: close\r\n";
    for (auto const& [k, v] : r.headers) o << k << ": " << v << "\r\n";
    o << "\r\n" << r.body;
    writeAll(sock, o.str());
}

static void serve(Engine& engine, std::string const& expectedAuth, tcp::socket sock) {
    Request req;
    if (!readRequest(sock, req)) return;
    if (!expectedAuth.empty() && req.headers["authorization"] != "Basic " + base64(expectedAuth)) return respond(sock, {401, R"({"error":"unauthorized"})"});
    int timeoutMs = 15000;
    if (req.headers.count("x-req-timeout-ms")) { try { timeoutMs = std::clamp(std::stoi(req.headers["x-req-timeout-ms"]), 1000, 600000); } catch (...) {} }
    auto parts = split(req.path, '/');  // "", "torrents", id, action, file
    if (req.path == "/") return respond(sock, {200, std::string("{\"server\":\"vantara-torrent\",\"engine\":\"libtorrent\",\"version\":\"") + VERSION + "\",\"libtorrent\":\"" + lt::version() + "\"}"});
    if (req.method == "POST" && req.path == "/torrents") {
        std::string magnet = req.body;
        while (!magnet.empty() && (magnet.back() == '\n' || magnet.back() == '\r' || magnet.back() == ' ')) magnet.pop_back();
        if (magnet.rfind("magnet:?", 0) != 0 || magnet.size() > 16384) return respond(sock, {400, R"({"error":"magnet required"})"});
        return respond(sock, engine.add(magnet, req.query, timeoutMs));
    }
    if (parts.size() >= 4 && parts[1] == "torrents") {
        int id;
        try { id = std::stoi(parts[2]); } catch (...) { return respond(sock, {404, R"({"error":"not found"})"}); }
        std::string const& what = parts[3];
        if (req.method == "GET" && what == "stats" && parts.size() == 5 && parts[4] == "v1") return respond(sock, engine.stats(id));
        if (req.method == "GET" && what == "haves") return respond(sock, engine.haves(id));
        if (req.method == "GET" && what == "diag") return respond(sock, engine.diag(id));
        if (req.method == "POST" && parts.size() == 4) return respond(sock, engine.action(id, what));
        if (req.method == "GET" && what == "stream" && parts.size() == 5) {
            auto t = engine.find(id);
            if (!t) return respond(sock, {404, R"({"error":"not found"})"});
            auto ti = t->h.torrent_file();
            int fileIndex;
            try { fileIndex = std::stoi(parts[4]); } catch (...) { return respond(sock, {404, R"({"error":"bad file"})"}); }
            if (!ti || fileIndex < 0 || fileIndex >= ti->num_files()) return respond(sock, {404, R"({"error":"bad file"})"});
            int64_t const size = ltc::files(*ti).file_size(lt::file_index_t(fileIndex));
            int64_t from = 0, to = size - 1;
            bool partial = false;
            auto range = req.headers.find("range");
            if (range != req.headers.end() && range->second.rfind("bytes=", 0) == 0) {
                std::string spec = range->second.substr(6);
                auto dash = spec.find('-');
                try {
                    if (dash == 0) { int64_t n = std::stoll(spec.substr(1)); from = std::max<int64_t>(0, size - n); }
                    else { from = std::stoll(spec.substr(0, dash)); if (dash + 1 < spec.size()) to = std::min<int64_t>(size - 1, std::stoll(spec.substr(dash + 1))); }
                } catch (...) { return respond(sock, {416, "{}"}); }
                partial = true;
            }
            if (from < 0 || from >= size || to < from) {
                Engine::Result r{416, "{}"};
                r.headers.emplace_back("Content-Range", "bytes */" + std::to_string(size));
                return respond(sock, r);
            }
            std::string name(ltc::files(*ti).file_name(lt::file_index_t(fileIndex)));
            std::string ext = lower(name.substr(name.rfind('.') == std::string::npos ? name.size() : name.rfind('.')));
            std::string type = ext == ".mp4" || ext == ".m4v" ? "video/mp4" : ext == ".mkv" ? "video/x-matroska" : ext == ".webm" ? "video/webm" : "application/octet-stream";
            std::ostringstream o;
            o << "HTTP/1.1 " << (partial ? "206 Partial Content" : "200 OK") << "\r\nContent-Type: " << type << "\r\nAccept-Ranges: bytes\r\nContent-Length: " << (to - from + 1) << "\r\nConnection: close\r\n";
            if (partial) o << "Content-Range: bytes " << from << '-' << to << '/' << size << "\r\n";
            o << "\r\n";
            boost::system::error_code ec;
            asio::write(sock, asio::buffer(o.str()), ec);
            if (ec || req.method == "HEAD") return;
            uint64_t const reader = engine.newReader();
            engine.stream(t, fileIndex, from, to, reader, [&](char const* data, size_t n) {
                boost::system::error_code e;
                asio::write(sock, asio::buffer(data, n), e);
                return !e;
            });
            engine.dropReader(t, reader);
            return;
        }
    }
    respond(sock, {404, R"({"error":"not found"})"});
}

// ───────────────────────────── الإقلاع ─────────────────────────────
static std::atomic<bool> g_quit{false};

static bool parentAlive(long pid) {
    if (pid <= 0) return true;
#ifdef _WIN32
    HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, DWORD(pid));
    if (!h) return false;
    DWORD r = WaitForSingleObject(h, 0);
    CloseHandle(h);
    return r == WAIT_TIMEOUT;
#else
    return kill(pid_t(pid), 0) == 0;
#endif
}

// وضع البذر المحلي للاختبارات فقط: ينشئ تورنت ملف ويبذره ويطبع المغناطيس.
static int seedMode(std::string const& file, int port, int pieceSize) {
#if LIBTORRENT_VERSION_NUM >= 20100
    lt::create_torrent ct(lt::list_files(file), pieceSize, lt::create_torrent::v1_only);
#else
    lt::file_storage storage;
    lt::add_files(storage, file);
    lt::create_torrent ct(storage, pieceSize, lt::create_torrent::v1_only);
#endif
    lt::set_piece_hashes(ct, fs::path(file).parent_path().string());
    std::vector<char> buf;
    lt::bencode(std::back_inserter(buf), ct.generate());
    // load_torrent_buffer موجود في 2.0.7+ و2.1، بدل from_span المحذوف في 2.1
    lt::add_torrent_params p = lt::load_torrent_buffer(lt::span<char const>(buf.data(), std::ptrdiff_t(buf.size())));
    p.info_hashes = p.ti->info_hashes();  // make_magnet_uri(atp) يبني المغناطيس من info_hashes
    lt::settings_pack s;
    s.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:" + std::to_string(port));
    s.set_bool(lt::settings_pack::enable_dht, false);
    s.set_bool(lt::settings_pack::enable_lsd, false);
    s.set_bool(lt::settings_pack::enable_upnp, false);
    s.set_bool(lt::settings_pack::enable_natpmp, false);
    s.set_bool(lt::settings_pack::allow_multiple_connections_per_ip, true);
    s.set_int(lt::settings_pack::alert_mask, lt::alert_category::status | lt::alert_category::error | (std::getenv("VANTARA_TORRENT_LOG") ? lt::alert_category::peer | lt::alert_category::connect | lt::alert_category::peer_log : lt::alert_category_t{}));
    s.set_int(lt::settings_pack::upload_rate_limit, std::getenv("VANTARA_SEED_RATE") ? std::atoi(std::getenv("VANTARA_SEED_RATE")) : 0);
    lt::session ses(s);
    p.save_path = fs::path(file).parent_path().string();
    p.flags |= lt::torrent_flags::seed_mode;
    // الافتراضي paused|auto_managed: التورنت الموقوف يرفض الاتصال الوارد حتى يستأنفه المدير لاحقًا
    p.flags &= ~(lt::torrent_flags::paused | lt::torrent_flags::auto_managed);
    lt::torrent_handle seeded = ses.add_torrent(p);
    // المغناطيس يُطبع بعد أن يستمع الباذر ويصبح تورنته في حالة البذر فعلًا: قبلها يقطع الاتصال الوارد،
    // ومحاولة أولى فاشلة تؤخر إعادة الاتصال ~60 ث فتُفسد قياس الاختبار.
    for (bool listening = false; (!listening || seeded.status().state != lt::torrent_status::seeding) && !g_quit;) {
        ses.wait_for_alert(100ms);
        std::vector<lt::alert*> alerts;
        ses.pop_alerts(&alerts);
        for (auto* a : alerts) {
            if (lt::alert_cast<lt::listen_succeeded_alert>(a)) listening = true;
            if (auto* f = lt::alert_cast<lt::listen_failed_alert>(a)) { std::cerr << f->message() << '\n'; return 4; }
        }
    }
    std::cout << lt::make_magnet_uri(p) << "&x.pe=127.0.0.1:" << port << std::endl;
    bool const debug = std::getenv("VANTARA_TORRENT_LOG") != nullptr;
    while (!g_quit) {
        ses.wait_for_alert(200ms);
        std::vector<lt::alert*> alerts;
        ses.pop_alerts(&alerts);
        if (debug) for (auto* a : alerts) std::cerr << "[seed] " << a->message() << '\n';
    }
    return 0;
}

int main(int argc, char** argv) {
    // تجارب القياس فقط: حجم نافذة القراءة وما بعدها؛ بلا المتغيرين تبقى قيم الـAPK (12 و64)
    if (const char* w = std::getenv("VANTARA_LT_WINDOW")) policy::WINDOW = std::max(1, std::atoi(w));
    if (const char* a = std::getenv("VANTARA_LT_AHEAD")) policy::AHEAD_PIECES = std::max(1, std::atoi(a));
    if (const char* r = std::getenv("VANTARA_LT_READAHEAD")) policy::READAHEAD = std::clamp(std::atoi(r), 0, 16);
    if (const char* d = std::getenv("VANTARA_LT_DISK")) policy::DISK_IO = d;
    if (const char* d = std::getenv("VANTARA_LT_DIRECT")) policy::DIRECT_READ = std::string(d) == "1";
    int apiPort = 0, listenPort = 0, pieceSize = 256 * 1024;
    long parentPid = 0;
    std::string dir, stateDir, seedFile, testPeer;
    bool allowPrivate = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto value = [&](char const* name) -> std::optional<std::string> { std::string p = std::string("--") + name + "="; return a.rfind(p, 0) == 0 ? std::optional<std::string>(a.substr(p.size())) : std::nullopt; };
        if (auto v = value("api-port")) apiPort = std::atoi(v->c_str());
        else if (auto v = value("listen-port")) listenPort = std::atoi(v->c_str());
        else if (auto v = value("dir")) dir = *v;
        else if (auto v = value("state-dir")) stateDir = *v;
        else if (auto v = value("parent-pid")) parentPid = std::atol(v->c_str());
        else if (auto v = value("seed")) seedFile = *v;
        else if (auto v = value("piece-size")) pieceSize = std::atoi(v->c_str());
        else if (auto v = value("test-peer")) testPeer = *v;
        else if (a == "--allow-private-peers") allowPrivate = true;
        else if (a == "--version") { std::cout << "vantara-torrent " << VERSION << " libtorrent " << lt::version() << std::endl; return 0; }
    }
#ifndef _WIN32
    std::signal(SIGTERM, [](int) { g_quit = true; });
    std::signal(SIGINT, [](int) { g_quit = true; });
    std::signal(SIGPIPE, SIG_IGN);
#endif
    if (!seedFile.empty()) return seedMode(seedFile, listenPort, pieceSize);
    if (apiPort <= 0 || apiPort > 65535 || listenPort <= 0 || listenPort > 65535 || dir.empty()) {
        std::cerr << "usage: vantara-torrent --api-port=N --listen-port=N --dir=PATH [--state-dir=PATH] [--parent-pid=N]\n";
        return 2;
    }
    char const* authEnv = std::getenv("VANTARA_TORRENT_AUTH");
    if (!authEnv) authEnv = std::getenv("RQBIT_HTTP_BASIC_AUTH_USERPASS");
    std::string const auth = authEnv ? authEnv : "";
    try { fs::create_directories(fs::u8path(dir)); } catch (...) {}
    if (!testPeer.empty() && !allowPrivate) { std::cerr << "--test-peer requires --allow-private-peers\n"; return 2; }
    Engine engine(dir, stateDir, listenPort, allowPrivate, testPeer);
    asio::io_context io;
    tcp::acceptor acceptor(io);
    {
        tcp::endpoint const endpoint(asio::ip::make_address("127.0.0.1"), std::uint16_t(apiPort));
        acceptor.open(endpoint.protocol());
        acceptor.set_option(tcp::acceptor::reuse_address(true));
        boost::system::error_code ec;
        acceptor.bind(endpoint, ec);
        if (ec) { std::cerr << "api bind failed: " << ec.message() << '\n'; return 3; }
        acceptor.listen();
        // غير حاجب: إغلاق المقبس من خيط آخر لا يوقظ accept() الحاجب على لينكس، فكان المحرك يبقى
        // حيًا بعد موت الأب أو SIGTERM. الحلقة تفحص g_quit كل 10ms.
        acceptor.non_blocking(true);
    }
    std::atomic<int> active{0};
    std::thread watchdog([&] {
        while (!g_quit) {
            if (!parentAlive(parentPid)) g_quit = true;
            std::this_thread::sleep_for(500ms);
        }
        boost::system::error_code ec;
        acceptor.close(ec);
    });
    while (!g_quit) {
        boost::system::error_code ec;
        tcp::socket sock(io);
        acceptor.accept(sock, ec);
        if (ec == asio::error::would_block || ec == asio::error::try_again) { std::this_thread::sleep_for(10ms); continue; }
        if (ec) { if (g_quit) break; std::this_thread::sleep_for(10ms); continue; }
        sock.non_blocking(false, ec);
        if (active >= 64) { sock.close(ec); continue; }
        ++active;
        std::thread([&engine, &auth, &active, s = std::move(sock)]() mutable {
            try { serve(engine, auth, std::move(s)); } catch (std::exception const& e) { std::cerr << "request failed: " << e.what() << '\n'; }
            --active;
        }).detach();
    }
    g_quit = true;
    if (watchdog.joinable()) watchdog.join();
    engine.stop();
    return 0;
}
