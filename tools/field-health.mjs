/**
 * صحة المصادر من الأجهزة الحقيقية (APK وPWA): يقرأ عدّادات `source_reports`
 * من D1 عبر واجهة Cloudflare ويطبع جدولًا لكل منصة/قسم/مصدر/خطوة:
 * المحاولات، نسبة النجاح، المهلات، الأخطاء، الحماية، متوسط الزمن، وأكثر الأسباب.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/field-health.mjs [--days=2]
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const name = process.env.D1_NAME ?? 'vantara';
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN وCLOUDFLARE_ACCOUNT_ID مطلوبان');
const days = Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7) ?? 2);

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await res.json();
  if (!body.success) throw new Error(JSON.stringify(body.errors));
  return body.result;
};
const db = (await api(`/d1/database?name=${name}`)).find((d) => d.name === name);
if (!db) throw new Error(`D1 ${name} غير موجود`);
const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
const [out] = await api(`/d1/database/${db.uuid}/query`, {
  method: 'POST',
  body: JSON.stringify({
    sql: `SELECT platform, section, source_id, stage, outcome, reason, app_version, SUM(count) AS n, SUM(ms_sum) AS ms, MAX(ms_max) AS mx
            FROM source_reports WHERE day >= ? GROUP BY platform, section, source_id, stage, outcome, reason, app_version`,
    params: [since],
  }),
});
const rows = out?.results ?? [];
if (!rows.length) {
  console.log(`لا تقارير منذ ${since} (الأجهزة ترسل بعد أول استعمال للنسخة التي تحمل القياس).`);
  process.exit(0);
}
const groups = new Map();
for (const r of rows) {
  const k = `${r.platform}|${r.section}|${r.source_id.split('.').pop()}|${r.stage}`;
  const g = groups.get(k) ?? { n: 0, ok: 0, timeout: 0, error: 0, challenge: 0, other: 0, ms: 0, mx: 0, reasons: new Map(), versions: new Set() };
  g.n += r.n;
  g.ms += r.ms;
  g.mx = Math.max(g.mx, r.mx);
  g.versions.add(r.app_version);
  if (r.outcome in g) g[r.outcome] += r.n;
  else g.other += r.n;
  if (r.outcome !== 'ok' && r.reason) g.reasons.set(r.reason, (g.reasons.get(r.reason) ?? 0) + r.n);
  groups.set(k, g);
}
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
console.log(`## صحة المصادر من الأجهزة — منذ ${since}\n`);
console.log('| المنصة | القسم | المصدر | الخطوة | محاولات | نجاح | مهلة | خطأ | حماية | أخرى | متوسط | أقصى | أكثر الأسباب |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [k, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const [platform, section, source, stage] = k.split('|');
  const top = [...g.reasons].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, n]) => `${r} ×${n}`).join(' · ');
  console.log(`| ${platform} | ${section} | ${source} | ${stage} | ${g.n} | ${pct(g.ok, g.n)} | ${pct(g.timeout, g.n)} | ${pct(g.error, g.n)} | ${pct(g.challenge, g.n)} | ${pct(g.other, g.n)} | ${Math.round(g.ms / g.n)}ms | ${g.mx}ms | ${top} |`);
}
