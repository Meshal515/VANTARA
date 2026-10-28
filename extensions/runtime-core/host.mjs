/** Original repository-only coordinator. Executors/VMs are explicit host dependencies. */
import {createNetworkPolicy,NetworkPolicyError} from './network-policy.mjs';
const operations=Object.freeze({
 cloudstream:['catalogue','search','details','episodes','videoLinks'],
 aniyomi:['catalogue','search','details','episodes','videoLinks'],
 mihon:['catalogue','search','details','chapters','pages'],
});
export class CompatibilityError extends Error{
 constructor(code,owner='runtime'){super(code);this.name='CompatibilityError';this.code=code;this.owner=owner;}
}
const bad=(code,owner)=>new CompatibilityError(code,owner);
const opaque=x=>typeof x==='string'&&x.length>0&&x.length<=200;
function identity(ref){
 if(!ref||!Object.hasOwn(operations,ref.family)||![ref.packageId,ref.sourceId].every(opaque))throw bad('INVALID_SOURCE');
 return JSON.stringify([ref.family,ref.packageId,ref.sourceId]);
}
function validId(x){return typeof x==='string'&&x.trim().length>0||Number.isSafeInteger(x);}
function webResource(x){
 try{const u=new URL(x);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
}
function validate(op,result){
 if(!result||typeof result!=='object'||Array.isArray(result)||result.error)throw bad('RUNTIME_CONTRACT');
 if(op==='details'){
  if(!result.item||!validId(result.item.id)||typeof result.item.title!=='string'||!result.item.title.trim())throw bad('RUNTIME_CONTRACT');
  return 'returned_details';
 }
 if(!Array.isArray(result.items)||result.items.length>5000)throw bad('RUNTIME_CONTRACT');
 for(const item of result.items){
  if(!item||typeof item!=='object'||Array.isArray(item))throw bad('RUNTIME_CONTRACT');
  if(['videoLinks','pages'].includes(op)){if(typeof item.url!=='string'||!webResource(item.url))throw bad('RUNTIME_CONTRACT');}
  else if(!validId(item.id)||(['catalogue','search'].includes(op)&&(typeof item.title!=='string'||!item.title.trim())))throw bad('RUNTIME_CONTRACT');
 }
 return result.items.length?'returned_items':'empty';
}
export function createCompatibilityHost({networkPolicy=createNetworkPolicy(),transport}={}){
 const records=new Map();
 function register(descriptor,backend){
  const key=identity(descriptor);
  if(records.has(key))throw bad('ALREADY_REGISTERED');
  if(!opaque(descriptor.version)||!opaque(descriptor.sessionId)||!Array.isArray(descriptor.allowedOrigins)||!descriptor.allowedOrigins.length||!opaque(backend?.profile)||!backend.operations||typeof backend.operations!=='object')throw bad('INVALID_BACKEND');
  const calls=new Map();
  for(const [name,value]of Object.entries(backend.operations)){
   if(!operations[descriptor.family].includes(name)||typeof value!=='function')throw bad('CAPABILITY_UNSUPPORTED');
   calls.set(name,value.bind(backend));
  }
  if(!calls.size)throw bad('INVALID_BACKEND');
  const context=Object.freeze({family:descriptor.family,packageId:descriptor.packageId,sourceId:descriptor.sourceId,sessionId:descriptor.sessionId,allowedOrigins:Object.freeze([...descriptor.allowedOrigins]),allowBackground:descriptor.allowBackground===true});
  records.set(key,{ref:Object.freeze({family:descriptor.family,packageId:descriptor.packageId,sourceId:descriptor.sourceId,version:descriptor.version}),context,calls,profile:backend.profile,state:'registered_unchecked',checks:new Map()});
  return key;
 }
 async function invoke(ref,operation,args={},options={}){
  const row=records.get(identity(ref));if(!row)throw bad('SOURCE_NOT_REGISTERED');
  if(ref.sessionId!==row.context.sessionId)throw bad('SESSION_MISMATCH');
  const run=row.calls.get(operation);if(!run)throw bad('CAPABILITY_UNSUPPORTED');
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  // A private origin/session-bound request capability, never the policy's
  // verification ticket controller or the account/session stores.
  const access=Object.freeze({signal:options.signal,request:request=>{if(typeof transport!=='function')return Promise.reject(bad('TRANSPORT_UNAVAILABLE'));return networkPolicy.run(row.context,{...request,background:options.background===true,signal:options.signal},transport);}});
  try{
   const result=await run(args,access);
   if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
   row.lastResult=validate(operation,result);row.lastOperation=operation;delete row.lastError;row.checks.set(operation,{state:row.lastResult});
   return result;
  }catch(cause){
   if(cause?.name==='AbortError')throw cause;
   let failure;
   if(cause instanceof NetworkPolicyError){failure=bad(cause.code,'network');if(cause.retryAt!==undefined)failure.retryAt=cause.retryAt;}
   else if(cause instanceof CompatibilityError)failure=cause;
   else failure=bad(['ABI_MISMATCH','PROCESS_DIED'].includes(cause?.code)?cause.code:'RUNTIME_FAILED');
   row.lastResult='error';row.lastOperation=operation;row.lastError={code:failure.code,owner:failure.owner};row.checks.set(operation,{state:'error',...row.lastError});throw failure;
  }
 }
 return Object.freeze({register,invoke,list:()=>[...records.values()].map(r=>({...r.ref,profile:r.profile,capabilities:[...r.calls.keys()],state:r.state,checks:structuredClone(Object.fromEntries(r.checks)),...(r.lastResult?{lastOperation:r.lastOperation,lastResult:r.lastResult}:{}),...(r.lastError?{lastError:{...r.lastError}}:{})}))});
}
