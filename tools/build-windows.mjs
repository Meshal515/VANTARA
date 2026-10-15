import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const output = path.resolve(argument('output', path.join(repo, '..', 'VANTARA-artifacts')));
const cache = path.resolve(argument('cache', path.join(output, 'cache')));
const sevenzip = argument('sevenzip', '7z');
const makensis = argument('makensis', 'makensis');
const nsisdir = argument('nsisdir', process.env.NSISDIR);
const portable = path.join(output, 'VANTARA-Windows-x64');
const app = path.join(portable, 'resources', 'app');
const native = path.join(app, 'native');
const videoHost = path.resolve(argument('video-host',path.join(repo,'apps/desktop/native/vantara-video-host.exe')));
// A Windows build must contain the real child-window host; never fall back to
// an external mpv window when CI forgot its Windows-compiled companion.
await fs.access(videoHost).catch(()=>{throw new Error('Missing native video host: compile tools/build-video-host.ps1 on Windows and supply --video-host=path');});
const version = JSON.parse(await fs.readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8')).version;
const artifacts = [
  { name: 'electron-v44.7.2-win32-x64.zip', url: 'https://github.com/electron/electron/releases/download/v44.7.2/electron-v44.7.2-win32-x64.zip', sha256: '10a89447ef64ac5cb9f782af48ffd83734a40ae91681259d1048ca3c9e6c5da4', source: 'https://github.com/electron/electron/tree/v44.7.2' },
  { name: 'rqbit.exe', url: 'https://github.com/ikatson/rqbit/releases/download/v9.0.1/rqbit.exe', sha256: '2ed683203beca628e0c45f62f99feeef4242cecc3444c8422dfe5b1b6aa38cea', source: 'https://github.com/ikatson/rqbit/tree/v9.0.1' },
  { name: 'mpv-x86_64-20261014-git-ec38361c56.7z', url: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261014/mpv-x86_64-20261014-git-ec38361c56.7z', sha256: 'ab6236a2b78a3e9e93a156c1f638d3182ee906006d019c15d1b7b056a7c9a4c5', source: 'https://github.com/shinchiro/mpv-winbuild-cmake/tree/20261014' },
  { name: 'vc_redist.x64.exe', url: 'https://download.visualstudio.microsoft.com/download/pr/990c720a-46ce-4dc7-87b9-c2eb615d34b9/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe', sha256: 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b', source: 'https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files' },
];
const sha256 = data => createHash('sha256').update(data).digest('hex');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`فشل ${command}: ${result.status}`);
}

async function download(artifact) {
  const filename = path.join(cache, artifact.name);
  let bytes = await fs.readFile(filename).catch(() => null);
  if (!bytes || sha256(bytes) !== artifact.sha256) {
    const response = await fetch(artifact.url);
    if (!response.ok) throw new Error(`تنزيل ${artifact.name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== artifact.sha256) throw new Error(`بصمة ${artifact.name} لا تطابق المصدر`);
    await fs.writeFile(filename, bytes);
  }
  console.log(`بصمة سليمة: ${artifact.name}`);
  return filename;
}

async function pe64(filename) {
  const bytes = await fs.readFile(filename);
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0' || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`ملف ليس Windows PE x64: ${filename}`);
  return { path: path.relative(portable, filename), sha256: sha256(bytes), bytes: bytes.length };
}

await fs.mkdir(cache, { recursive: true });
await fs.mkdir(output, { recursive: true });
const downloaded = await Promise.all(artifacts.map(download));
await fs.mkdir(portable, { recursive: true });
run('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', downloaded[0], portable]);
await fs.rename(path.join(portable, 'electron.exe'), path.join(portable, 'VANTARA.exe'));
await fs.mkdir(native, { recursive: true });
run(sevenzip, ['x', '-y', `-o${native}`, downloaded[2]]);
await fs.copyFile(downloaded[1], path.join(native, 'rqbit.exe'));
// rqbit dynamically imports Microsoft's CRT; mpv imports the Vulkan loader.
// Ship both app-local so a clean Windows installation needs no extra installer.
await fs.copyFile(path.join(portable, 'vulkan-1.dll'), path.join(native, 'vulkan-1.dll'));
const vcExtract = path.join(cache, 'vc-runtime-extracted');
await fs.mkdir(vcExtract, { recursive: true });
const vcBytes = await fs.readFile(downloaded[3]);
let offset = -1, cabinet = 0;
while ((offset = vcBytes.indexOf(Buffer.from('MSCF'), offset + 1)) >= 0) {
  const size = vcBytes.readUInt32LE(offset + 8);
  if (size < 36 || size > vcBytes.length - offset) continue;
  const filename = path.join(vcExtract, `container-${cabinet++}.cab`);
  await fs.writeFile(filename, vcBytes.subarray(offset, offset + size));
  run(sevenzip, ['x', '-y', `-o${vcExtract}`, filename]);
}
run(sevenzip, ['x', '-y', `-o${path.join(vcExtract, 'amd64')}`, path.join(vcExtract, 'a12')]);
for (const name of ['vcruntime140.dll', 'vcruntime140_1.dll']) await fs.copyFile(path.join(vcExtract, 'amd64', `${name}_amd64`), path.join(native, name));
await fs.copyFile(path.join(vcExtract, 'u31'), path.join(native, 'MICROSOFT-VC-RUNTIME-LICENSE.rtf'));
await fs.cp(path.join(repo, 'apps', 'desktop'), app, {
  recursive: true,
  filter: filename => !/(?:^|[/\\])node_modules(?:[/\\]|$)|\.test\.(?:mjs|cjs)$|windows\.nsi$/.test(filename),
});
await fs.copyFile(videoHost,path.join(native,'vantara-video-host.exe'));
await fs.cp(path.join(repo, 'apps', 'web'), path.join(app, 'web'), {
  recursive: true,
  filter: filename => !/\.test\.js$|(?:^|[/\\])node_modules(?:[/\\]|$)/.test(filename),
});
const binaries = await Promise.all(['VANTARA.exe', 'resources/app/native/rqbit.exe', 'resources/app/native/mpv.exe', 'resources/app/native/vantara-video-host.exe', 'resources/app/native/vulkan-1.dll', 'resources/app/native/vcruntime140.dll', 'resources/app/native/vcruntime140_1.dll'].map(name => pe64(path.join(portable, name))));
const required = ['resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/src/services.mjs', 'resources/app/web/desktop/index.html', 'resources/app/web/desktop/boot.js', 'resources/app/web/fonts/NotoSansArabic.var.woff2'];
await Promise.all(required.map(name => fs.access(path.join(portable, name))));

const sourceDirectory = path.join(portable, 'SOURCES');
await fs.mkdir(sourceDirectory, { recursive: true });
const sourceDownloads = [
  { name: 'rqbit-v9.0.1-source.tar.gz', url: 'https://codeload.github.com/ikatson/rqbit/tar.gz/refs/tags/v9.0.1' },
  { name: 'mpv-ec38361c56-source.tar.gz', url: 'https://codeload.github.com/mpv-player/mpv/tar.gz/ec38361c56' },
  { name: 'mpv-windows-build-source.tar.gz', url: 'https://codeload.github.com/shinchiro/mpv-winbuild-cmake/tar.gz/refs/tags/20261014' },
];
for (const source of sourceDownloads) {
  const filename = path.join(cache, source.name);
  let bytes = await fs.readFile(filename).catch(() => null);
  if (!bytes) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`مصدر ${source.name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filename, bytes);
  }
  await fs.writeFile(path.join(sourceDirectory, source.name), bytes);
  source.sha256 = sha256(bytes);
}
await fs.writeFile(path.join(portable, 'THIRD-PARTY-NOTICES.txt'), `VANTARA Windows ${version}\n\nElectron 44.7.2: MIT and Chromium notices in LICENSES.chromium.html and LICENSE.\nrqbit 9.0.1: Apache-2.0. Corresponding source in SOURCES/rqbit-v9.0.1-source.tar.gz.\nmpv Windows build 20261014: mpv/FFmpeg and bundled library notices accompany native/mpv.exe; build and mpv sources in SOURCES.\nPinned upstream build references and binary SHA-256 are in BUILD-MANIFEST.json.\nVANTARA application source repository: https://github.com/Meshal515/VANTARA\n`);
await fs.writeFile(path.join(portable, 'ابدأ-هنا.txt'), `VANTARA لويندوز — نسخة معاينة ${version}\n\nشغّل VANTARA.exe من هذا المجلد؛ لا تنقل الملف التنفيذي وحده. النسخة المحمولة تحفظ بياناتها وملفات التورنت في VANTARA-data بجوار البرنامج، لذلك فكها على القرص ذي المساحة الكافية مثل E.\nمن الإضافات أضف رابط Torrentio المعدّ. يمكن إكمال الإعداد داخل نافذة التطبيق؛ زر تثبيت Stremio يعيد رابط الإضافة إلى VANTARA.\nاختر الفيلم أو الحلقة ثم اختر مصدر التشغيل بنفسك.\nمحرك التورنت والمشغل مرفقان؛ لا يلزم تثبيت برامج منفصلة.\nيفحص VANTARA الأقراص الثابتة القابلة للكتابة ويختار القرص صاحب المساحة الفارغة الأكبر لكاش التورنت تلقائيًا. الكاش نافذة متحركة: يحمّل قدّام بقدر المساحة الحرة، ويبقي 50 ثانية ورا فقط ويفرّغ ما قبلها من القرص، ويوقف التنزيل مؤقتًا إذا اقتربت المساحة من الحد ثم يستأنف مع تقدّم المشاهدة. الرجوع لجزء مفرَّغ يعيد تنزيله من نفس اللحظة. كل ملفات الجلسة تُحذف بعد إغلاق المشغل. فيلم 40GB لا يحتاج 40GB فاضية.\nالمكتبة والحسابات متاحة من قائمة VANTARA، والدخول يتبع اقتران الجهاز الحالي.\nالرفيق والترجمة بالذكاء الاصطناعي خارج نسخة ويندوز؛ ترجمات الفيديو العادية مدعومة. استخدم واجهة الغرفة الأصلية للمشاهدة المشتركة واختيار مصدرك؛ وجود مزود لا يضمن توفر كل حلقة.\nهذه حزمة معاينة غير موقعة، ولم يدع الفريق تجربة جهاز ويندوز دون دليل مرفق.\n`);
const configFile=path.join(app,'web/lib/config.js');
await fs.writeFile(configFile,(await fs.readFile(configFile,'utf8')).replace('__VANTARA_VERSION__',version));
await fs.writeFile(path.join(portable, 'BUILD-MANIFEST.json'), JSON.stringify({ product: 'VANTARA', version, platform: 'win32-x64', builtAt: new Date().toISOString(), signed: false, artifacts, binaries, sources: sourceDownloads, runtimeVerifiedOnWindows: false }, null, 2) + '\n');
const zip = path.join(output, `VANTARA-${version}-Windows-x64.zip`);
run('python3', ['-c', 'import sys,zipfile,pathlib; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED,compresslevel=6); [z.write(p, str(pathlib.Path(root.name)/p.relative_to(root))) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()', portable, zip]);
const installer = path.join(output, `VANTARA-${version}-Windows-x64-Setup.exe`);
const compiler = spawnSync(makensis, ['-VERSION'], { encoding: 'utf8', env: { ...process.env, ...(nsisdir ? { NSISDIR: nsisdir } : {}) } });
if (!compiler.error && compiler.status === 0) {
  run(makensis, [`-DDIST=${portable}`, `-DOUTFILE=${installer}`, path.join(repo, 'apps/desktop/windows.nsi')], { env: { ...process.env, ...(nsisdir ? { NSISDIR: nsisdir } : {}) } });
} else console.log('المثبت غير مبني؛ portable ZIP جاهز، ومصدر NSIS موجود.');
const outputs = [zip];
if (await fs.access(installer).then(() => true, () => false)) outputs.push(installer);
const checksums = await Promise.all(outputs.map(async filename => `${sha256(await fs.readFile(filename))}  ${path.basename(filename)}`));
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(JSON.stringify({ outputs, binaries }, null, 2));
