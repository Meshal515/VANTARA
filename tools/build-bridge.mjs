// «جسرك الخاص»: يبني services/web-fetcher ملفًا واحدًا (ES module) يلصقه المستخدم في محرّر Cloudflare Workers في حسابه.
// المخرج apps/web/bridge/vantara-bridge.js تقدّمه الإعدادات للتنزيل. نفس كود الجالب حرفيًا؛ لا نسخة ثانية تتفرّع.
// node tools/build-bridge.mjs [--check]   (--check: يفشل إن كان الملف المنشور قديمًا عن الكود)
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'node_modules/.pnpm/node_modules/'));
const esbuild = require('esbuild');
const out = join(root, 'apps/web/bridge/vantara-bridge.js');

const result = await esbuild.build({
  entryPoints: [join(root, 'services/web-fetcher/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  write: false,
  minify: false,
  legalComments: 'inline',
  alias: { '@vantara/domain': join(root, 'packages/domain/src/index.ts') },
  mainFields: ['module', 'main'],
  logLevel: 'silent',
});
const banner = `// جسر فانتارا الخاص — انشره في حسابك على Cloudflare Workers.
// 1) أنشئ Worker جديدًا وألصق هذا الملف كاملًا مكان الكود الافتراضي ثم انشره.
// 2) في إعدادات الـWorker: أضف سرًّا (Secret) باسم VANTARA_BRIDGE_KEY وقيمته مفتاح طويل (24 حرفًا فأكثر).
// 3) في فانتارا: الإعدادات ← جسر الويب: ألصق رابط الـWorker والمفتاح نفسه.
// المحتوى يمر عبر حسابك أنت، لا عبر خادم فانتارا. الرخصة: AGPL-3.0-only (مستودع فانتارا).
`;
const code = banner + result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  const current = await readFile(out, 'utf8').catch(() => '');
  if (current !== code) { console.error('apps/web/bridge/vantara-bridge.js قديم: شغّل node tools/build-bridge.mjs'); process.exit(1); }
  console.log('bridge up to date');
} else {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, code);
  console.log(`bridge: ${out} (${(code.length / 1024).toFixed(1)} KB)`);
}
