/** Run after the tested Worker is deployed; never as a pre-deploy migration. */
import { readFileSync } from 'node:fs';

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, D1_DATABASE_ID: database } = process.env;
if (!token || !account || !database) throw new Error('Missing D1 repair credentials');

const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
async function query(body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success || !result.result?.length || result.result.some((item) => !item.success)) {
    // Never print SQL, returned account rows or the API response in Actions logs.
    throw new Error(`D1 guarded repair failed (HTTP ${response.status})`);
  }
  return result.result;
}

const count = async (table, predicate) => {
  const [result] = await query({ sql: `SELECT COUNT(*) AS n FROM ${table} t
    JOIN accounts a ON a.user_id = t.user_id WHERE lower(a.username) = 'dahmi' AND ${predicate}` });
  return result.results?.[0]?.n ?? 0;
};
const ownerViews = async () => {
  const [result] = await query({ sql: `SELECT COUNT(*) AS n FROM work_views v
    JOIN accounts a ON a.user_id = v.user_id WHERE lower(a.username) = 'ngm' AND v.removed = 0` });
  return result.results?.[0]?.n ?? 0;
};

const pending = await count('work_views', "t.rev = 5407 AND t.removed = 0 AND t.series_ref LIKE 'anime:%'");
if (!pending) {
  console.log('Account attribution repair: no unrepaired legacy anime batch.');
  process.exit(0);
}
if (pending !== 5) throw new Error('Audited attribution batch changed; refusing repair');

const before = {
  genuineViews: await count('work_views', "t.removed = 0 AND t.series_ref NOT LIKE 'anime:%'"),
  genuineMarks: await count('chapter_marks', 't.read = 1 AND t.rev != 5407'),
  ownerViews: await ownerViews(),
};
const sql = readFileSync(new URL('./2026-09-dahmi-anime-attribution.sql', import.meta.url), 'utf8');
const statements = sql.replace(/^\s*--[^\n]*$/gm, '').split(';').map((item) => item.trim()).filter(Boolean);
if (statements.length !== 7) throw new Error('Unexpected account attribution repair SQL');
await query({ batch: statements.map((statement) => ({ sql: statement })) });

const after = {
  activeAnimeViews: await count('work_views', "t.rev = 5407 AND t.removed = 0 AND t.series_ref LIKE 'anime:%'"),
  publicAnimeViews: await count('public_work_views', "t.removed = 0 AND t.series_ref LIKE 'anime:%'"),
  activeImportedLibrary: await count('library', "t.rev = 5407 AND t.removed = 0 AND t.series_ref LIKE 'anime:%'"),
  activeImportedMarks: await count('chapter_marks', "t.rev = 5407 AND t.read = 1 AND t.series_ref LIKE 'anime:%'"),
  genuineViews: await count('work_views', "t.removed = 0 AND t.series_ref NOT LIKE 'anime:%'"),
  genuineMarks: await count('chapter_marks', 't.read = 1 AND t.rev != 5407'),
  ownerViews: await ownerViews(),
};
if (after.activeAnimeViews || after.publicAnimeViews || after.activeImportedLibrary || after.activeImportedMarks
    || after.genuineViews !== before.genuineViews || after.genuineMarks !== before.genuineMarks
    || after.ownerViews !== before.ownerViews) {
  throw new Error('D1 account attribution postcondition failed; inspect private D1 audit');
}
console.log('Account attribution repaired: 5 private and public view tombstones; 2 library and 4 mark withdrawals.');
console.log(`Unrelated friend views and marks preserved: ${after.genuineViews} views, ${after.genuineMarks} marks.`);
