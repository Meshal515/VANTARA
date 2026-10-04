import { CONTENT_TYPES, plainObject } from "./contracts.js";

const SUPPORTED = Object.freeze({ catalog: "catalog", meta: "meta", stream: "streams", subtitles: "subtitles" });
export const safeStremioString = (value, max = 160) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const list = (value, max = 50, length = 160) => Array.isArray(value) && value.length <= max && value.every((x) => safeStremioString(x, length));
const prefixList = (value) => Array.isArray(value) && value.length <= 50 && value.every((prefix) => prefix === "" || safeStremioString(prefix));
const typeList = (value) => list(value) && value.every((type) => type !== "." && type !== "..");
const present = (object, name) => Object.prototype.hasOwnProperty.call(object, name);

/** External protocol identifiers remain separate from VANTARA content categories. */
export function normalizeStremioManifest(raw) {
  const errors = [];
  const clone = (value, field, fallback) => {
    try { return structuredClone(value); } catch { errors.push(field); return fallback; }
  };
  if (!typeList(raw.types)) errors.push("types");
  const types = typeList(raw.types) ? [...raw.types] : [];
  if (raw.idPrefixes != null && !prefixList(raw.idPrefixes)) errors.push("idPrefixes");
  const resources = [];
  if (!Array.isArray(raw.resources) || !raw.resources.length || raw.resources.length > 20) errors.push("resources");
  else for (const resource of raw.resources) {
    if (typeof resource === "string" && safeStremioString(resource, 80)) {
      resources.push({ name: resource, types: [...types], ...(raw.idPrefixes != null ? { idPrefixes: [...(prefixList(raw.idPrefixes) ? raw.idPrefixes : [])] } : {}) });
    } else if (plainObject(resource) && safeStremioString(resource.name, 80) && typeList(resource.types) && (resource.idPrefixes == null || prefixList(resource.idPrefixes))) {
      resources.push({ name: resource.name, types: [...resource.types], ...(resource.idPrefixes != null ? { idPrefixes: [...resource.idPrefixes] } : {}) });
    } else errors.push("resources");
  }
  const catalogs = [];
  if (raw.catalogs != null && (!Array.isArray(raw.catalogs) || raw.catalogs.length > 100)) errors.push("catalogs");
  else for (const catalog of raw.catalogs ?? []) {
    if (!plainObject(catalog) || !safeStremioString(catalog.id) || !safeStremioString(catalog.type) || catalog.type === "." || catalog.type === ".." || (catalog.name != null && !safeStremioString(catalog.name))) { errors.push("catalogs"); continue; }
    if (catalog.extra != null && (!Array.isArray(catalog.extra) || catalog.extra.length > 50 || catalog.extra.some((extra) =>
      !plainObject(extra) || !safeStremioString(extra.name, 80) || (extra.isRequired != null && typeof extra.isRequired !== "boolean") || (extra.options != null && !list(extra.options, 1000, 500)) || (extra.optionsLimit != null && (!Number.isInteger(extra.optionsLimit) || extra.optionsLimit < 1 || extra.optionsLimit > 1000))))) errors.push("catalogs");
    for (const name of ["extraSupported", "extraRequired"]) if (catalog[name] != null && !list(catalog[name])) errors.push("catalogs");
    if (catalog.genres != null && !list(catalog.genres, 1000, 500)) errors.push("catalogs");
    const copied = clone(catalog, "catalogs", null);
    if (copied) catalogs.push({ ...copied, extra: catalogExtras(copied) });
  }
  const behaviorHints = plainObject(raw.behaviorHints) ? clone(raw.behaviorHints, "behaviorHints", {}) : {};
  if (raw.behaviorHints != null && !plainObject(raw.behaviorHints)) errors.push("behaviorHints");
  for (const name of ["configurable", "configurationRequired", "adult", "p2p"]) if (behaviorHints[name] != null && typeof behaviorHints[name] !== "boolean") errors.push("behaviorHints");
  if (raw.config != null && (!Array.isArray(raw.config) || raw.config.length > 100 || raw.config.some((item) =>
    !plainObject(item) || !safeStremioString(item.key, 80) || !safeStremioString(item.type, 80) || (item.title != null && !safeStremioString(item.title, 500)) || (item.required != null && typeof item.required !== "boolean") || (item.options != null && !list(item.options, 1000, 500))))) errors.push("config");
  const config = Array.isArray(raw.config) ? clone(raw.config, "config", []) : [];
  const capabilities = [...new Set(resources.filter((r) => present(SUPPORTED, r.name)).map((r) => SUPPORTED[r.name]))];
  if (catalogs.length && !capabilities.includes("catalog")) capabilities.push("catalog");
  const contentTypes = [...new Set([...types, ...resources.flatMap((r) => r.types), ...catalogs.map((c) => c.type)].filter((type) => CONTENT_TYPES.includes(type)))];
  const required = behaviorHints.configurationRequired === true;
  return { errors: [...new Set(errors)], types, resources, catalogs, capabilities, contentTypes, behaviorHints,
    config,
    ...(raw.idPrefixes != null && prefixList(raw.idPrefixes) ? { idPrefixes: [...raw.idPrefixes] } : {}),
    configuration: { required, configurable: behaviorHints.configurable === true, configured: !required },
    diagnostics: { unsupportedResources: [...new Set(resources.map((r) => r.name).filter((name) => !present(SUPPORTED, name)))] },
  };
}

export function matchesStremioResource(manifest, resource, type, id) {
  if (!safeStremioString(type) || type === "." || type === ".." || !safeStremioString(id, 2000)) return false;
  if (resource === "catalog") return manifest.catalogs?.some((c) => c.type === type && c.id === id) ?? false;
  if (!present(SUPPORTED, resource)) return false;
  return manifest.resources?.some((entry) => {
    const rule = typeof entry === "string" ? { name: entry, types: manifest.types, idPrefixes: manifest.idPrefixes } : entry;
    if (rule?.name !== resource || !rule.types?.includes(type)) return false;
    return rule.idPrefixes == null || rule.idPrefixes.some((prefix) => id.startsWith(prefix));
  }) ?? false;
}

export function catalogExtras(catalog) {
  if (Array.isArray(catalog?.extra)) return catalog.extra;
  const required = catalog?.extraRequired ?? [];
  return [...new Set([...(catalog?.extraSupported ?? []), ...required])].map((name) => ({ name, isRequired: required.includes(name), ...(name === "genre" && catalog.genres ? { options: catalog.genres } : {}) }));
}

export class StremioError extends Error {
  constructor(code, resource, { status, name } = {}) {
    const messages = { CONFIG_REQUIRED: "تحتاج الإضافة إلى إعداد قبل الاستخدام", UNSUPPORTED_RESOURCE: "هذه القدرة أو هوية العمل غير مدعومة من الإضافة", REQUIRED_EXTRA: "اختر المرشح المطلوب لهذا الفهرس", INVALID_EXTRA: "مرشحات الفهرس غير صالحة", INVALID_RESPONSE: "الإضافة أعادت بيانات غير صالحة", PROVIDER_ERROR: "تعذر إكمال طلب الإضافة", REQUEST_FAILED: "تعذر الاتصال بالإضافة", TIMEOUT: "انتهت مهلة الإضافة", ABORTED: "ألغي طلب الإضافة" };
    super(messages[code] ?? (status ? `الإضافة أعادت HTTP ${status}` : "تعذر إكمال طلب الإضافة"));
    this.name = name ?? "StremioError";
    this.code = code;
    this.resource = resource;
    if (status) this.status = status;
  }
}
