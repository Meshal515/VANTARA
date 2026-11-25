// stall-bench: قياس محلي حتمي لانحباس رأس الطابور في libtorrent (لا شبكة عامة، لا محتوى طرف ثالث).
//
// سرب على loopback: باذر سريع (سقف رفع FAST_KBPS) وباذر بطيء (SLOW_KBPS) يملكان الملف نفسه، ومنزّل
// يتصرف كقارئ VANTARA: نافذة 12 قطعة بمواعيد (الأولى 0ms)، وما بعدها حتى AHEAD بأولوية 4، ويتقدم قطعة
// قطعة. الباذر البطيء يأخذ نصيبه من الطلبات فتعلق كتل القطعة المنتظرة عنده: هذا ما قيس على الجوال
// (511/512 لمدة 6.8 ث).
//
// الأوضاع (argv[1]):
//   diff    تعديل المواعيد بالفرق (ويندوز، ونافذة أندرويد الجديدة)
//   legacy  clear_piece_deadlines ثم إعادتها عند كل تقدّم (نافذة أندرويد الإنتاجية legacyWindow=true)
// سقف المهلة يُضبط بمتغير البيئة VANTARA_LT_STALL_CAP_MS (0 = libtorrent الأصلي حرفيًا).
//
// الناتج سطر JSON: زمن كل قطعة ينتظرها القارئ، وأطول انتظار، والزمن الكلي، والبايتات المكررة.
#include <libtorrent/session.hpp>
#include <libtorrent/session_params.hpp>
#include <libtorrent/settings_pack.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/ip_filter.hpp>
#include <libtorrent/peer_class.hpp>
#include <libtorrent/session_stats.hpp>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <string>
#include <thread>
#include <vector>
#include <algorithm>

namespace lt = libtorrent;
namespace fs = std::filesystem;
using clk = std::chrono::steady_clock;

static int envInt(char const* name, int def) {
  char const* v = std::getenv(name);
  return (v && *v) ? std::atoi(v) : def;
}

static lt::settings_pack base(int port) {
  lt::settings_pack s;
  s.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:" + std::to_string(port));
  s.set_bool(lt::settings_pack::enable_dht, false);
  s.set_bool(lt::settings_pack::enable_lsd, false);
  s.set_bool(lt::settings_pack::enable_upnp, false);
  s.set_bool(lt::settings_pack::enable_natpmp, false);
  s.set_bool(lt::settings_pack::allow_multiple_connections_per_ip, true);
  s.set_bool(lt::settings_pack::enable_outgoing_utp, false);
  s.set_bool(lt::settings_pack::enable_incoming_utp, false);
  s.set_int(lt::settings_pack::alert_mask, lt::alert_category::error);
  return s;
}

// إعدادات البث كما في TorrentEngine.streamingSettings() وvantara-torrent.cpp (الأجزاء المؤثرة في الطلبات)
static void streaming(lt::settings_pack& s) {
  s.set_int(lt::settings_pack::connections_limit, 400);
  s.set_int(lt::settings_pack::max_queued_disk_bytes, 8 * 1024 * 1024);
  s.set_bool(lt::settings_pack::strict_end_game_mode, false);
  s.set_bool(lt::settings_pack::close_redundant_connections, false);
  s.set_int(lt::settings_pack::request_timeout, 4);
  s.set_int(lt::settings_pack::piece_timeout, 8);
  s.set_int(lt::settings_pack::max_out_request_queue, 250);
  s.set_int(lt::settings_pack::request_queue_time, 1);
  s.set_int(lt::settings_pack::whole_pieces_threshold, 0);
  s.set_bool(lt::settings_pack::piece_extent_affinity, false);
  // BENCH_IPT: initial_picker_threshold (الافتراضي في libtorrent 4: أول أربع قطع تُختار عشوائيًا وتُهمل الأولوية)
  if (std::getenv("BENCH_IPT")) s.set_int(lt::settings_pack::initial_picker_threshold, envInt("BENCH_IPT", 4));
  int const tick = envInt("BENCH_TICK_MS", 0);
  if (tick > 0) s.set_int(lt::settings_pack::tick_interval, tick);
}

// loopback معفى من حدود السرعة افتراضيًا (local peer class): نزيل الإعفاء ونضع سقف رفع لكل باذر
static void limitUpload(lt::session& ses, int kbps) {
  lt::ip_filter all;
  all.add_rule(lt::make_address("0.0.0.0"), lt::make_address("255.255.255.255"),
    1u << static_cast<std::uint32_t>(lt::session::global_peer_class_id));
  ses.set_peer_class_filter(all);
  auto info = ses.get_peer_class(lt::session::global_peer_class_id);
  info.upload_limit = kbps * 1024;
  ses.set_peer_class(lt::session::global_peer_class_id, info);
}

int main(int argc, char** argv) {
  std::string const mode = argc > 1 ? argv[1] : "diff";
  int const pieceKb = envInt("BENCH_PIECE_KB", 8192);
  int const pieces = envInt("BENCH_PIECES", 24);
  int const readPieces = envInt("BENCH_READ", 16);
  int const fastKbps = envInt("BENCH_FAST_KBPS", 4096);
  int const slowKbps = envInt("BENCH_SLOW_KBPS", 48);
  int const ahead = envInt("BENCH_AHEAD", 64);
  int const window = 12;
  int const basePort = envInt("BENCH_PORT", 46100);
  fs::path const root = fs::temp_directory_path() / ("stall-bench-" + std::to_string(basePort));
  fs::remove_all(root);
  fs::create_directories(root / "seed");

  // ملف عشوائي ثابت البذرة (نفس المحتوى في كل تشغيل)
  std::int64_t const size = std::int64_t(pieceKb) * 1024 * pieces;
  {
    std::ofstream f(root / "seed" / "video.bin", std::ios::binary);
    std::mt19937_64 rng(42);
    std::vector<std::uint64_t> buf(1 << 16);
    for (std::int64_t done = 0; done < size; done += std::int64_t(buf.size() * 8)) {
      for (auto& x : buf) x = rng();
      f.write(reinterpret_cast<char const*>(buf.data()), std::min<std::int64_t>(std::int64_t(buf.size() * 8), size - done));
    }
  }
  lt::file_storage fsto;
  lt::add_files(fsto, (root / "seed" / "video.bin").string());
  lt::create_torrent ct(fsto, pieceKb * 1024, lt::create_torrent::v1_only);
  lt::set_piece_hashes(ct, (root / "seed").string());
  std::vector<char> buf;
  lt::bencode(std::back_inserter(buf), ct.generate());
  auto const ti = std::make_shared<lt::torrent_info>(buf, lt::from_span);

  auto seeder = [&](int port, int kbps) {
    auto s = base(port);
    auto ses = std::make_unique<lt::session>(lt::session_params(s));
    limitUpload(*ses, kbps);
    lt::add_torrent_params p;
    p.ti = ti;
    p.save_path = (root / "seed").string();
    p.flags |= lt::torrent_flags::seed_mode;
    ses->add_torrent(p);
    return ses;
  };
  auto fast = seeder(basePort + 1, fastKbps);
  auto slow = seeder(basePort + 2, slowKbps);

  auto ds = base(basePort);
  streaming(ds);
  lt::session dl{lt::session_params(ds)};
  lt::add_torrent_params p;
  p.ti = ti;
  p.save_path = (root / "dl").string();
  p.flags &= ~lt::torrent_flags::auto_managed;
  p.flags &= ~lt::torrent_flags::paused;
  p.piece_priorities.assign(std::size_t(pieces), lt::dont_download);
  if (envInt("BENCH_SEQ", 0)) p.flags |= lt::torrent_flags::sequential_download;
  auto h = dl.add_torrent(p);
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  // البطيء أولًا: يأخذ طلبات القطعة الأولى قبل أن يتصل السريع (كما يحدث مع مشارك أبكر لكن أبطأ)
  if (!envInt("BENCH_NO_SLOW", 0)) h.connect_peer({lt::make_address("127.0.0.1"), std::uint16_t(basePort + 2)});
  std::this_thread::sleep_for(std::chrono::milliseconds(150));
  h.connect_peer({lt::make_address("127.0.0.1"), std::uint16_t(basePort + 1)});

  std::set<int> deadlined;
  std::set<int> aheadSet;
  auto place = [&](int head) {
    std::vector<std::pair<int, int>> wanted;
    // BENCH_CRIT: كم قطعة من النافذة تأخذ موعدًا (libtorrent يرفع كل قطعة بموعد إلى الأولوية 7، فيقسم
    // السرعة عليها كلها)؛ الباقي أولوية 6 بلا موعد
    int const crit = envInt("BENCH_CRIT", window);
    for (int k = 0; k < window && head + k < pieces; ++k) {
      int const dl_ms = k == 0 ? 0 : (k < 4 ? 250 * k : 750 + (k - 3) * 750);
      if (k < crit) wanted.emplace_back(head + k, dl_ms);
      else h.piece_priority(lt::piece_index_t(head + k), lt::download_priority_t(6));
    }
    std::set<int> keep;
    for (auto& w : wanted) keep.insert(w.first);
    if (mode == "legacy") {
      h.clear_piece_deadlines();
      for (auto& [pc, d] : wanted) { h.piece_priority(lt::piece_index_t(pc), lt::top_priority); h.set_piece_deadline(lt::piece_index_t(pc), d); }
    } else {
      for (int pc : deadlined) if (!keep.count(pc)) h.reset_piece_deadline(lt::piece_index_t(pc));
      for (auto& [pc, d] : wanted) {
        if (deadlined.count(pc) && d != 0) continue;
        h.piece_priority(lt::piece_index_t(pc), lt::top_priority);
        if (!deadlined.count(pc)) h.set_piece_deadline(lt::piece_index_t(pc), d);
      }
    }
    for (int pc = 0; pc < head; ++pc) h.piece_priority(lt::piece_index_t(pc), lt::dont_download);
    deadlined = keep;
    for (int pc = head + window; pc < std::min(pieces, head + ahead); ++pc)
      if (aheadSet.insert(pc).second) h.piece_priority(lt::piece_index_t(pc), lt::download_priority_t(4));
  };

  auto const start = clk::now();
  std::vector<long> waits;
  long worst = 0;
  bool timedOut = false;
  for (int head = 0; head < readPieces; ++head) {
    place(head);
    auto const t0 = clk::now();
    int tracedAt = 0;
    while (!h.have_piece(lt::piece_index_t(head))) {
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
      if (head == 0 && envInt("BENCH_TRACE", 0)) {
        int const ms = int(std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - t0).count());
        if (ms - tracedAt >= 500) {
          tracedAt = ms;
          auto const st = h.status(lt::torrent_handle::query_pieces);
          std::vector<lt::partial_piece_info> q; h.get_download_queue(q);
          int fin = 0, req = 0;
          std::string idx;
          for (auto const& pp : q) {
            idx += std::to_string(static_cast<int>(pp.piece_index)) + ":" + std::to_string(pp.finished) + "/" + std::to_string(pp.requested) + " ";
            if (pp.piece_index == lt::piece_index_t(0)) { fin = pp.finished; req = pp.requested; }
          }
          std::cerr << "  queue " << idx << " prio0=" << int(static_cast<std::uint8_t>(h.piece_priority(lt::piece_index_t(0)))) << "\n";
          std::cerr << ms << "ms payload=" << (st.total_payload_download >> 10) << "KB peers=" << st.num_peers
                    << " p0 finished=" << fin << " requested=" << req << " downloading=" << q.size() << "\n";
        }
      }
      if (clk::now() - start > std::chrono::seconds(envInt("BENCH_BUDGET_S", 240))) { timedOut = true; break; }
    }
    if (timedOut) break;
    long const w = long(std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - t0).count());
    waits.push_back(w);
    worst = std::max(worst, w);
  }
  long const total = long(std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - start).count());
  auto const st = h.status();
  std::int64_t const wasted = st.total_redundant_bytes + st.total_failed_bytes;
  std::cout << "{\"mode\":\"" << mode << "\",\"stallCapMs\":" << envInt("VANTARA_LT_STALL_CAP_MS", 0)
            << ",\"crit\":" << envInt("BENCH_CRIT", 12) << ",\"ipt\":" << envInt("BENCH_IPT", 4) << ",\"seq\":" << envInt("BENCH_SEQ", 0) << ",\"tickMs\":" << envInt("BENCH_TICK_MS", 500) << ",\"pieceKb\":" << pieceKb
            << ",\"fastKbps\":" << fastKbps << ",\"slowKbps\":" << slowKbps
            << ",\"read\":" << waits.size() << ",\"timedOut\":" << (timedOut ? "true" : "false")
            << ",\"totalMs\":" << total << ",\"worstWaitMs\":" << worst
            << ",\"redundantBytes\":" << st.total_redundant_bytes << ",\"failedBytes\":" << st.total_failed_bytes
            << ",\"payloadBytes\":" << st.total_payload_download << ",\"waitsMs\":[";
  for (std::size_t i = 0; i < waits.size(); ++i) std::cout << (i ? "," : "") << waits[i];
  std::cout << "]}" << std::endl;
  (void)wasted;
  dl.remove_torrent(h);
  fs::remove_all(root);
  return timedOut ? 2 : 0;
}
