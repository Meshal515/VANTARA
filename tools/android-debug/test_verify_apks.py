import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location('verify_apks', Path(__file__).with_name('verify-apks.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class SignerReports(unittest.TestCase):
    """Captured from the actual published Debug 2164 using official SDK tools."""
    certificate = '0b5cce2127f3bb107a3ee01fe7e6c51b58d18ab3fe5292e6b944bbfe86a76bb0'

    def report(self, version):
        return Path(__file__).with_name('fixtures').joinpath(f'apksigner-{version}-debug-2164.txt').read_text()

    def inspect_report(self, report):
        with TemporaryDirectory() as folder:
            apk = Path(folder) / 'fixture.apk'
            apk.write_bytes(b'parser fixture only')
            badging = "package: name='com.vantara.app.debug' versionCode='2164' versionName='0.0.2164'\n"
            with patch.object(verify.subprocess, 'check_output', side_effect=[report, badging]):
                return verify.inspect(apk, Path(folder))

    def test_real_build_tools_35_report(self):
        self.assertEqual(self.inspect_report(self.report(35))['certificate'], self.certificate)

    def test_real_build_tools_37_report(self):
        self.assertEqual(self.inspect_report(self.report(37))['certificate'], self.certificate)

    def test_rejects_multiple_signers_even_with_same_certificate(self):
        for version in [35, 37]:
            with self.subTest(version=version), self.assertRaises(ValueError):
                self.inspect_report(self.report(version).replace('Number of signers: 1', 'Number of signers: 2'))

    def test_rejects_different_certificates_between_schemes(self):
        report = self.report(37) + 'V3.0 Signer: certificate SHA-256 digest: ' + 'c' * 64 + '\n'
        with self.assertRaises(ValueError):
            self.inspect_report(report)

    def test_rejects_missing_certificate_or_signer_count(self):
        for report in [self.report(37).replace('Number of signers: 1', ''), self.report(37).replace('certificate SHA-256 digest:', 'public key SHA-256 digest:')]:
            with self.subTest(report=report), self.assertRaises(ValueError):
                self.inspect_report(report)


class SignerCountReport(unittest.TestCase):
    def test_rejects_ambiguous_duplicate_signer_counts(self):
        report = 'Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ' + 'a' * 64 + '\n'
        for count in [1, 2]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                verify.parse_single_signer(report + f'Number of signers: {count}\n')


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


    def test_current_apksigner_v2_single_signer_output(self):
        cert = '0b5cce2127f3bb107a3ee01fe7e6c51b58d18ab3fe5292e6b944bbfe86a76bb0'
        actual = (
            'Verifies\n'
            'Verified using v1 scheme (JAR signing): false\n'
            'Verified using v2 scheme (APK Signature Scheme v2): true\n'
            'Verified for SourceStamp: false\n'
            'Number of signers: 1\n'
            'V2 Signer: certificate DN: CN=VANTARA\n'
            f'V2 Signer: certificate SHA-256 digest: {cert}\n'
        )
        self.assertEqual(verify.parse_single_signer(actual), cert)

    def test_current_apksigner_must_report_exactly_one_signer(self):
        good = 'Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ' + 'a'*64 + '\n'
        for bad in [
            good.replace('Number of signers: 1', 'Number of signers: 2'),
            good.replace('Number of signers: 1', 'Number of signers: 0'),
            good + 'V3 Signer: certificate SHA-256 digest: ' + 'b'*64 + '\n',
            good.replace('Number of signers: 1', 'No signer count'),
        ]:
            with self.subTest(output=bad), self.assertRaises(ValueError):
                verify.parse_single_signer(bad)

    def test_single_signer_case_whitespace_and_stamp(self):
        certificate = 'A' * 64
        output = (
            'Verifies\n'
            'Number of signers: 1\n'
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
