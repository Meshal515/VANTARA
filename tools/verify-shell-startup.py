"""اختبار إقلاع وتفاعل الواجهة الحقيقية على محاكي أندرويد."""
import pathlib, re, subprocess, time, xml.etree.ElementTree as ET
out = pathlib.Path('shell-proof')
out.mkdir(exist_ok=True)
def adb(*args):
    return subprocess.check_output(['adb', *args])
try:
    for attempt in range(15):
        adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
        xml = adb('shell', 'cat', '/sdcard/window.xml')
        (out / 'startup.xml').write_bytes(xml)
        tree = ET.fromstring(xml)
        buttons = [n for n in tree.iter('node') if 'فتح الإعدادات' in n.get('text', '') or 'فتح الإعدادات' in n.get('content-desc', '')]
        if buttons:
            break
        time.sleep(2)
    else:
        raise AssertionError('لم ترسم الواجهة زر الإعدادات بعد تشغيل JavaScript')
    (out / 'startup.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    bounds = list(map(int, re.findall(r'\d+', buttons[0].get('bounds', ''))))
    assert len(bounds) == 4
    adb('shell', 'input', 'tap', str((bounds[0]+bounds[2])//2), str((bounds[1]+bounds[3])//2))
    for attempt in range(10):
        adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
        xml = adb('shell', 'cat', '/sdcard/window.xml')
        (out / 'settings.xml').write_bytes(xml)
        if 'الإعدادات' in xml.decode() and 'فتح الإعدادات' not in xml.decode():
            break
        time.sleep(2)
    else:
        raise AssertionError('زر الإعدادات لم يفتح الشاشة')
    (out / 'settings.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    print('نجح: واجهة localhost اشتغلت، وشغّلت JavaScript، وفتحت الإعدادات بالضغط')
finally:
    (out / 'logcat.txt').write_bytes(adb('logcat', '-d'))
