"""افحص ملفات الإقلاع الفعلية داخل APK، لا نجاح Gradle أو التوقيع فقط."""
import json
import sys
import zipfile
from pathlib import Path


def verify(apk, web):
    with zipfile.ZipFile(apk) as archive:
        names = set(archive.namelist())

        def required(name):
            if name not in names or not archive.read(name):
                raise ValueError('Missing or empty APK asset: ' + name)
            return archive.read(name)

        required('assets/public/index.html')
        config = json.loads(required('assets/capacitor.config.json'))
        if config.get('appId') != 'com.vantara.app' or config.get('server', {}).get('url'):
            raise ValueError('APK must use the bundled VANTARA shell')
        if config.get('server', {}).get('androidScheme') != 'https':
            raise ValueError('APK shell must use https://localhost')
        count = 0
        for source in Path(web).rglob('*'):
            relative = source.relative_to(web)
            if 'node_modules' in relative.parts or any(part.startswith('.') for part in relative.parts):
                continue
            if not source.is_file() or '.test.' in source.name or source.name.startswith('_'):
                continue
            name = 'assets/public/' + relative.as_posix()
            if name not in names or archive.read(name) != source.read_bytes():
                raise ValueError('Missing or different APK web asset: ' + name)
            count += 1
        return count


if __name__ == '__main__':
    count = verify(sys.argv[1], Path(sys.argv[2]) if len(sys.argv) > 2 else Path('apps/web'))
    print(f'APK shell verified: configuration, index.html and {count} web assets')
