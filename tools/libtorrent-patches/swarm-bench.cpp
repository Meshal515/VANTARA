// بناء: g++ -std=c++17 -O2 -DTORRENT_USE_OPENSSL ... swarm-bench.cpp libtorrent-rasterbar.a -lssl -lcrypto -lpthread
// تشغيل: python3 swarm-proxy.py 53000 52000 40 & ثم VANTARA_LT_STALL_CAP_MS=1000 VANTARA_LT_HEDGE_MS=750 SW_WARM_MS=1500 SW_FOCUS=1 ./swarm-bench
// سرب واقعي: N مشاركين بسرعات وأزمنة رحلة متفاوتة (عبر proxy.py)، وتسلسل بدء التطبيق كما هو:
// تسخين (24 اتصالًا، القطعة 0 + الذيل) ← ضغط (بلا حد، تسلسلي، نافذة 12 بموعدين) ← القطعة 0 ← قفزة المرفقات ← القطعة SKIP
#include <libtorrent/session.hpp>
#include <libtorrent/session_params.hpp>
#include <libtorrent/settings_pack.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/ip_filter.hpp>
#include <libtorrent/peer_info.hpp>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <set>
#include <string>
#include <thread>
#include <vector>
namespace lt = libtorrent; namespace fs = std::filesystem; using clk = std::chrono::steady_clock;
static int env(char const* n, int d) { char const* v = std::getenv(n); return (v && *v) ? std::atoi(v) : d; }
static lt::settings_pack base(int port) {
  lt::settings_pack s;
  s.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:" + std::to_string(port));
  s.set_bool(lt::settings_pack::enable_dht, false); s.set_bool(lt::settings_pack::enable_lsd, false);
  s.set_bool(lt::settings_pack::enable_upnp, false); s.set_bool(lt::settings_pack::enable_natpmp, false);
  s.set_bool(lt::settings_pack::allow_multiple_connections_per_ip, true);
  s.set_bool(lt::settings_pack::enable_outgoing_utp, false); s.set_bool(lt::settings_pack::enable_incoming_utp, false);
  s.set_int(lt::settings_pack::alert_mask, 0);
  return s;
}
int main() {
  int const N = env("SW_PEERS", 40), pieceKb = env("SW_PIECE_KB", 1024), pieces = env("SW_PIECES", 64);
  int const warmMs = env("SW_WARM_MS", 1500), skipTo = env("SW_SKIP", 3), P = env("SW_PORT", 52000), Q = env("SW_QPORT", 53000);
  int const crit = env("SW_CRIT", 2), win = env("SW_WIN", 12);
  fs::path const root = fs::temp_directory_path() / ("swarm-" + std::to_string(P));
  fs::remove_all(root); fs::create_directories(root / "seed");
  std::int64_t const size = std::int64_t(pieceKb) * 1024 * pieces;
  { std::ofstream f(root / "seed" / "v.mkv", std::ios::binary); std::mt19937_64 rng(7); std::vector<std::uint64_t> b(1 << 16);
    for (std::int64_t d = 0; d < size; d += std::int64_t(b.size() * 8)) { for (auto& x : b) x = rng(); f.write((char const*)b.data(), std::min<std::int64_t>(b.size() * 8, size - d)); } }
  lt::file_storage fsto; lt::add_files(fsto, (root / "seed" / "v.mkv").string());
  lt::create_torrent ct(fsto, pieceKb * 1024, lt::create_torrent::v1_only); lt::set_piece_hashes(ct, (root / "seed").string());
  std::vector<char> tb; lt::bencode(std::back_inserter(tb), ct.generate());
  auto const ti = std::make_shared<lt::torrent_info>(tb, lt::from_span);
  // سرعات الرفع: ربع سريع، نصف متوسط، ربع بطيء جدًا (مجموعها ≈ 6MB/s ≈ 49Mbps كعيّنة الجهاز)
  auto rate = [&](int i) { int m = i % 4; return m == 0 ? env("SW_FAST", 400) : m == 3 ? env("SW_SLOW", 15) : env("SW_MID", 100); };
  std::vector<std::unique_ptr<lt::session>> seeds;
  for (int i = 0; i < N; ++i) {
    auto s = base(P + i); s.set_int(lt::settings_pack::unchoke_slots_limit, -1);
    auto ses = std::make_unique<lt::session>(lt::session_params(s));
    lt::ip_filter all; all.add_rule(lt::make_address("0.0.0.0"), lt::make_address("255.255.255.255"), 1u << static_cast<std::uint32_t>(lt::session::global_peer_class_id));
    ses->set_peer_class_filter(all);
    auto pc = ses->get_peer_class(lt::session::global_peer_class_id); pc.upload_limit = rate(i) * 1024; ses->set_peer_class(lt::session::global_peer_class_id, pc);
    lt::add_torrent_params p; p.ti = ti; p.save_path = (root / "seed").string(); p.flags |= lt::torrent_flags::seed_mode; ses->add_torrent(p);
    seeds.push_back(std::move(ses));
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(800));
  // المنزِّل: إعدادات الإنتاج (TorrentEngine.streamingSettings + H)
  auto s = base(P - 1);
  s.set_int(lt::settings_pack::connections_limit, 400); s.set_int(lt::settings_pack::max_queued_disk_bytes, 8 << 20);
  s.set_bool(lt::settings_pack::strict_end_game_mode, false); s.set_bool(lt::settings_pack::close_redundant_connections, false);
  s.set_int(lt::settings_pack::connection_speed, 200); s.set_int(lt::settings_pack::torrent_connect_boost, 100);
  s.set_int(lt::settings_pack::peer_connect_timeout, 3); s.set_int(lt::settings_pack::handshake_timeout, 15);
  s.set_int(lt::settings_pack::request_timeout, 4); s.set_int(lt::settings_pack::piece_timeout, 8);
  s.set_int(lt::settings_pack::max_out_request_queue, env("SW_MAXQ", 250)); s.set_int(lt::settings_pack::request_queue_time, env("SW_RQT", 1));
  s.set_int(lt::settings_pack::whole_pieces_threshold, 0); s.set_bool(lt::settings_pack::piece_extent_affinity, false);
  s.set_int(lt::settings_pack::tick_interval, env("SW_TICK", 100)); s.set_int(lt::settings_pack::initial_picker_threshold, 0);
  lt::session dl{lt::session_params(s)};
  lt::add_torrent_params p; p.ti = ti; p.save_path = (root / "dl").string();
  p.flags &= ~lt::torrent_flags::auto_managed; p.flags &= ~lt::torrent_flags::paused;
  p.piece_priorities.assign(std::size_t(pieces), lt::dont_download);
  auto h = dl.add_torrent(p);
  int const last = pieces - 1;
  std::set<int> dead;
  auto dl7 = [&](int pc, int d) { h.piece_priority(lt::piece_index_t(pc), d == 0 ? lt::top_priority : lt::download_priority_t(6)); h.set_piece_deadline(lt::piece_index_t(pc), d); dead.insert(pc); };
  auto const t0 = clk::now();
  auto ms = [&] { return long(std::chrono::duration_cast<std::chrono::milliseconds>(clk::now() - t0).count()); };
  auto connect = [&] { for (int i = 0; i < N; ++i) h.connect_peer({lt::make_address("127.0.0.1"), std::uint16_t(Q + i)}); };
  std::vector<long> doneAt(pieces, -1);
  auto poll = [&] { for (int i = 0; i < pieces; ++i) if (doneAt[i] < 0 && h.have_piece(lt::piece_index_t(i))) doneAt[i] = ms(); };
  long tap = 0;
  if (warmMs >= 0) {
    // التسخين (prefetched): 24 اتصالًا، القطعة 0 فورًا والذيل بعدها
    h.set_max_connections(24); dl7(0, 0); dl7(last - 1, 250); dl7(last, 500); connect();
    while (ms() < warmMs) { poll(); std::this_thread::sleep_for(std::chrono::milliseconds(10)); }
    tap = ms();
  } else connect();
  // الضغط (acquire + select + prioritize عند 0)
  h.set_max_connections(-1); h.set_flags(lt::torrent_flags::sequential_download);
  auto prioritize = [&](int first, bool focus) {
    int const w = focus ? crit : win;
    std::vector<int> next; for (int k = first; k < std::min(pieces, first + w); ++k) next.push_back(k);
    for (int k = first + w; k < std::min(pieces, first + win); ++k) h.piece_priority(lt::piece_index_t(k), lt::dont_download);
    std::vector<std::pair<int,int>> wanted; std::set<int> seen;
    wanted.push_back({next[0], 0}); seen.insert(next[0]);
    for (int e : {last - 1, last}) if (!h.have_piece(lt::piece_index_t(e)) && seen.insert(e).second) wanted.push_back({e, 250 * int(wanted.size())});
    int const b = 250 * int(wanted.size());
    for (int i = 1; i < crit && i < (int)next.size(); ++i) if (seen.insert(next[i]).second) wanted.push_back({next[i], b + (i - 1 < 3 ? (i - 1) * 250 : 750 + (i - 3) * 750)});
    std::set<int> keep; for (auto& w : wanted) keep.insert(w.first);
    for (int pc : dead) if (!keep.count(pc)) h.reset_piece_deadline(lt::piece_index_t(pc));
    for (int pc = 0; pc < first; ++pc) h.piece_priority(lt::piece_index_t(pc), lt::dont_download);
    for (auto& [pc, d] : wanted) if (!dead.count(pc) || d == 0) dl7(pc, d);
    dead = keep;
    for (int pc : next) if (!keep.count(pc)) h.piece_priority(lt::piece_index_t(pc), lt::download_priority_t(6));
  };
  bool const F = env("SW_FOCUS", 0) > 0;
  prioritize(0, F);
  long traced = -1000;
  auto trace = [&](int pc) {
    if (!env("SW_TRACE", 0) || ms() - traced < 200) return; traced = ms();
    std::vector<lt::partial_piece_info> q; h.get_download_queue(q);
    int fin = -1, req = -1, wr = -1; for (auto& x : q) if (x.piece_index == lt::piece_index_t(pc)) { fin = x.finished; req = x.requested; wr = x.writing; }
    std::vector<lt::peer_info> peers; h.get_peer_info(peers);
    int unchoked = 0, withReq = 0, outstanding = 0, measured = 0;
    for (auto& pi : peers) { if (!(pi.flags & lt::peer_info::remote_choked)) ++unchoked; if (pi.download_queue_length > 0) ++withReq; outstanding += pi.download_queue_length; if (pi.payload_down_speed > 0) ++measured; }
    auto st = h.status();
    std::cerr << ms() - tap << "ms p" << pc << " fin=" << fin << " req=" << req << " wr=" << wr << " peers=" << peers.size() << " unchoked=" << unchoked << " withReq=" << withReq << " outReq=" << outstanding << " measured=" << measured << " rate=" << st.download_payload_rate / 1024 << "KB/s dlq=" << q.size() << "\n";
  };
  auto waitFor = [&](int pc) { while (!h.have_piece(lt::piece_index_t(pc))) { poll(); trace(pc); if (ms() - tap > 60000) return -1L; std::this_thread::sleep_for(std::chrono::milliseconds(5)); } poll(); return ms() - tap; };
  long const p0 = waitFor(0);
  if (F) prioritize(0, false);
  prioritize(skipTo, F);
  long const pS = waitFor(skipTo);
  if (F) prioritize(skipTo, false); long const pS1 = waitFor(skipTo + 1);
  auto st = h.status();
  std::cout << "{\"warmMs\":" << warmMs << ",\"crit\":" << crit << ",\"win\":" << win << ",\"pieceKb\":" << pieceKb << ",\"p0\":" << p0 << ",\"pSkip\":" << pS << ",\"pSkip1\":" << pS1
            << ",\"warmDone0\":" << (doneAt[0] >= 0 && doneAt[0] <= tap ? doneAt[0] : -1) << ",\"peers\":" << st.num_peers
            << ",\"payloadKB\":" << (st.total_payload_download >> 10) << ",\"redundantKB\":" << (st.total_redundant_bytes >> 10) << ",\"done\":[";
  for (int i = 0; i < std::min(pieces, 16); ++i) std::cout << (i ? "," : "") << (doneAt[i] < 0 ? -1 : doneAt[i] - tap);
  std::cout << "]}" << std::endl;
  std::_Exit(0);
}
