import json
import pathlib
import subprocess
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import probe_links as p  # noqa: E402


class Result:
    def __init__(self, stdout="", code=0, stderr=""):
        self.stdout, self.returncode, self.stderr = stdout, code, stderr


class ProbeLinksTest(unittest.TestCase):
    link = {"url": "https://cdn.test/v.m3u8", "referer": "https://embed.test/e/1", "type": "M3U8",
            "headers": {"User-Agent": "UA", "Origin": "https://embed.test"}, "at": 0}

    def test_engine_headers_are_passed_exactly(self):
        cmd = p.probe_cmd(self.link)
        self.assertIn("UA", cmd[cmd.index("-user_agent") + 1])
        headers = cmd[cmd.index("-headers") + 1]
        self.assertIn("Referer: https://embed.test/e/1\r\n", headers)
        self.assertIn("Origin: https://embed.test\r\n", headers)
        self.assertEqual(cmd[-1], self.link["url"])

    def test_works_only_with_a_decoded_video_frame(self):
        frame = json.dumps({"frames": [{"pict_type": "I"}], "format": {"duration": "1420.0"}})
        self.assertEqual(p.probe(self.link, run=lambda *a, **k: Result(frame))["ok"], True)
        self.assertEqual(p.probe(self.link, run=lambda *a, **k: Result(json.dumps({"format": {}})))["reason"], "no video frame")
        self.assertFalse(p.probe(self.link, run=lambda *a, **k: Result("", 1, "403 Forbidden"))["ok"])

    def test_timeout_is_a_failure_not_inconclusive(self):
        def slow(*a, **k):
            raise subprocess.TimeoutExpired("ffprobe", p.TIMEOUT_S)
        verdict = p.probe(self.link, run=slow)
        self.assertEqual((verdict["ok"], verdict["reason"]), (False, "TIMEOUT 20s"))

    def test_torrent_links_are_reported_as_not_probed(self):
        self.assertIsNone(p.probe({"url": "magnet:?xt=urn:btih:x", "type": "MAGNET"})["ok"])

    def test_summary_counts_servers_links_and_reasons(self):
        report = {"plugin": "X", "loaded": True, "providers": [{"works": [{"episodes": [{
            "embeds": [{"embed": "https://a.test/e", "links": [dict(self.link, probe={"ok": True})]},
                       {"embed": "https://b.test/e", "links": []}],
            "direct": [dict(self.link, url="https://c.test/x.mp4", probe={"ok": False, "reason": "no video frame"})]}]}]}]}
        text = p.summarize([report])
        self.assertIn("| X | نعم | 1/1 | 1 | 2 | 1 | 2 | 1 | 1 | 0 |", text)
        self.assertIn("c.test · no video frame × 1", text)

    def test_failure_reason_never_contains_the_link(self):
        verdict = p.probe(self.link, run=lambda *a, **k: Result("", 1, "https://cdn.test/v.m3u8?token=secret: Server returned 403 Forbidden"))
        self.assertNotIn("cdn.test", verdict["reason"])
        self.assertNotIn("secret", verdict["reason"])
        self.assertIn("403 Forbidden", verdict["reason"])

    def test_live_check_is_used_and_late_ones_are_marked(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            ep = {"embeds": [{"embed": "https://a.test/e", "links": [dict(self.link)]}], "direct": [dict(self.link, url="https://c.test/x.mp4")]}
            (root / "X.json").write_text(json.dumps({"plugin": "X", "loaded": True, "providers": [{"works": [{"episodes": [ep]}]}]}))
            (root / "X.ep1.json.probed.json").write_text(json.dumps({self.link["url"]: {"ok": True, "reason": None}}))
            original, calls = p.probe, []
            p.probe = lambda link, run=None: calls.append(link["url"]) or {"ok": False, "reason": "late"}
            try:
                sys.argv = ["probe_links.py", str(root)]
                p.main()
            finally:
                p.probe = original
            out = json.loads((root / "verdicts.json").read_text())[0]["providers"][0]["works"][0]["episodes"][0]
            self.assertEqual(out["embeds"][0]["links"][0]["probe"], {"ok": True, "reason": None})
            self.assertTrue(out["direct"][0]["probe"]["late"])
            self.assertEqual(calls, ["https://c.test/x.mp4"])


if __name__ == "__main__":
    unittest.main()
