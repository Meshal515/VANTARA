import {describe,it,expect,vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createSourceVerification,verifySourceDomains} from './source-verification.js';

function fixture(){
  const {document}=parseHTML('<html><body><main>المحتوى الأصلي</main></body></html>');
  const listeners=new Map(), removers=[];
  const plugin={
    pending:vi.fn(async()=>({pending:[]})),
    addListener:vi.fn((name,fn)=>{
      listeners.set(name,fn);
      const remove=vi.fn();removers.push(remove);
      return Promise.resolve({remove});
    }),
    begin:vi.fn(async({host})=>({host,state:'verified'})),
  };
  return {document,plugin,listeners,removers};
}

describe('explicit source verification without unsolicited overlay',()=>{
  it('never routes a private runtime challenge to the legacy shared-cookie verifier',async()=>{
    const f=fixture(),retry=vi.fn(),runtimePlugin={verify:vi.fn(async({host})=>({host,state:'verified',ok:true}))};
    const c=createSourceVerification({...f,runtimePlugin});await c.ready;
    c.require({host:'source.example',kind:'cloudstream',state:'required',retry});
    expect(f.plugin.begin).not.toHaveBeenCalled();
    expect(await c.begin('source.example')).toMatchObject({ok:true});
    expect(runtimePlugin.verify).toHaveBeenCalledWith({host:'source.example'});expect(f.plugin.begin).not.toHaveBeenCalled();expect(retry).not.toHaveBeenCalled();c.close();
  });
  it('keeps a private challenge pending when its private bridge is absent',async()=>{
    const f=fixture(),c=createSourceVerification({...f,runtimePlugin:null});await c.ready;
    c.require({host:'source.example',kind:'cloudstream',state:'required'});
    expect(await c.begin('source.example')).toMatchObject({ok:false});expect(f.plugin.begin).not.toHaveBeenCalled();expect(c.list()).toHaveLength(1);c.close();
  });
  it('keeps an expired challenge pending silently until explicit verification succeeds',async()=>{
    const f=fixture(),c=createSourceVerification(f);await c.ready;
    c.require({host:'source.example',state:'required'});
    f.listeners.get('state')({host:'source.example',state:'expired',reason:'timeout'});
    expect(c.list()).toMatchObject([{host:'source.example',state:'expired'}]);
    expect(f.document.body.textContent).toBe('المحتوى الأصلي');
    expect(f.plugin.begin).not.toHaveBeenCalled();c.close();
  });
  it('does not recreate a verification challenge when the one content retry fails',async()=>{
    const f=fixture(),c=createSourceVerification(f);await c.ready;
    c.require({host:'source.example',retry:async()=>{throw new Error('content timeout');}});
    expect(await c.begin('source.example')).toMatchObject({ok:false,verified:true});
    expect(c.list()).toEqual([]);expect(f.plugin.begin).toHaveBeenCalledTimes(1);c.close();
  });
  it('verifies only the exact source domain and retries once without opening another source',async()=>{
    const f=fixture(),retry=vi.fn(async()=>({ok:true}));
    f.plugin.pending.mockResolvedValue({pending:[{host:'other.example'},{host:'source.example'}]});
    expect(await verifySourceDomains({plugin:f.plugin,domains:['https://source.example/path'],retry})).toEqual({ok:true});
    expect(f.plugin.begin).toHaveBeenCalledWith({host:'source.example'});expect(retry).toHaveBeenCalledTimes(1);
    f.plugin.begin.mockClear();retry.mockClear();
    await verifySourceDomains({plugin:f.plugin,domains:['https://sub.source.example'],retry});
    expect(f.plugin.begin).not.toHaveBeenCalled();expect(retry).not.toHaveBeenCalled();
  });
  it('records background verification requests without altering the screen or starting a browser',async()=>{
    const f=fixture(),c=createSourceVerification(f);await c.ready;
    const changes=[],unsubscribe=c.subscribe(rows=>changes.push(rows));
    f.listeners.get('required')({host:'source.example',sourceName:'مصدر',state:'required'});
    expect(f.plugin.begin).not.toHaveBeenCalled();
    expect(f.document.body.textContent).toBe('المحتوى الأصلي');
    expect(f.document.querySelector('[data-source-verification]')).toBeNull();
    expect(c.list()).toMatchObject([{host:'source.example',sourceName:'مصدر'}]);
    expect(changes.at(-1)).toHaveLength(1);
    unsubscribe();c.close();
  });
  it('launches the WebView only from an explicit begin action and retries once',async()=>{
    const f=fixture(),retry=vi.fn(),c=createSourceVerification(f);await c.ready;
    c.require({host:'source.example',sourceName:'مصدر',retry});
    await Promise.all([c.begin('source.example'),c.begin('source.example')]);
    expect(f.plugin.begin).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(c.list()).toEqual([]);
    c.close();
  });
  it('does not retry a cancelled or failed verification',async()=>{
    const f=fixture(),retry=vi.fn();
    f.plugin.begin.mockResolvedValue({host:'source.example',state:'cancelled'});
    const c=createSourceVerification(f);await c.ready;
    c.require({host:'source.example',retry});
    await c.begin('source.example');
    expect(retry).not.toHaveBeenCalled();
    expect(c.list()[0].message).toContain('أُلغي');
    c.close();
  });
  it('retains the precise native failure without retrying content or changing the screen',async()=>{
    const f=fixture(),retry=vi.fn();
    f.plugin.begin.mockResolvedValue({host:'source.example',state:'failed',reason:'unsupported_webview'});
    const c=createSourceVerification(f);await c.ready;c.require({host:'source.example',retry});
    const result=await c.begin('source.example');
    expect(result.error).toContain('إصدار Android');
    expect(c.list()[0]).toMatchObject({reason:'unsupported_webview',message:result.error});
    expect(retry).not.toHaveBeenCalled();expect(f.plugin.begin).toHaveBeenCalledOnce();
    expect(f.document.body.textContent).toBe('المحتوى الأصلي');c.close();
  });
  it('explains background renderer failure silently and retains the source for manual retry',async()=>{
    const f=fixture(),c=createSourceVerification(f);await c.ready;
    f.listeners.get('state')({host:'source.example',state:'failed',reason:'renderer_gone'});
    expect(c.list()[0].message).toContain('صفحة التحقق');
    expect(f.plugin.begin).not.toHaveBeenCalled();
    expect(f.document.body.textContent).toBe('المحتوى الأصلي');c.close();
  });
  it('never registers malformed or private hosts',async()=>{
    const f=fixture(),c=createSourceVerification(f);await c.ready;
    for(const host of ['<img onerror=x>','127.0.0.1','localhost','source.example/path','https://source.example'])c.require({host});
    expect(c.list()).toHaveLength(0);
    expect(f.document.querySelector('[data-source-verification]')).toBeNull();
    c.close();
  });
  it('removes listeners, clears observers and ignores late bridge events',async()=>{
    const f=fixture();let resolve;
    f.plugin.pending.mockReturnValue(new Promise(r=>resolve=r));
    const c=createSourceVerification(f);const changed=vi.fn();c.subscribe(changed);
    c.close();resolve({pending:[{host:'source.example'}]});await c.ready;
    expect(c.list()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(f.removers.every(r=>r.mock.calls.length===1)).toBe(true);
  });
  it('isolates bridge failures without a global toast or unhandled rejection',async()=>{
    const f=fixture();f.plugin.pending.mockRejectedValue(new Error('bridge unavailable'));
    f.plugin.begin.mockRejectedValue(new Error('renderer terminated'));
    const c=createSourceVerification(f);await c.ready;
    c.require({host:'source.example'});
    await expect(c.begin('source.example')).resolves.toMatchObject({ok:false});
    expect(c.list()[0].message).toContain('تعذّر');
    expect(f.document.body.textContent).toBe('المحتوى الأصلي');
    c.close();
  });
});

it('never exposes another host verification as success to the caller',async()=>{
 const f=fixture(),retry=vi.fn();f.plugin.begin.mockResolvedValue({host:'other.example',state:'verified',ok:true});
 const c=createSourceVerification(f);await c.ready;c.require({host:'source.example',retry});
 const result=await c.begin('source.example');
 expect(result.ok).toBe(false);expect(result.state).toBe('failed');
 expect(c.list()).toMatchObject([{host:'source.example'}]);expect(retry).not.toHaveBeenCalled();c.close();
});
