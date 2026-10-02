/**
 * من يحق للجالب أن يطلبه.
 *
 * الجالب ليس proxy مفتوحًا: يطلب فقط مواقع مصادرنا ومشغّلاتها كما تسردها
 * `apps/web/pwa/sources/allow.json` (ملف واحد يقرؤه الجالب والواجهة والحارس
 * في repository-safety). سطر `example.com` يطابق الموقع ونطاقاته الفرعية
 * (`cdn.example.com`)، لأن مضيفات الصور والفيديو تتبدل تحت النطاق نفسه.
 *
 * ومع القائمة حراسة SSRF: لا عناوين IP، ولا localhost، ولا منافذ غير
 * الافتراضية، ولا مخطط غير http/https.
 */

export interface AllowList {
  hosts: readonly string[];
}

const PRIVATE_SUFFIXES = ['localhost', '.local', '.internal', '.lan', '.home', '.arpa'];

/** عنوان صالح للجلب أصلًا (قبل القائمة): مخطط ومنفذ ومضيف. */
export function parseTarget(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.port !== '' || url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) return null;
  // IPv4 حرفي أو IPv6 بين أقواس: لا يُطلب بالعنوان أبدًا، بالاسم فقط
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null;
  if (PRIVATE_SUFFIXES.some((s) => host === s.replace(/^\./, '') || host.endsWith(s))) return null;
  return url;
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

/** المضيف مسموح إن طابق سطرًا أو كان نطاقًا فرعيًا منه. */
export function hostAllowed(host: string, list: AllowList): boolean {
  const h = normalizeHost(host);
  return list.hosts.some((entry) => {
    const e = normalizeHost(entry);
    return e.length > 0 && (h === e || h.endsWith(`.${e}`));
  });
}

export function targetAllowed(raw: unknown, list: AllowList): URL | null {
  const url = parseTarget(raw);
  return url && hostAllowed(url.hostname, list) ? url : null;
}
