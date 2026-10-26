"""Test-only loopback peer adapter. This file is never included in the app.

Mirrors torrent-startup-benchmark.mjs's rqbit adapter: discovery is disabled and
only the authored local seeder is injected. Production server.py has no CLI flag
to allow private peers or to inject a peer.
"""
import argparse
import importlib.util
import os
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument("--api-port", type=int, required=True)
parser.add_argument("--listen-port", type=int, required=True)
parser.add_argument("--download-dir", required=True)
parser.add_argument("--state-dir", required=True)
parser.add_argument("--backend-script", required=True)
parser.add_argument("--fixture-peer", type=int, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("vantara_fixture_backend", args.backend_script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
engine = module.Engine(args.download_dir, args.state_dir, args.listen_port, _test_loopback=True)
server = module.Server(args.api_port, engine, os.environ["RQBIT_HTTP_BASIC_AUTH_USERPASS"])


def inject_owned_peer():
    previous = None
    while not engine.closed.wait(0.01):
        handle = engine.handle
        if handle is not None and handle != previous:
            handle.connect_peer(("127.0.0.1", args.fixture_peer))
            previous = handle


threading.Thread(target=inject_owned_peer, daemon=True).start()
try:
    server.serve_forever(poll_interval=0.1)
finally:
    server.server_close()
    engine.close()
