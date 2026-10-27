import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify_apks', Path(__file__).with_name('verify-apks.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class UpgradeContract(unittest.TestCase):
    def setUp(self):
        self.previous = dict(package=verify.PACKAGE, code=2164, name='0.0.2164', certificate='a' * 64, sha256='b' * 64, size=123)
        self.candidate = dict(self.previous, code=2165, name='0.0.2165')
        self.manifest = dict(format=2, channel='debug', versionCode=2164, versionName='0.0.2164', apk=dict(sha256='b' * 64, size=123))

    def check(self):
        verify.validate(self.previous, self.candidate, self.manifest, 'a' * 64, 2165)

    def test_upgrade(self):
        self.check()

    def test_rejects_broken_contracts(self):
        changes = [('candidate', 'package', 'com.vantara.app'), ('previous', 'package', 'other.debug'), ('candidate', 'certificate', 'c' * 64), ('previous', 'certificate', 'c' * 64), ('candidate', 'code', 2164), ('candidate', 'code', 2166), ('candidate', 'name', '1.0.0'), ('manifest', 'versionCode', 2163), ('manifest', 'channel', 'stable'), ('manifest', 'apk', dict(sha256='c' * 64, size=123))]
        original = copy.deepcopy((self.previous, self.candidate, self.manifest))
        for target, field, value in changes:
            with self.subTest(target=target, field=field):
                self.previous, self.candidate, self.manifest = copy.deepcopy(original)
                getattr(self, target)[field] = value
                with self.assertRaises(ValueError):
                    self.check()


    def test_single_signer_case_whitespace_and_stamp(self):
        certificate = 'A' * 64
        output = (
            'Verifies\n'
            'Signer #1 certificate DN: CN=VANTARA\n'
            f'  Signer #1 certificate SHA-256 digest: {certificate}  \n'
            'Source Stamp Signer certificate SHA-256 digest: ' + 'B' * 64 + '\n'
        )
        self.assertEqual(verify.parse_single_signer(output), certificate.lower())

    def test_reject_missing_or_conflicting_signers(self):
        cert_a = 'a' * 64
        cert_b = 'b' * 64
        samples = [
            'Verifies\n',
            'Signer #1 certificate SHA-256 digest: deadbeef\n',
            f'Signer #1 certificate SHA-256 digest: {cert_a}\n'
            f'Signer #2 certificate SHA-256 digest: {cert_b}\n',
            f'Signer #1 certificate SHA-256 digest: {cert_a}\n'
            f'Signer #1 certificate SHA-256 digest: {cert_b}\n',
        ]
        for output in samples:
            with self.subTest(output=output), self.assertRaises(ValueError):
                verify.parse_single_signer(output)


if __name__ == '__main__':
    unittest.main()
