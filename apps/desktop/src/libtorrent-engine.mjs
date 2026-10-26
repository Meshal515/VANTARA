import { isAbsolute } from 'node:path';

/** Explicit opt-in until the bundled Windows wheel passes the real swarm gate.
 * No shell, system Python lookup, user-site, PYTHONPATH or CWD module imports.
 * The installed embedded runtime additionally pins its module search via _pth.
 */
export function libtorrentCommand({python,script,apiPort,listenPort,dir,stateDir}={}) {
  for(const value of [python,script,dir,stateDir]) {
    if(typeof value!=='string'||!isAbsolute(value)||/[\x00-\x1f\x7f]/.test(value))throw new Error('مسار libtorrent غير صالح');
  }
  for(const value of [apiPort,listenPort])if(!Number.isSafeInteger(value)||value<1||value>65535)throw new Error('منفذ libtorrent غير صالح');
  if(apiPort===listenPort)throw new Error('منافذ libtorrent متعارضة');
  return {executable:python,args:['-I',script,'--api-port',String(apiPort),'--listen-port',String(listenPort),'--download-dir',dir,'--state-dir',stateDir]};
}

export function isolatedPythonEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key])=>!/^PYTHON/i.test(key)));
}
