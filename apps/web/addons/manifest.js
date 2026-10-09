import {
  CAPABILITIES,
  CONTENT_TYPES,
  PRODUCT_VERSION,
  plainObject,
} from "./contracts.js";
import { normalizeStremioManifest, safeStremioString } from "./stremio-model.js";
import { STREMIO_NATIVE_CAPABILITIES } from "./assessment.js";
/** قبول أسماء HTTPS العامة فقط؛ الطلب مباشر بلا cookies ولا proxy يتصل بعناوين داخلية. */
export function publicUrl(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    throw new Error("رابط إضافة غير صالح");
  }
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(h) ||
    /(?:^|\.)(localhost|local|internal|lan|home|testinvalid)$/.test(h)
  )
    throw new Error("رابط إضافة غير مسموح");
  return u;
}
export function safeUrlLabel(input) {
  try {
    return publicUrl(input).hostname;
  } catch {
    return "رابط غير صالح";
  }
}
const version = (v) =>
  typeof v === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(v);
const above = (a, b) => {
  const x = a.split(/[.+-]/).slice(0, 3).map(Number),
    y = b.split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
};
const strings = (v, allowed) =>
  Array.isArray(v) &&
  v.length <= 50 &&
  v.every((x) => typeof x === "string" && (!allowed || allowed.includes(x)));
export function validateManifest(
  raw,
  { origin, productVersion = PRODUCT_VERSION } = {},
) {
  const errors = [],
    compatibility = { pwa: true, apk: false, reason: null };
  let base;
  try {
    base = publicUrl(origin).origin;
  } catch {
    errors.push("origin");
  }
  if (!plainObject(raw))
    return { manifest: null, compatibility, errors: ["manifest"] };
  const stremio = Array.isArray(raw.resources) && Array.isArray(raw.types);
  // Stremio IDs are opaque provider identifiers, not Remote v1's DNS-style
  // names. Keep them bounded and free of path/control characters.
  const validId = stremio
    ? safeStremioString(raw.id) && raw.id !== "." && raw.id !== ".." && !/[\/\\]/.test(raw.id)
    : typeof raw.id === "string" && /^[a-zA-Z0-9._-]{3,160}$/.test(raw.id);
  if (!validId)
    errors.push("id");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 160)
    errors.push("name");
  if (!version(raw.version)) errors.push("version");
  const protocol = stremio ? "stremio" : "vantara";
  let capabilities, resources, types, permissions, baseUrl, stremioModel;
  if (stremio) {
    if (raw.protocolVersion != null && raw.protocolVersion !== 1)
      errors.push("protocolVersion");
    stremioModel = normalizeStremioManifest(raw);
    errors.push(...stremioModel.errors);
    types = stremioModel.contentTypes;
    resources = stremioModel.resources;
    capabilities = stremioModel.capabilities;
    permissions = {
      networkHosts: base ? [new URL(base).hostname] : [],
      verification: false,
    };
    baseUrl = base;
    compatibility.apkCapabilities = capabilities.filter(cap => STREMIO_NATIVE_CAPABILITIES.includes(cap));
    compatibility.apk = compatibility.apkCapabilities.length > 0;
  } else {
    if (raw.protocolVersion !== 1) errors.push("protocolVersion");
    if (raw.runtime !== "remote") errors.push("runtime");
    if (
      !version(raw.minVantaraVersion) ||
      above(raw.minVantaraVersion ?? "0.0.0", productVersion)
    )
      errors.push("minVantaraVersion");
    types = raw.contentTypes;
    capabilities = raw.capabilities;
    resources = raw.resources;
    if (!strings(types, CONTENT_TYPES) || !types.length)
      errors.push("contentTypes");
    if (!strings(capabilities, CAPABILITIES) || !capabilities.length)
      errors.push("capabilities");
    if (!Array.isArray(capabilities)) capabilities = [];
    permissions = raw.permissions;
    if (
      !plainObject(permissions) ||
      !strings(permissions.networkHosts) ||
      typeof permissions.verification !== "boolean"
    )
      errors.push("permissions");
    else
      for (const h of permissions.networkHosts) {
        try {
          if (publicUrl(`https://${h}`).hostname !== h)
            errors.push("networkHosts");
        } catch {
          errors.push("networkHosts");
        }
      }
    try {
      baseUrl = publicUrl(raw.baseUrl).href;
      if (
        new URL(baseUrl).origin !== base ||
        !permissions?.networkHosts?.includes(new URL(baseUrl).hostname)
      )
        errors.push("baseUrl");
    } catch {
      errors.push("baseUrl");
    }
    if (!plainObject(resources)) errors.push("resources");
    else
      for (const [k, path] of Object.entries(resources)) {
        if (
          !capabilities?.includes(k) ||
          typeof path !== "string" ||
          !path.startsWith("/") ||
          path.startsWith("//") ||
          path.includes("\\") ||
          /\{(?!workId\}|chapterId\}|page\}|query\})/.test(path) ||
          path.length > 2000
        )
          errors.push("resources");
      }
    if (capabilities?.some((c) => !resources?.[c])) errors.push("resources");
    if (permissions?.verification) {
      compatibility.pwa = false;
      compatibility.apk = false;
      compatibility.reason = "التحقق التفاعلي غير مدعوم في Remote v1";
    }
  }
  if (errors.length)
    return { manifest: null, compatibility, errors: [...new Set(errors)] };
  let logo = null;
  try {
    if (raw.logo) {
      const u = publicUrl(raw.logo);
      if (stremio || u.origin === base) logo = u.href;
    }
  } catch {
    /* شعار غير موثوق لا يُحمّل */
  }
  const manifest = {
    id: raw.id,
    key: `${base}|${raw.id}`,
    name: raw.name,
    version: raw.version,
    protocol,
    runtime: "remote",
    contentTypes: types,
    capabilities,
    resources,
    permissions,
    baseUrl,
    logo,
    description:
      typeof raw.description === "string" ? raw.description.slice(0, 2000) : "",
    languages: strings(raw.languages) ? raw.languages : [],
    official: false,
    catalogs: stremio ? stremioModel.catalogs : [],
    types: stremio ? stremioModel.types : types,
    ...(stremio ? {
      ...(stremioModel.idPrefixes != null ? { idPrefixes: stremioModel.idPrefixes } : {}),
      configuration: stremioModel.configuration,
      behaviorHints: stremioModel.behaviorHints,
      config: stremioModel.config,
      diagnostics: stremioModel.diagnostics,
    } : { idPrefixes: strings(raw.idPrefixes) ? raw.idPrefixes : [] }),
    compatibility,
  };
  return { manifest, compatibility, errors: [] };
}
