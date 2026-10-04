import { publicUrl } from './manifest.js';
import { plainObject, LIMITS } from './contracts.js';
export const IMPORT_LIMIT = 1024 * 1024;
export const IMPORT_ITEMS = 100;
const bytes = value => new TextEncoder().encode(value).length;
export function manifestEndpoint(input) {
  const url = publicUrl(String(input).trim().replace(/^stremio:\/\//i, 'https://'));
  if (!/\.json\/?$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/$/,'') + '/manifest.json';
  url.hash = '';
  return url.href;
}
export function assertBoundedData(data) {
  const stack = [[data, 0]]; let count = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (++count > 50000 || depth > 64) throw new Error('بيانات الإضافة متشعبة أكثر من الحد المسموح');
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (['__proto__','constructor','prototype'].includes(key)) throw new Error('بيانات JSON غير آمنة');
        stack.push([value[key], depth + 1]);
      }
    }
  }
}
export function canonicalData(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalData).join(',')}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalData(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Data files only. A manifest does not imply its service URL. */
export function parseAddonImport(text, { serviceUrl } = {}) {
  if (typeof text !== 'string' || bytes(text) > IMPORT_LIMIT)
    throw new Error('ملف الإضافات أكبر من الحد المسموح (1 MB)');
  let data;
  try {
    data = JSON.parse(text, (key, value) => {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error('unsafe');
      return value;
    });
  } catch {
    throw new Error('النص ليس ملف JSON صالحًا وآمنًا');
  }
  assertBoundedData(data);
  const sectioned = ['streamAddons', 'subtitleAddons'].some(key => Array.isArray(data?.[key]));
  const entries = Array.isArray(data) ? data : Array.isArray(data?.addons) ? data.addons : Array.isArray(data?.manifests) ? data.manifests : sectioned ? ['streamAddons', 'subtitleAddons'].flatMap(key => Array.isArray(data[key]) ? data[key] : []) : [data];
  if (!entries.length || entries.length > IMPORT_ITEMS) throw new Error('اختر حزمة تحتوي من 1 إلى 100 إضافة');
  return entries.map((entry, index) => {
    let name = `إضافة ${index + 1}`;
    try {
      const wrapper = plainObject(entry) && plainObject(entry.manifest);
      const raw = wrapper ? entry.manifest : plainObject(entry) && typeof entry.id === 'string' ? entry : null;
      const declaredName = raw?.name ?? entry?.name;
      if (typeof declaredName === 'string') name = declaredName.slice(0,160);
      let url = typeof entry === 'string' ? entry : wrapper ? entry.manifestUrl ?? entry.transportUrl ?? entry.url : entry?.manifestUrl ?? entry?.transportUrl ?? entry?.url;
      url ??= serviceUrl;
      if (typeof url !== 'string' || !url.trim()) throw new Error('أضف رابط الخدمة لهذه الإضافة؛ ملف البيانات وحده لا يحدد مكان الاتصال');
      url = manifestEndpoint(url);
      if (!raw && typeof entry !== 'string' && !plainObject(entry)) throw new Error('هذا العنصر ليس إضافة صالحة');
      if (raw && bytes(JSON.stringify(raw)) > LIMITS.manifest) throw new Error('بيانات هذه الإضافة أكبر من الحد المسموح');
      return { name, url, raw };
    } catch (error) { return { name, error: error.message }; }
  });
}
