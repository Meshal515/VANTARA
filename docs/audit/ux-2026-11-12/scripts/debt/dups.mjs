// تكرار تقريبي: نوافذ من 8 أسطر مطبّعة (بلا مسافات ولا تعليقات) تتكرر بين الملفات أو داخل الملف
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const W = 8, roots = process.argv.slice(2);
const files = roots.flatMap((d) => readdirSync(d).filter((n) => /\.(js|css)$/.test(n) && !/\.test\./.test(n)).map((n) => join(d, n)));
const seen = new Map(); const pairs = new Map();
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/\/\/.*$|\/\*.*?\*\//g, '').replace(/\s+/g, '')).map((l, i) => [l, i]).filter(([l]) => l.length > 6 && !/^[{}()\];,]+$/.test(l));
  for (let i = 0; i + W <= lines.length; i++) {
    const key = lines.slice(i, i + W).map((x) => x[0]).join('\n');
    const at = { f, line: lines[i][1] + 1 };
    if (seen.has(key)) { const o = seen.get(key); if (o.f === f && Math.abs(o.line - at.line) < W) continue; const k = [o.f, f].sort().join('  <->  '); pairs.set(k, (pairs.get(k) ?? 0) + 1); }
    else seen.set(key, at);
  }
}
const top = [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 14);
console.log('نوافذ مكررة (8 أسطر):', [...pairs.values()].reduce((a, b) => a + b, 0));
for (const [k, n] of top) console.log(String(n).padStart(4), k.replace(/apps\/web\//g, ''));
