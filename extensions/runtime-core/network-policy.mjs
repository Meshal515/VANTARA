/** Original experimental host policy. No transport, player, plugin VM or legacy hooks. */
export class NetworkPolicyError extends Error {
  constructor(code, details={}){super(code);this.name='NetworkPolicyError';this.code=code;Object.assign(this,details);}
}
const error=(code,details)=>new NetworkPolicyError(code,details);
const abort=()=>new DOMException('Request cancelled','AbortError');
function endpoint(value){
  if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f]/.test(value))throw error('INVALID_ENDPOINT');
  let url;try{url=new URL(value);}catch{throw error('INVALID_ENDPOINT');}
  const host=url.hostname;
  if(url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||!/[a-z]$/i.test(host)||/\.(local|internal|localhost|lan|invalid|test)$/i.test(host)||!/^[-a-z0-9.]+$/i.test(host))throw error('INVALID_ENDPOINT');
  url.hash='';return url;
}
function retryDelay(value,date,now,fallback){
  if(typeof value!=='string')return fallback;
  if(/^\d+$/.test(value.trim()))return Math.min(Number.MAX_SAFE_INTEGER-now,Number(value)*1000);
  const target=Date.parse(value),server=Date.parse(date);
  if(!Number.isFinite(target))return fallback;
  return Math.max(0,target-(Number.isFinite(server)?server:now));
}
/**
 * The host supplies opaque session IDs, origin permissions and a transport
 * enforcing DNS/IP/TLS/redirect policy. Plugins do not receive this controller.
 * A lease stays occupied until the physical transport settles, even if a
 * caller times out. This intentionally fails closed for non-cooperative I/O.
 */
export function createNetworkPolicy({now=Date.now,maxConcurrentPerHost=1,maxHosts=128,maxChallenges=128,timeoutMs=15000,rateLimitFallbackMs=60000,failureCooldownMs=5000,denialCooldownMs=30000,onVerificationRequired=()=>{}}={}){
  for(const n of [maxConcurrentPerHost,maxHosts,maxChallenges,timeoutMs])if(!Number.isSafeInteger(n)||n<1)throw new RangeError('Invalid policy bound');
  for(const n of [rateLimitFallbackMs,failureCooldownMs,denialCooldownMs])if(!Number.isSafeInteger(n)||n<0)throw new RangeError('Invalid cooldown');
  const hosts=new Map(),challenges=new Map();
  function gate(host){
    if(!hosts.has(host)){
      if(hosts.size>=maxHosts){
        const old=[...hosts].find(([,x])=>x.active===0&&x.retryAt<=now());
        if(!old)throw error('POLICY_CAPACITY');hosts.delete(old[0]);
      }
      hosts.set(host,{active:0,retryAt:0});
    }
    return hosts.get(host);
  }
  async function run(context,request,send){
    if(!context||![context.sourceId,context.sessionId].every(x=>typeof x==='string'&&x.length>0&&x.length<=200)||!Array.isArray(context.allowedOrigins)||!context.allowedOrigins.length||context.allowedOrigins.length>32||typeof send!=='function')throw error('INVALID_CONTEXT');
    if(request?.background===true&&context.allowBackground!==true)throw error('BACKGROUND_DISABLED');
    const url=endpoint(request?.url),origins=context.allowedOrigins.map(x=>endpoint(x).origin);
    if(!origins.includes(url.origin))throw error('ORIGIN_NOT_ALLOWED');
    const method=request.method??'GET';if(!['GET','POST'].includes(method))throw error('METHOD_UNSUPPORTED');
    const sessionId=context.sessionId,sourceId=context.sourceId;
    const sessionKey=JSON.stringify([sessionId,url.origin]);
    const trustedScope=Object.freeze({sessionId,sourceId,family:context.family,packageId:context.packageId,allowedOrigins:Object.freeze([...origins])});
    let headers;try{headers=new Headers(request.headers??{});}catch{throw error('INVALID_REQUEST_HEADERS');}
    let body=request.body;
    if(body!=null){
      if(typeof body==='string'){if(body.length>1048576||new TextEncoder().encode(body).length>1048576)throw error('REQUEST_BODY_LIMIT');}
      else if(body instanceof Uint8Array){if(body.byteLength>1048576)throw error('REQUEST_BODY_LIMIT');body=new Uint8Array(body);}
      else throw error('REQUEST_BODY_UNSUPPORTED');
    }
    if(challenges.has(sessionKey))throw error('VERIFICATION_REQUIRED');
    if(challenges.size>=maxChallenges)throw error('POLICY_CAPACITY');
    const g=gate(url.hostname);
    if(g.active>=maxConcurrentPerHost)throw error('HOST_BUSY');
    if(g.retryAt>now())throw error('HOST_COOLDOWN',{retryAt:g.retryAt});
    if(request.signal?.aborted)throw abort();
    const controller=new AbortController();let timedOut=false,rejectCancelled,timer;
    const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});
    const cancel=()=>{controller.abort();rejectCancelled(abort());};
    request.signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{timedOut=true;controller.abort();rejectCancelled(error('TRANSPORT_TIMEOUT'));},timeoutMs);
    g.active++;
    const physical=Promise.resolve().then(()=>{
      if(controller.signal.aborted)throw abort();
      return send(Object.freeze({url:url.href,method,headers,body,signal:controller.signal}),trustedScope);
    }).then(response=>{
      if(!Number.isInteger(response?.status)||response.status<100||response.status>599)throw error('TRANSPORT_CONTRACT');
      const headers=new Headers(response.headers??{});
      if(headers.get('cf-mitigated')?.trim().toLowerCase()==='challenge'){
        if(!challenges.has(sessionKey)){
          if(challenges.size>=maxChallenges){g.retryAt=Math.max(g.retryAt,now()+rateLimitFallbackMs);throw error('POLICY_CAPACITY');}
          const ticket=crypto.randomUUID();challenges.set(sessionKey,ticket);
          try{onVerificationRequired({ticket,origin:url.origin,sessionId,sourceId});}catch{/* UI observer cannot break admission state. */}
        }
        throw error('VERIFICATION_REQUIRED');
      }
      if(response.status===429){
        g.retryAt=Math.max(g.retryAt,now()+retryDelay(headers.get('retry-after'),headers.get('date'),now(),rateLimitFallbackMs));
        throw error('RATE_LIMITED',{retryAt:g.retryAt});
      }
      if(response.status===403){g.retryAt=Math.max(g.retryAt,now()+denialCooldownMs);throw error('ACCESS_DENIED');}
      if(response.status>=500){g.retryAt=Math.max(g.retryAt,now()+failureCooldownMs);throw error('HTTP_SERVER_ERROR');}
      if(response.url&&!origins.includes(endpoint(response.url).origin))throw error('REDIRECT_POLICY');
      return response;
    }).catch(cause=>{
      if(cause instanceof NetworkPolicyError)throw cause;
      if(controller.signal.aborted)throw timedOut?error('TRANSPORT_TIMEOUT'):abort();
      g.retryAt=Math.max(g.retryAt,now()+failureCooldownMs);throw error('TRANSPORT_FAILED');
    }).finally(()=>{g.active--;});
    // The race attaches a rejection handler even after caller cancellation.
    try{return await Promise.race([physical,cancelled]);}
    finally{clearTimeout(timer);request.signal?.removeEventListener('abort',cancel);}
  }
  return Object.freeze({run,
    completeVerification(ticket){
      if(typeof ticket!=='string')return false;
      for(const [key,value]of challenges)if(value===ticket){challenges.delete(key);return true;}
      return false;
    },
  });
}
