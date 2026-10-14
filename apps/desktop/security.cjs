const path = require('node:path');

function isAppFrame(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'vantara:' && u.hostname === 'app' && !u.username && !u.password && !u.port;
  } catch { return false; }
}

function assetPath(root, value) {
  if (!isAppFrame(value)) throw new Error('أصل الأصول المحلية غير مسموح');
  const u = new URL(value);
  const relative = decodeURIComponent(u.pathname).replaceAll('\\', '/');
  if (relative.includes('\0') || relative.split('/').includes('..')) throw new Error('مسار ملف غير مسموح');
  const base = path.resolve(root);
  const result = path.resolve(base, `.${relative === '/' ? '/index.html' : relative}`);
  if (!result.startsWith(base + path.sep)) throw new Error('مسار خارج الحزمة');
  return result;
}

function configuredAddonUrl(value) {
  if (typeof value !== 'string' || value.length > 16000 || !/^stremio:\/\//i.test(value)) throw new Error('رابط إعداد غير صالح');
  const u = new URL(value.replace(/^stremio:/i, 'https:'));
  if (u.username || u.password || u.port || !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(u.hostname) || /(?:^|\.)(localhost|local|internal|lan|home)$/i.test(u.hostname) || !/\/manifest\.json\/?$/.test(u.pathname)) throw new Error('رابط إضافة غير مسموح');
  u.hash = '';
  return u.href;
}

module.exports = { assetPath, isAppFrame, configuredAddonUrl };
