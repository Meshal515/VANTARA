"""Optional Windows streaming backend using the same libtorrent 2.0 family as APK.

The IPC surface deliberately matches the small rqbit subset used by services.mjs.
This is not an addon HTTP proxy. Only authenticated loopback requests and validated
BTIH magnets are accepted. read_piece_alert is the sole source of stream bytes:
preallocated/unverified disk data can never be returned as video.
"""
import argparse
import base64
from collections import OrderedDict
import hmac
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import select
import shutil
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import libtorrent as lt

MIB = 1024 * 1024
MAX_METADATA = 8 * MIB
MAX_PIECES = 1_000_000
MAX_PIECE_BYTES = 32 * MIB
MEMORY_BYTES = 64 * MIB
WINDOW_PIECES = 12
MIN_FREE = 512 * MIB
METADATA_TTL = 7 * 86400
MAX_METADATA_FILES = 32


def checked_magnet(text):
    if not isinstance(text, str) or len(text) > 16000 or re.search(r"[\x00-\x20\x7f]", text):
        raise ValueError("invalid magnet")
    uri = urlsplit(text)
    query = parse_qs(uri.query, keep_blank_values=True)
    xt = query.get("xt", [])
    if uri.scheme != "magnet" or uri.netloc or uri.path or uri.fragment or set(query) - {"xt", "tr", "dn"}:
        raise ValueError("invalid magnet")
    if len(xt) != 1 or not re.fullmatch(r"urn:btih:[a-fA-F0-9]{40}", xt[0]):
        raise ValueError("invalid BTIH")
    if len(query.get("tr", [])) > 48:
        raise ValueError("too many trackers")
    for tracker in query.get("tr", []):
        u = urlsplit(tracker)
        host = (u.hostname or "").lower()
        if (len(tracker) > 2000 or re.search(r"[\x00-\x20\x7f]", tracker) or
                u.scheme not in ("udp", "https", "http") or u.username or u.password or
                host == "localhost" or host.endswith((".localhost", ".local")) or
                "." not in host and ":" not in host):
            raise ValueError("invalid tracker")
        try:
            if not ipaddress.ip_address(host).is_global:
                raise ValueError("private tracker")
        except ValueError as error:
            if str(error) == "private tracker":
                raise
            # Hostnames are also filtered after resolution by libtorrent's IP filter.
            if re.fullmatch(r"[\d.]+", host):
                raise ValueError("invalid tracker address")
    return xt[0][9:].lower()


def piece_window(index, file_length, file_offset, piece_length, position):
    if not (0 <= position < file_length) or piece_length <= 0:
        raise ValueError("invalid read position")
    first = (file_offset + position) // piece_length
    last = (file_offset + file_length - 1) // piece_length
    return tuple(range(first, min(first + WINDOW_PIECES, last + 1)))


def deadlines(windows):
    """Every active reader's current piece wins, then interleave its lookahead.

    Unlike resetting all deadlines on every read, retaining the existing ones
    preserves requests already in flight (Android TorrentPolicy's fixed mode).
    No speculative tail download competes with the extractor's current read.
    """
    result = {}
    for window in windows:
        for distance, piece in enumerate(window):
            delay = 0 if distance == 0 else distance * 250 if distance < 4 else 750 + (distance - 3) * 750
            result[piece] = min(delay, result.get(piece, delay))
    return result


def safe_files(info):
    files = info.files()
    if (info.num_pieces() > MAX_PIECES or info.piece_length() > MAX_PIECE_BYTES or
            files.num_files() > 100000 or not info.num_pieces() or not files.num_files()):
        raise ValueError("torrent metadata exceeds limits")
    result = []
    for i in range(files.num_files()):
        name = files.file_path(i)
        parts = PurePosixPath(name).parts
        if (not parts or name.startswith("/") or "\\" in name or ":" in name or
                any(p in ("", ".", "..") or re.search(r"[\x00-\x1f]", p) for p in parts) or
                files.file_flags(i) & lt.file_storage.flag_symlink):
            raise ValueError("unsafe torrent file path")
        result.append({"name": name, "components": list(parts), "length": files.file_size(i)})
    return result


class Engine:
    def __init__(self, root, state_dir, listen_port, *, _test_loopback=False):
        self.root = Path(root).resolve()
        self.state_dir = Path(state_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.closed = threading.Event()
        self.add_lock = threading.Lock()
        self.handle = None
        self.info = None
        self.hash = None
        self.index = None
        self.files = None
        self.readers = {}
        self.priorities = {}
        self.pieces = OrderedDict()
        self.piece_bytes = 0
        self.pending = set()
        self.error = None
        self.first_useful_piece_at = None
        self.started_at = time.monotonic()
        settings = {
            "listen_interfaces": f"0.0.0.0:{listen_port}",
            "enable_lsd": False, "enable_upnp": False, "enable_natpmp": False,
            "connections_limit": 400, "active_downloads": 2, "active_seeds": 0, "active_limit": 2,
            "max_peerlist_size": 1000, "max_queued_disk_bytes": 8 * MIB,
            "validate_https_trackers": True, "stop_tracker_timeout": 1,
            "ssrf_mitigation": True, "apply_ip_filter_to_trackers": True,
            "announce_to_all_trackers": True, "announce_to_all_tiers": True,
            "strict_end_game_mode": False, "close_redundant_connections": False,
            "connection_speed": 200, "torrent_connect_boost": 100,
            "peer_connect_timeout": 15, "handshake_timeout": 15,
            "tracker_receive_timeout": 6, "tracker_completion_timeout": 15,
            "request_timeout": 4, "piece_timeout": 8, "max_out_request_queue": 250,
            "request_queue_time": 1, "whole_pieces_threshold": 0, "piece_extent_affinity": False,
            "alert_mask": int(lt.alert.category_t.error_notification | lt.alert.category_t.storage_notification |
                              lt.alert.category_t.status_notification),
        }
        if _test_loopback:
            settings.update(enable_dht=False, listen_interfaces=f"127.0.0.1:{listen_port}")
        self.session = lt.session(settings)
        ip_filter = lt.ip_filter()
        if not _test_loopback:
            # Match Android's deny rules, including DNS-resolved trackers/peers.
            for start, end in [
                ("0.0.0.0", "0.255.255.255"), ("10.0.0.0", "10.255.255.255"),
                ("100.64.0.0", "100.127.255.255"), ("127.0.0.0", "127.255.255.255"),
                ("169.254.0.0", "169.254.255.255"), ("172.16.0.0", "172.31.255.255"),
                ("192.0.0.0", "192.0.255.255"), ("192.168.0.0", "192.168.255.255"),
                ("198.18.0.0", "198.19.255.255"), ("224.0.0.0", "255.255.255.255"),
                ("::", "1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
                ("4000::", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
                ("2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"),
                ("2002::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
            ]:
                ip_filter.add_rule(start, end, 1)
        self.session.set_ip_filter(ip_filter)
        state_file = self.state_dir / "dht.state"
        try:
            if state_file.stat().st_size <= 512 * 1024:
                self.session.load_state(lt.bdecode(state_file.read_bytes()), lt.save_state_flags_t.save_dht_state)
        except (OSError, RuntimeError):
            pass
        self.thread = threading.Thread(target=self._alerts, daemon=True)
        self.thread.start()

    def _alerts(self):
        while not self.closed.wait(0.025):
            for alert in self.session.pop_alerts():
                with self.changed:
                    if isinstance(alert, lt.read_piece_alert) and alert.handle == self.handle:
                        self.pending.discard(alert.piece)
                        if alert.error.value() == 0:
                            data = bytes(alert.buffer)
                            if alert.piece not in self.pieces:
                                self.pieces[alert.piece] = data
                                self.piece_bytes += len(data)
                            while self.piece_bytes > MEMORY_BYTES and self.pieces:
                                _, previous = self.pieces.popitem(last=False)
                                self.piece_bytes -= len(previous)
                        else:
                            self.error = "verified piece read failed"
                    elif isinstance(alert, (lt.torrent_error_alert, lt.file_error_alert)):
                        self.error = "torrent storage or engine error"
                    self.changed.notify_all()

    def _metadata_path(self, info_hash):
        return self.state_dir / f"{info_hash}.torrent"

    def _save_metadata(self):
        # Only info is persisted: no credentials, trackers, paths or user profile data.
        blob = lt.bencode({b"info": lt.bdecode(self.info.metadata())})
        if len(blob) > MAX_METADATA:
            return
        target = self._metadata_path(self.hash)
        temp = target.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        temp.write_bytes(blob)
        os.replace(temp, target)
        entries = sorted(self.state_dir.glob("*.torrent"), key=lambda p: p.stat().st_mtime, reverse=True)
        for i, entry in enumerate(entries):
            if i >= MAX_METADATA_FILES or time.time() - entry.stat().st_mtime > METADATA_TTL:
                entry.unlink(missing_ok=True)

    def add(self, magnet, index=None, list_only=False):
        info_hash = checked_magnet(magnet)
        if index is not None and (type(index) is not int or index < 0):
            raise ValueError("invalid file index")
        with self.add_lock:
            if self.hash and self.hash != info_hash:
                raise ValueError("one torrent per playback session")
            if self.handle is None:
                params = lt.parse_magnet_uri(magnet)
                params.save_path = str(self.root)
                # Metadata-only until identity, paths, selected file and disk budget pass.
                params.flags |= lt.torrent_flags.default_dont_download
                params.flags &= ~lt.torrent_flags.auto_managed
                params.flags &= ~lt.torrent_flags.paused
                cached = self._metadata_path(info_hash)
                try:
                    if cached.stat().st_size <= MAX_METADATA and time.time() - cached.stat().st_mtime <= METADATA_TTL:
                        candidate = lt.torrent_info(str(cached))
                        if str(candidate.info_hashes().v1) == info_hash:
                            safe_files(candidate)
                            params.ti = candidate
                except (OSError, RuntimeError, ValueError):
                    pass
                self.handle = self.session.add_torrent(params)
                self.hash = info_hash
            end = time.monotonic() + 45
            while not self.handle.has_metadata():
                if self.closed.wait(0.025):
                    raise TimeoutError("session closed")
                if self.error or time.monotonic() >= end:
                    raise TimeoutError("metadata unavailable")
            self.info = self.handle.torrent_file()
            if str(self.info.info_hashes().v1) != info_hash:
                raise ValueError("torrent identity mismatch")
            self.files = safe_files(self.info)
            try:
                self._save_metadata()
            except OSError:
                pass  # A warm-cache write failure never blocks a valid live torrent.
            if index is not None and index >= len(self.files):
                raise ValueError("invalid file index")
            if not list_only:
                if index is None:
                    raise ValueError("selected file required")
                if self.index is not None and self.index != index:
                    raise ValueError("file selection cannot change")
                if shutil.disk_usage(self.root).free < MIN_FREE:
                    raise ValueError("insufficient free storage")
                self.index = index
                # Keep every file ignored; demand activates only verified file pieces.
                self.handle.prioritize_files([0] * len(self.files))
            return self.details()

    def details(self):
        return {"id": 0, "details": {"info_hash": self.hash, "files": self.files,
                "total_pieces": self.info.num_pieces(), "piece_length": self.info.piece_length(),
                "output_folder": str(self.root)}, "seen_peers": []}

    def _prioritize(self):
        desired = deadlines(self.readers.values())
        for piece in self.priorities.keys() - desired.keys():
            self.handle.reset_piece_deadline(piece)
            self.handle.piece_priority(piece, 0)
        for piece, delay in desired.items():
            if self.handle.have_piece(piece):
                continue
            self.handle.piece_priority(piece, 7 if delay == 0 else 6)
            if self.priorities.get(piece) != delay:
                self.handle.set_piece_deadline(piece, delay)
        self.priorities = desired

    def read_piece(self, reader, piece, cancelled):
        end = time.monotonic() + 45
        with self.changed:
            while True:
                if self.closed.is_set() or cancelled() or reader not in self.readers:
                    raise ConnectionAbortedError("reader cancelled")
                if self.error:
                    raise OSError(self.error)
                if piece in self.pieces:
                    data = self.pieces[piece]
                    self.pieces.move_to_end(piece)
                    self.first_useful_piece_at = self.first_useful_piece_at or time.monotonic()
                    return data
                if self.handle.have_piece(piece) and piece not in self.pending:
                    self.pending.add(piece)
                    self.handle.read_piece(piece)
                if time.monotonic() >= end:
                    raise TimeoutError("requested piece unavailable")
                self.changed.wait(0.05)

    def stream(self, index, start, end, cancelled):
        if index != self.index:
            raise ValueError("unselected file")
        file_length = self.files[index]["length"]
        if not (0 <= start <= end < file_length):
            raise ValueError("invalid range")
        reader = object()
        storage = self.info.files()
        offset, length = storage.file_offset(index), self.info.piece_length()
        try:
            while start <= end:
                if shutil.disk_usage(self.root).free < MIN_FREE:
                    raise OSError("storage reserve reached")
                window = piece_window(index, file_length, offset, length, start)
                with self.changed:
                    self.readers[reader] = window
                    self._prioritize()
                piece = window[0]
                data = self.read_piece(reader, piece, cancelled)
                within = offset + start - piece * length
                chunk = data[within:within + min(len(data) - within, end - start + 1)]
                if not chunk:
                    raise OSError("empty verified piece")
                yield chunk
                start += len(chunk)
        finally:
            with self.changed:
                self.readers.pop(reader, None)
                if self.handle and self.handle.is_valid():
                    self._prioritize()

    def stats(self):
        s = self.handle.status()
        with self.lock:
            requested = [w[0] for w in self.readers.values() if w]
            return {"live": {"download_speed": {"mbps": s.download_payload_rate / MIB},
                "snapshot": {"peer_stats": {"live": s.num_peers, "seen": s.list_peers},
                    "downloaded_and_checked_bytes": s.total_done,
                    "downloaded_and_checked_pieces": s.num_pieces}},
                "streaming": {"requested_pieces": requested, "piece_length": self.info.piece_length(),
                    "verified_memory_bytes": self.piece_bytes, "active_readers": len(self.readers),
                    "requested_piece_ready": all(self.handle.have_piece(p) for p in requested)}}

    def haves(self):
        pieces = self.handle.status(lt.status_flags_t.query_pieces).pieces
        bits = bytearray((len(pieces) + 7) // 8)
        for i, available in enumerate(pieces):
            if available:
                bits[i // 8] |= 1 << (7 - i % 8)
        return bytes(bits)

    def close(self):
        self.closed.set()
        with self.changed:
            self.changed.notify_all()
        self.thread.join(timeout=2)
        try:
            blob = lt.bencode(self.session.save_state(lt.save_state_flags_t.save_dht_state))
            if len(blob) <= 512 * 1024:
                temp = self.state_dir / "dht.tmp"
                temp.write_bytes(blob)
                os.replace(temp, self.state_dir / "dht.state")
        except (RuntimeError, OSError):
            pass
        self.session.pause()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, port, engine, auth):
        super().__init__(("127.0.0.1", port), Handler)
        self.engine = engine
        self.auth = "Basic " + base64.b64encode(auth.encode("ascii")).decode("ascii")
        self.slots = threading.BoundedSemaphore(8)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "VANTARA-Torrent"
    sys_version = ""

    def log_message(self, *_):
        pass  # Magnets, tracker URLs and Authorization never enter logs.

    def response(self, status, data, content_type="application/json"):
        if not isinstance(data, bytes):
            data = json.dumps(data).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def disconnected(self):
        try:
            if select.select([self.connection], [], [], 0)[0]:
                return self.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True
        return False

    def dispatch(self):
        self.connection.settimeout(5)
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode("latin1"), self.server.auth.encode("ascii")):
            self.close_connection = True
            return self.response(401, {"error": "unauthorized"})
        if self.headers.get("Origin") or self.headers.get("Host") not in (
                f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
            self.close_connection = True
            return self.response(403, {"error": "invalid IPC origin"})
        if not self.server.slots.acquire(blocking=False):
            return self.response(429, {"error": "reader limit"})
        stream_started = False
        try:
            uri = urlsplit(self.path)
            query = parse_qs(uri.query, keep_blank_values=True)
            engine = self.server.engine
            if self.command == "GET" and uri.path == "/":
                return self.response(200, {"engine": "libtorrent", "version": lt.__version__, "api": 1})
            if self.command == "POST" and uri.path == "/torrents":
                if self.headers.get("Transfer-Encoding"):
                    raise ValueError("chunked requests not accepted")
                count = int(self.headers.get("Content-Length", "0"))
                if not 1 <= count <= 16000 or set(query) - {"list_only", "only_files", "overwrite", "initial_peers"}:
                    raise ValueError("invalid torrent request")
                # Explicit peers are intentionally not accepted from untrusted IPC.
                if query.get("initial_peers"):
                    raise ValueError("explicit peers not supported")
                text = self.rfile.read(count).decode("utf8")
                index = int(query["only_files"][0]) if "only_files" in query else None
                return self.response(200, engine.add(text, index, query.get("list_only") == ["true"]))
            route = re.fullmatch(r"/torrents/0/(stats/v1|haves|pause|start|delete|stream/(\d+))", uri.path)
            if not route or engine.handle is None or engine.info is None:
                return self.response(404, {"error": "unknown torrent"})
            action = route[1]
            if self.command == "GET" and action == "stats/v1":
                return self.response(200, engine.stats())
            if self.command == "GET" and action == "haves":
                return self.response(200, engine.haves(), "application/octet-stream")
            if self.command == "POST" and action in ("pause", "start"):
                if action == "pause":
                    engine.handle.pause()
                else:
                    engine.handle.resume()
                return self.response(200, {})
            if self.command == "POST" and action == "delete":
                # Session teardown owns directory deletion; do not follow HTTP paths.
                engine.session.remove_torrent(engine.handle, lt.options_t.delete_files)
                engine.handle = engine.info = engine.hash = engine.index = None
                engine.pieces.clear()
                engine.piece_bytes = 0
                engine.priorities.clear()
                return self.response(200, {})
            if self.command not in ("GET", "HEAD") or not action.startswith("stream/"):
                return self.response(405, {"error": "method not allowed"})
            index = int(route[2])
            if index != engine.index:
                raise ValueError("unselected file")
            length = engine.files[index]["length"]
            start, end = 0, length - 1
            value = self.headers.get("Range")
            if value:
                match = re.fullmatch(r"bytes=(\d+)-(\d*)", value)
                if not match:
                    raise ValueError("invalid range")
                start = int(match[1])
                end = min(int(match[2]), length - 1) if match[2] else length - 1
            if not 0 <= start <= end < length:
                return self.response(416, {"error": "range outside file"})
            self.send_response(206 if value else 200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            if value:
                self.send_header("Content-Range", f"bytes {start}-{end}/{length}")
            self.end_headers()
            stream_started = True
            if self.command == "HEAD":
                return
            for chunk in engine.stream(index, start, end, self.disconnected):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (ValueError, UnicodeError) as error:
            if not stream_started:
                self.response(400, {"error": "invalid torrent request"})
        except (TimeoutError, OSError, RuntimeError):
            if not stream_started:
                self.response(503, {"error": "torrent temporarily unavailable"})
            self.close_connection = True
        finally:
            self.server.slots.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-port", type=int, required=True)
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--download-dir", required=True)
    parser.add_argument("--state-dir", required=True)
    args = parser.parse_args()
    auth = os.environ.get("RQBIT_HTTP_BASIC_AUTH_USERPASS", "")
    if not re.fullmatch(r"vantara:[a-f0-9]{48}", auth):
        raise SystemExit("missing private IPC credential")
    if not all(1 <= p <= 65535 for p in (args.api_port, args.listen_port)) or args.api_port == args.listen_port:
        raise SystemExit("invalid ports")
    engine = Engine(args.download_dir, args.state_dir, args.listen_port)
    server = Server(args.api_port, engine, auth)
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        engine.close()


if __name__ == "__main__":
    main()
