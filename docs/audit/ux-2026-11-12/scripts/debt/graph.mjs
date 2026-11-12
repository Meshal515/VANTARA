// خريطة الاستيراد في apps/web: الحلقات، والصادرات غير المستوردة من أي مكان (عدا الاختبارات)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
const ROOT = resolve(process.argv[2]);
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules' || n === 'vendor' || n === 'desktop') continue; const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
walk(ROOT);
const graph = new Map(), exportsOf = new Map(), importedNames = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const deps = new Set();
  for (const m of src.matchAll(/(?:import|export)\s*(?:([\w*\s{},]+?)\s*from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const to = resolve(dirname(f), m[2]); deps.add(to);
    const names = (m[1] || '').match(/\{([^}]*)\}/)?.[1]?.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean) ?? [];
    if (!importedNames.has(to)) importedNames.set(to, new Set());
    for (const n of names) importedNames.get(to).add(n);
    if (/\*\s+as|^\s*\w+\s*$/.test(m[1] || '') || /export\s*\*/.test(m[0])) importedNames.get(to).add('*');
    if (m[1] && /^\s*\w+\s*(,|$)/.test(m[1])) importedNames.get(to).add('default');
  }
  for (const m of src.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) { const to = resolve(dirname(f), m[1]); deps.add(to); if (!importedNames.has(to)) importedNames.set(to, new Set()); importedNames.get(to).add('*'); }
  graph.set(f, deps);
  exportsOf.set(f, [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gm)].map((m) => m[1]));
}
// الحلقات (Tarjan)
let idx = 0; const st = [], on = new Set(), ix = new Map(), low = new Map(), sccs = [];
const sc = (v) => { ix.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
  for (const w of graph.get(v) ?? []) { if (!graph.has(w)) continue; if (!ix.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w))); }
  if (low.get(v) === ix.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) sccs.push(c); } };
for (const v of graph.keys()) if (!ix.has(v)) sc(v);
console.log('ملفات:', files.length, '| حلقات اعتماد:', sccs.length);
for (const c of sccs) console.log('  حلقة:', c.map((f) => relative(ROOT, f)).join(' ⇄ '));
// صادرات لا يستوردها أحد (قد تُستعمل من HTML أو الاختبارات أو الأصلي؛ تُفحص قبل الحذف)
const tests = []; const walkT = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules') continue; const s = statSync(p); if (s.isDirectory()) walkT(p); else if (/\.test\.js$/.test(n)) tests.push(readFileSync(p, 'utf8')); } }; walkT(ROOT);
const testText = tests.join('\n');
let dead = 0, testOnly = 0; const out = [];
for (const [f, names] of exportsOf) {
  const used = importedNames.get(f) ?? new Set();
  if (used.has('*')) continue;
  for (const n of names) if (!used.has(n)) { if (new RegExp(`\\b${n}\\b`).test(testText)) testOnly++; else { dead++; out.push(`${relative(ROOT, f)}: ${n}`); } }
}
console.log('صادرات لا يستوردها كود ولا اختبار:', dead, '| صادرات تستوردها الاختبارات فقط:', testOnly);
console.log(out.slice(0, 40).join('\n'));
