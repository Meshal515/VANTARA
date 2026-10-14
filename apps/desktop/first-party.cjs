const ORIGIN='https://vantara-sync.ngm-309.workers.dev';
exports.firstPartyRequest=async function({url,method='GET',headers={},body=null,bodyBase64=null}={},fetchImpl){
  const target=new URL(url);
  if(target.origin!==ORIGIN||target.username||target.password||!target.pathname.startsWith('/v1/')||!['GET','POST','PATCH','PUT','DELETE'].includes(method))throw new Error('طلب الحساب ليس إلى خادم فانتارا');
  if(body!=null&&(typeof body!=='string'||Buffer.byteLength(body)>4*1024*1024)||method==='GET'&&body!=null)throw new Error('بيانات حساب غير صالحة');
  if(bodyBase64!=null){
    if(body!=null||method==='GET'||typeof bodyBase64!=='string'||bodyBase64.length>6*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(bodyBase64))throw new Error('بيانات صورة الحساب غير صالحة');
    body=Buffer.from(bodyBase64,'base64');if(body.length>4*1024*1024)throw new Error('صورة الحساب أكبر من الحد');
  }
  const checked={};
  for(const [key,value]of Object.entries(headers)){
    if(!['authorization','content-type','accept','x-vantara-device-id'].includes(key.toLowerCase())||typeof value!=='string'||value.length>16000||/[\x00-\x1f\x7f]/.test(value))throw new Error('رؤوس حساب غير صالحة');
    checked[key.toLowerCase()]=value;
  }
  const response=await fetchImpl(target.href,{method,headers:checked,...(body!=null?{body}:{}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]){size+=chunk.byteLength;if(size>8*1024*1024)throw new Error('استجابة الحساب أكبر من الحد');chunks.push(Buffer.from(chunk));}
  return{status:response.status,text:Buffer.concat(chunks).toString('utf8'),headers:{'content-type':response.headers.get('content-type')??'application/json'}};
};
