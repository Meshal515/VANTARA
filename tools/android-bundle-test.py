import importlib.util
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).with_name('verify-android-bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class BundleTest(unittest.TestCase):
    def test_no_tracked_machine_local_dependencies(self):
        paths = subprocess.check_output(['git', 'ls-files'], text=True).splitlines()
        self.assertEqual([p for p in paths if 'node_modules' in Path(p).parts], [])

    def check_bundle(self, missing=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            web = root / 'web'
            web.mkdir()
            files = {'index.html': '<script src="/app.js"></script>', 'app.js': 'document.title="VANTARA"'}
            for name, value in files.items():
                (web / name).write_text(value)
            entries = {'assets/public/' + name: value for name, value in files.items()}
            entries['assets/capacitor.config.json'] = json.dumps({'appId': 'com.vantara.app', 'server': {'androidScheme': 'https'}})
            entries.pop(missing, None)
            apk = root / 'app.apk'
            with zipfile.ZipFile(apk, 'w') as out:
                for name, value in entries.items():
                    out.writestr(name, value)
            return bundle.verify(apk, web)

    def test_complete_shell(self):
        self.check_bundle()

    def test_missing_start_page(self):
        with self.assertRaisesRegex(ValueError, 'index.html'):
            self.check_bundle('assets/public/index.html')

    def test_missing_capacitor_configuration(self):
        with self.assertRaisesRegex(ValueError, 'capacitor.config.json'):
            self.check_bundle('assets/capacitor.config.json')

    def test_partial_web_copy(self):
        with self.assertRaisesRegex(ValueError, 'app.js'):
            self.check_bundle('assets/public/app.js')


if __name__ == '__main__':
    unittest.main()
