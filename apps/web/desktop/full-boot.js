// القشرة تستبدل مدخل /index.html بهذا حتى تسبق الجسور قراءة app.js.
await import('./boot.js');
await import('../app.js');
