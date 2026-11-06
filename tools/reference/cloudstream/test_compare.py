import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import compare as c  # noqa: E402


def link(url, ok):
    return {"url": url, "probe": {"ok": ok, "reason": None if ok else "no video frame"}}


class CompareTest(unittest.TestCase):
    def test_unit_keys_ignore_tokens_and_www(self):
        self.assertEqual(c.unit_key(embed="https://www.Vidmoly.to/embed-abc.html?t=1"), "embed:vidmoly.to/embed-abc.html")
        self.assertEqual(c.unit_key(link_url="http://s203d1.downet.net/download/1/x.mp4"), "direct:s203d1.downet.net")

    def test_verdicts_follow_the_plan_table(self):
        ok = {"links": [link("https://a/x", True)], "reason": None}
        bad = {"links": [link("https://a/x", False)], "reason": None}
        empty = {"links": [], "reason": "لم يُستخرج رابط من vidmoly.to"}
        self.assertEqual(c.verdict(ok, ok)[0], "PASS")
        self.assertEqual(c.verdict(ok, None), ("VANTARA_FAULT", "السيرفر لم يظهر"))
        self.assertEqual(c.verdict(ok, empty), ("VANTARA_FAULT", "لم يُستخرج رابط من vidmoly.to"))
        self.assertEqual(c.verdict(ok, bad)[0], "VANTARA_FAULT")
        self.assertEqual(c.verdict(bad, ok)[0], "VANTARA_BETTER")
        self.assertEqual(c.verdict(bad, empty)[0], "BOTH_FAIL")
        unprobed = {"links": [{"url": "magnet:?x", "probe": {"ok": None}}], "reason": None}
        self.assertEqual(c.verdict(unprobed, ok)[0], "INCONCLUSIVE")

    def test_not_run_and_not_comparable_are_never_passes(self):
        ref = [{"plugin": "Akwam", "providers": [{"works": [{"title": "W", "episodes": [
            {"data": "d1", "embeds": [], "direct": [link("http://s1.example/v.mp4", True)]}]}]}]}]
        rows = c.judge(ref, {})
        self.assertEqual([r["verdict"] for r in rows], ["NOT_RUN"])
        van = {"Akwam": {"summary": {"comparable": False}, "episodes": {}}}
        self.assertEqual([r["verdict"] for r in c.judge(ref, van)], ["NOT_COMPARABLE"])

    def test_a_dropped_http_server_is_a_vantara_fault_with_its_evidence(self):
        ref = [{"plugin": "Akwam", "providers": [{"works": [{"title": "W", "episodes": [
            {"data": "d1", "embeds": [], "direct": [link("http://s1.example/v.mp4", True)]}]}]}]}]
        van = {"Akwam": {"summary": {"comparable": True}, "episodes": {"d1": {"data": "d1", "embeds": [], "direct": [],
               "dropped": [{"host": "s1.example", "scheme": "http", "port": 80}]}}}}
        rows = c.judge(ref, van)
        self.assertEqual(rows[0]["verdict"], "VANTARA_FAULT")
        text = c.summarize(rows, van)
        self.assertIn("| Akwam | 0 | 1 |", text)
        self.assertIn("s1.example · http:80 × 1", text)


if __name__ == "__main__":
    unittest.main()
