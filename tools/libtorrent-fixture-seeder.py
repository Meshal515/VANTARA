"""Authored-fixture loopback seeder for cross-engine benchmarks; never shipped."""
import argparse
import json
from pathlib import Path
import time
import libtorrent as lt

parser = argparse.ArgumentParser()
parser.add_argument("--seed-dir", required=True)
parser.add_argument("--manifest", required=True)
parser.add_argument("--ready", required=True)
parser.add_argument("--listen-port", type=int, required=True)
args = parser.parse_args()
manifest = json.loads(Path(args.manifest).read_text())
session = lt.session({"listen_interfaces": f"127.0.0.1:{args.listen_port}", "enable_dht": False,
    "enable_lsd": False, "enable_upnp": False, "enable_natpmp": False,
    "close_redundant_connections": False, "allow_multiple_connections_per_ip": True,
    "seeding_outgoing_connections": False})
handles = []
for torrent in manifest:
    params = lt.add_torrent_params()
    params.ti = lt.torrent_info(torrent)
    params.save_path = args.seed_dir
    params.flags &= ~lt.torrent_flags.auto_managed
    params.flags &= ~lt.torrent_flags.paused
    handles.append(session.add_torrent(params))
until = time.monotonic() + 30
while not all(h.status().is_seeding for h in handles):
    if time.monotonic() > until:
        raise SystemExit("fixture seeder did not verify all files")
    time.sleep(0.025)
Path(args.ready).write_text("verified")
while True:
    time.sleep(1)
