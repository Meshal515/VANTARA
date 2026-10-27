"""Real local BitTorrent regression suite, no copyrighted media/public swarm.

Run using the pinned official wheel: python -I server_test.py.
The private-peer exception exists only in Engine's test constructor; the shipped
CLI cannot enable it. No output is a measurement of public-swarm first-frame time.
"""
import base64
import concurrent.futures
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location("vantara_native_torrent", Path(__file__).with_name("server.py"))
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)
lt = backend.lt


def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class PolicyTests(unittest.TestCase):
    def test_public_192_0_peers_are_not_mistaken_for_private_networks(self):
        rules = backend.peer_ip_filter()
        for address in ("192.0.78.1", "192.0.79.1", "8.8.8.8", "2606:4700:4700::1111"):
            self.assertEqual(0, rules.access(address), address)
        for address in ("192.0.0.1", "192.0.2.1", "192.168.1.1", "127.0.0.1", "10.1.1.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"):
            self.assertNotEqual(0, rules.access(address), address)

    def test_current_piece_precedes_interleaved_readers_without_speculative_tail(self):
        w = backend.piece_window(0, 100000, 0, 1024, 7 * 1024)
        self.assertEqual(tuple(range(7, 71)), w)
        # 256 KiB torrent pieces now retain up to 16 MiB ahead of the reader.
        self.assertEqual(len(backend.piece_window(0, 256*1024*500, 0, 256*1024, 0)), 64)
        # Large pieces must NOT allocate an unbounded number of requests.
        self.assertEqual(len(backend.piece_window(0, 32*1024*1024*20, 0, 32*1024*1024, 0)), 1)
        deadlines = backend.deadlines([w, (90, 91, 92)])
        self.assertEqual(0, deadlines[7])
        self.assertEqual(0, deadlines[90])
        self.assertEqual(250, deadlines[8])
        self.assertEqual(750, deadlines[10])
        self.assertNotIn(97, deadlines)

    def test_magnets_allow_only_btih_and_public_trackers(self):
        h = "a" * 40
        self.assertEqual(h, backend.checked_magnet(f"magnet:?xt=urn:btih:{h}"))
        for extra in ("&xs=https://example.com/file.torrent", "&tr=http://127.0.0.1/a", "&tr=udp://localhost:3/a"):
            with self.assertRaises(ValueError):
                backend.checked_magnet(f"magnet:?xt=urn:btih:{h}{extra}")
        with self.assertRaises(ValueError):
            backend.checked_magnet(f"magnet:?xt=urn:btih:{h}&xt=urn:btih:{'b' * 40}")


class SwarmTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="vantara-legal-swarm-")
        cls.root = Path(cls.temp.name)
        cls.seed_root = cls.root / "seed"
        cls.seed_root.mkdir()
        # Different bytes at every position; random seeking cannot pass by
        # returning the first piece or a preallocated zero-filled file.
        cls.data = b"".join(hashlib.sha256(str(i).encode()).digest() for i in range(65536))
        (cls.seed_root / "owned-fixture.mp4").write_bytes(cls.data)
        fs = lt.file_storage()
        fs.add_file("owned-fixture.mp4", len(cls.data))
        torrent = lt.create_torrent(fs, 16 * 1024, lt.create_torrent.v1_only)
        lt.set_piece_hashes(torrent, str(cls.seed_root))
        cls.info = lt.torrent_info(torrent.generate())
        cls.magnet = f"magnet:?xt=urn:btih:{cls.info.info_hashes().v1}"
        cls.seed_port = port()
        cls.seeder = lt.session({"listen_interfaces": f"127.0.0.1:{cls.seed_port}",
            "enable_dht": False, "enable_lsd": False, "enable_upnp": False, "enable_natpmp": False,
            "allow_multiple_connections_per_ip": True, "seeding_outgoing_connections": False})
        params = lt.add_torrent_params()
        params.ti, params.save_path = cls.info, str(cls.seed_root)
        params.flags &= ~lt.torrent_flags.auto_managed
        params.flags &= ~lt.torrent_flags.paused
        cls.seed = cls.seeder.add_torrent(params)
        until = time.monotonic() + 10
        while not cls.seed.status().is_seeding:
            if time.monotonic() >= until:
                raise AssertionError("local seeder failed to check fixture")
            time.sleep(0.02)

    @classmethod
    def tearDownClass(cls):
        cls.seeder.pause()
        cls.seeder.remove_torrent(cls.seed)
        cls.temp.cleanup()

    def setUp(self):
        self.case = Path(tempfile.mkdtemp(dir=self.root))
        self.engine = backend.Engine(self.case / "download", self.case / "state", port(), _test_loopback=True)
        self.server = backend.Server(port(), self.engine, "vantara:" + "a" * 48)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.auth = "Basic " + base64.b64encode(("vantara:" + "a" * 48).encode()).decode()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.engine.close()

    def request(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=15)
        c.request(method, path, body=body, headers={"Authorization": self.auth, **(headers or {})})
        r = c.getresponse()
        status, response_headers, data = r.status, dict(r.getheaders()), r.read()
        c.close()
        return status, response_headers, data

    def add_with_peer(self, list_only=False):
        start = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            f = pool.submit(self.request, "POST", "/torrents?list_only=true" if list_only else "/torrents?only_files=0", self.magnet)
            end = time.monotonic() + 5
            while self.engine.handle is None and time.monotonic() < end:
                time.sleep(0.005)
            self.assertIsNotNone(self.engine.handle)
            self.engine.handle.connect_peer(("127.0.0.1", self.seed_port))
            result = f.result(timeout=15)
        self.assertEqual(200, result[0], result[2])
        return (time.monotonic() - start) * 1000

    def test_cold_metadata_then_verified_random_http_ranges_and_replay(self):
        metadata_ms = self.add_with_peer()
        first = time.monotonic()
        for start, end in [(0, 127), (len(self.data) - 32768, len(self.data) - 1), (750000, 751234), (0, 127)]:
            status, headers, payload = self.request("GET", "/torrents/0/stream/0", headers={"Range": f"bytes={start}-{end}"})
            self.assertEqual(206, status)
            self.assertEqual(self.data[start:end + 1], payload)
            self.assertEqual(f"bytes {start}-{end}/{len(self.data)}", headers["Content-Range"])
        self.assertLessEqual(self.engine.piece_bytes, backend.MEMORY_BYTES)
        stats = json.loads(self.request("GET", "/torrents/0/stats/v1")[2])
        self.assertEqual(0, stats["streaming"]["active_readers"])
        # Cache identity and bounds: info-only metadata, never source credentials.
        persisted = list((self.case / "state").glob("*.torrent"))
        self.assertEqual(1, len(persisted))
        self.assertEqual({b"info"}, set(lt.bdecode(persisted[0].read_bytes())))
        print(json.dumps({"fixture": "local-owned-bytes", "metadata_ms": round(metadata_ms, 2),
            "four_range_requests_ms": round((time.monotonic() - first) * 1000, 2),
            "first_frame": "not measured"}))

    def test_list_only_reuses_metadata_handle_and_warm_metadata_needs_no_peer(self):
        self.add_with_peer(list_only=True)
        handle = self.engine.handle
        result = self.request("POST", "/torrents?only_files=0", self.magnet)
        self.assertEqual(200, result[0])
        self.assertEqual(handle, self.engine.handle)
        self.engine.close()
        self.engine = backend.Engine(self.case / "warm", self.case / "state", port(), _test_loopback=True)
        self.server.engine = self.engine
        start = time.monotonic()
        result = self.request("POST", "/torrents?only_files=0", self.magnet)
        self.assertEqual(200, result[0], result[2])
        self.assertLess(time.monotonic() - start, 1)

    def test_ipc_auth_origin_file_selection_and_range_validation(self):
        self.assertEqual(401, self.request("GET", "/", headers={"Authorization": "Basic invalid"})[0])
        self.assertEqual(403, self.request("GET", "/", headers={"Origin": "https://evil.test"})[0])
        self.add_with_peer()
        self.assertEqual(400, self.request("POST", "/torrents?only_files=1", self.magnet)[0])
        self.assertEqual(400, self.request("GET", "/torrents/0/stream/1")[0])
        self.assertEqual(416, self.request("GET", "/torrents/0/stream/0", headers={"Range": "bytes=99999999-"})[0])
        self.assertEqual(400, self.request("GET", "/torrents/0/stream/0", headers={"Range": "bytes=0-2,5-7"})[0])

    def test_cancelled_reader_drops_only_its_piece_priorities(self):
        self.add_with_peer()
        read = self.engine.stream(0, 0, len(self.data) - 1, lambda: False)
        self.assertEqual(self.data[:16384], next(read))
        self.assertEqual(1, len(self.engine.readers))
        read.close()
        self.assertEqual({}, self.engine.readers)
        self.assertEqual({}, self.engine.priorities)

    def test_a_stalled_http_reader_releases_its_deadlines_on_disconnect(self):
        self.add_with_peer()
        self.engine.handle.pause()
        c = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        c.request("GET", "/torrents/0/stream/0", headers={"Authorization": self.auth, "Range": "bytes=1048576-1048703"})
        response = c.getresponse()
        self.assertEqual(206, response.status)
        until = time.monotonic() + 1
        while not self.engine.readers and time.monotonic() < until:
            time.sleep(0.01)
        self.assertTrue(self.engine.readers)
        c.sock.shutdown(socket.SHUT_RDWR)
        response.close()
        c.close()
        until = time.monotonic() + 1
        while time.monotonic() < until:
            # Cleanup removes the reader and calls libtorrent to reset all its
            # deadlines under this same lock. Those C++ calls release the GIL;
            # an unlocked test could observe half of that atomic transition.
            with self.engine.changed:
                if not self.engine.readers:
                    break
            time.sleep(0.01)
        with self.engine.changed:
            self.assertEqual({}, self.engine.readers)
            self.assertEqual({}, self.engine.priorities)

    def test_storage_reserve_stops_new_piece_requests_before_disk_exhaustion(self):
        self.add_with_peer()
        usage = type("Usage", (), {"free": backend.MIN_FREE - 1})()
        with patch.object(backend.shutil, "disk_usage", return_value=usage):
            read = self.engine.stream(0, 0, 127, lambda: False)
            with self.assertRaisesRegex(OSError, "storage reserve"):
                next(read)
        self.assertEqual({}, self.engine.readers)
        self.assertEqual({}, self.engine.priorities)

    def test_delete_waits_for_disk_ack_before_readding_the_same_path(self):
        self.add_with_peer()
        self.assertEqual(self.data[:128], self.request("GET", "/torrents/0/stream/0", headers={"Range": "bytes=0-127"})[2])
        metadata = next((self.case / "state").glob("*.torrent"))
        metadata_bytes = metadata.read_bytes()
        original = self.engine.session
        queued = threading.Event()
        old_handle = self.engine.handle

        class DelayedDeletion:
            def __getattr__(self, name):
                return getattr(original, name)

            def remove_torrent(self, *_):
                queued.set()  # Hold the real disk operation until the test releases it.

        self.engine.session = DelayedDeletion()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            deletion = pool.submit(self.request, "POST", "/torrents/0/delete", "")
            self.assertTrue(queued.wait(2))
            addition = pool.submit(self.request, "POST", "/torrents?only_files=0", self.magnet)
            time.sleep(0.1)
            self.assertFalse(deletion.done(), "delete must not acknowledge a queued operation")
            self.assertFalse(addition.done(), "add must wait until old files cannot be deleted later")
            original.remove_torrent(old_handle, lt.options_t.delete_files)
            self.assertEqual(200, deletion.result(timeout=5)[0])
            self.assertEqual(200, addition.result(timeout=5)[0])
        self.assertEqual(metadata_bytes, metadata.read_bytes(), "deleting stream data must preserve metadata")
        self.assertEqual(0, self.engine.piece_bytes)
        self.engine.handle.connect_peer(("127.0.0.1", self.seed_port))
        self.assertEqual(self.data[:128], self.request("GET", "/torrents/0/stream/0", headers={"Range": "bytes=0-127"})[2])

    def test_failed_metadata_replace_preserves_old_record_and_removes_its_temp_file(self):
        self.add_with_peer()
        metadata = next((self.case / "state").glob("*.torrent"))
        previous = metadata.read_bytes()
        with patch.object(backend.os, "replace", side_effect=OSError("owned fixture disk failure")):
            with self.assertRaises(OSError):
                self.engine._save_metadata()
        self.assertEqual(previous, metadata.read_bytes())
        self.assertEqual([], list((self.case / "state").glob("*.tmp")))

    def test_partial_unverified_blocks_are_excluded_from_checked_byte_diagnostics(self):
        self.add_with_peer()
        original = self.engine.handle
        length = self.engine.info.piece_length()
        snapshot = SimpleNamespace(download_payload_rate=1000, num_peers=1, list_peers=1,
            total_done=length + 4096, num_pieces=1,
            pieces=[True] + [False] * (self.engine.info.num_pieces() - 1))

        class PartialStatus:
            def status(self, flags):
                self.flags = flags
                return snapshot

            def __getattr__(self, key):
                return getattr(original, key)

        replacement = PartialStatus()
        try:
            self.engine.handle = replacement
            checked = self.engine.stats()["live"]["snapshot"]
            self.assertEqual(length, checked["downloaded_and_checked_bytes"])
            self.assertEqual(1, checked["downloaded_and_checked_pieces"])
            self.assertEqual(lt.status_flags_t.query_pieces, replacement.flags)
        finally:
            self.engine.handle = original


if __name__ == "__main__":
    unittest.main(verbosity=2)
