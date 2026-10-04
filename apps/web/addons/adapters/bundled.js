/** Facade فوق المصدر المشحون؛ لا parser جديد ولا تغيير لشكل memo. */
export function createBundledAdapter({ sourceDef, engine }) {
  const invoke = (name, ...args) =>
    engine.call(sourceDef.id, (s) => {
      if (!s[name]) throw new Error("القدرة غير متاحة من هذا المصدر");
      return s[name](...args);
    });
  return {
    search: (...a) => invoke("search", ...a),
    home: (...a) => invoke("latest", ...a),
    popular: (...a) => invoke("popular", ...a),
    latest: (...a) => invoke("latest", ...a),
    series: (...a) => invoke("series", ...a),
    pages: (...a) => invoke("pages", ...a),
    episodes: (...a) => invoke("episodes", ...a),
    servers: (...a) => invoke("servers", ...a),
    streams: (...a) => invoke("streams", ...a),
  };
}
