/** Optional Android worker bridge. Repository parsing never grants DEX support to PWA/Windows. */
export const isNativeRuntimeCopy = copy => !String(copy?.sourceId ?? '').startsWith('addon|') || String(copy?.sourceId ?? '').startsWith('addon|cs3|cs3_');

export async function createCloudStreamRepositories(plugin) {
  if (!plugin?.capabilities) return null;
  const measured = await plugin.capabilities();
  if (measured?.cloudstream !== true || measured?.platform !== 'android') return null;
  const required=['setProfile','list','addRepository','removeRepository','extensions','install','uninstall','enable'];
  if (required.some(method => typeof plugin[method] !== 'function')) return null;
  return {
    family:'cloudstream',
    setProfile: profile => plugin.setProfile({profile}),
    list: () => plugin.list(),
    add: async url => ({repo:await plugin.addRepository({url})}),
    remove: url => plugin.removeRepository({url}),
    extensions: async url => {
      const result=await plugin.extensions({url});
      if (!Array.isArray(result?.extensions)) throw new Error('لم يُرجع المحرك فهرس إضافات صالحًا.');
      return result.extensions;
    },
    install: (url,pkg,content='anime') => plugin.install({url,pkg,content}),
    uninstall: pkg => plugin.uninstall({pkg}),
    enable: (pkg,enabled) => plugin.enable({pkg,enabled}),
    verify: async host => {
      if(!plugin.verificationPending || !plugin.verify)return null;
      const pending=await plugin.verificationPending();
      return pending?.hosts?.includes(host) ? plugin.verify({host}) : null;
    },
  };
}
