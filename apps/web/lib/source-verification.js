import { desktopPlugin } from '../pwa/platform.js';
/** Explicit verification UI. Background events never launch native Activities. */
const validHost = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) && value.includes('.') && !/^\d+(?:\.\d+){3}$/.test(value) && !/\.(?:local|internal|localhost|invalid|lan)$/i.test(value);
// Native reason codes stay available for diagnostics; only these local messages
// enter the UI. Never echo a source URL, bridge exception or cookie value.
export function verificationMessage(result={}) {
  // «إلغاء» من المستخدم وحده يقال إلغاءً؛ إغلاق الصفحة لسبب آخر يقول سببه
  if(result.state==='cancelled'&&(!result.reason||result.reason==='user_cancelled'))return 'أُلغي التحقق. تقدر تحاول مرة ثانية.';
  const messages={
    unsupported_webview:'إصدار Android لا يدعم صفحة التحقق المعزولة. استخدم مصدرًا آخر.',
    unsupported_profile:'حدّث Android System WebView لدعم جلسة تحقق منفصلة لهذا المصدر. بقيت جلساتك محفوظة.',
    isolation_unavailable:'تعذّر عزل صفحة التحقق بأمان. بقيت جلساتك محفوظة.',
    renderer_gone:'توقفت صفحة التحقق. بقي المصدر مثبتًا وتقدر تعيد المحاولة يدويًا.',
    webview_unavailable:'تعذّر فتح صفحة التحقق. تحقق من تحديث Android System WebView.',
    timeout:'انتهت مهلة التحقق. تقدر تعيد المحاولة يدويًا.',
    network_error:'تعذّر تحميل صفحة التحقق من المصدر. حاول لاحقًا.',
    tls_error:'تعذّر تأمين الاتصال بالمصدر بسبب شهادة الموقع.',
    navigation_blocked:'انتقلت صفحة التحقق إلى نطاق آخر؛ أُوقفت لحماية جلستك.',
    unsafe_endpoint:'عنوان صفحة التحقق غير مدعوم بأمان.',
    invalid_endpoint:'عنوان صفحة التحقق غير صالح.',
    cookie_rejected:'اكتمل عرض التحقق، لكن تعذّر حفظ جلسته.',
    cookie_store_unavailable:'تعذّر حفظ جلسة التحقق. لم تُحذف جلساتك الحالية.',
    launch_failed:'تعذّر فتح صفحة التحقق. تقدر تعيد المحاولة يدويًا.',
    interrupted:'توقفت جلسة التحقق قبل اكتمالها.',
    proxy_unavailable:'تعذّر فتح مسار شبكة المصدر لصفحة التحقق. حدّث Android System WebView.',
    still_challenged:'الموقع لم يقبل التحقق بعد. افتحه مرة ثانية وأكمل التحدي حتى تظهر صفحة الموقع.',
    // الحكم الأخير من الموقع نفسه (طلب المحرك بعد نقل الجلسة)، لا من إغلاق الصفحة
    unconfirmed:'اكتمل التحقق في الصفحة، لكن تعذّر الوصول إلى الموقع للتأكد من قبوله. أعد المحاولة بعد قليل.',
    no_clearance:'فتح الموقع في صفحة التحقق دون أن يصدر جلسة تحقق، فلا شيء يُنقل للمحرك. قد يرفض الموقع المحرك ببصمة الاتصال لا بالكوكي.',
    no_session_cookie:'لم تُصدر صفحة التحقق أي جلسة يمكن نقلها للمحرك.',
    cookie_scope_mismatch:'انتهت صفحة التحقق على موقع آخر؛ لم تُنقل جلستها حماية لحسابك.',
  };
  return Object.hasOwn(messages,result.reason)?messages[result.reason]:'لم يكتمل التحقق. تقدر تحاول مرة ثانية.';
}
export function nativeVerificationPlugin() {
  // ويندوز: الإضافة نفسها بشكلها من جسر سطح المكتب (desktop/boot.js) وصفحة تحقق ظاهرة من العملية الرئيسية
  if (globalThis.Capacitor?.getPlatform?.() === 'android') return globalThis.Capacitor?.Plugins?.Verification ?? null;
  return desktopPlugin('Verification');
}
export function isSourceChallenge(error) {
  const code = String(error?.code ?? '');
  return error?.needsHuman === true || error?.data?.needsHuman === true
    || ['VERIFICATION_REQUIRED', 'SITE_VERIFICATION'].includes(code)
    || /(?:^|\.)CloudflareBypassException$/.test(code) && (!error?.message || /^Cloudflare wants a human check for /i.test(error.message));
}

export function createSourceVerification({plugin=nativeVerificationPlugin(),runtimePlugin=globalThis.Capacitor?.Plugins?.VantaraRuntime}={}) {
  let closed = false;
  const pending = new Map(), active = new Map(), handles = [], listeners = new Set();
  const snapshot = () => [...pending.values()].map(({retry, ...item}) => ({...item}));
  function render() {
    if (closed) return;
    const rows = snapshot();
    for (const listener of listeners) {
      try { listener(rows); } catch { /* Observers cannot break verification. */ }
    }
  }
  function require(item) {
    if (closed || !validHost(item?.host)) return;
    const host = item.host.toLowerCase(), previous = pending.get(host), job = active.get(host);
    if (job?.replaying && item.state === 'required') { job.rechallenged = true; return; }
    if (!previous && pending.size >= 24) pending.delete(pending.keys().next().value);
    pending.set(host, {
      ...previous, ...item, host, verifying: !!job || item.state === 'active',
      message: ['expired', 'failed', 'cancelled'].includes(item.state) ? verificationMessage(item) : null,
    });
    render();
  }
  function begin(host, { retry } = {}) {
    host = String(host).toLowerCase();
    if (active.has(host)) return active.get(host).promise;
    const item = pending.get(host);
    if (closed || !plugin || !item) return Promise.resolve({ok:false,error:'التحقق غير متاح لهذا المصدر'});
    if (active.size) return Promise.resolve({ok:false,error:'تحقق آخر مفتوح الآن. أكمله ثم أعد المحاولة.'});
    const job = { replaying: false, rechallenged: false };
    const failed = (reason) => {
      require({...item,state:'failed',reason});
      return {ok:false,state:'failed',reason,error:verificationMessage({reason})};
    };
    job.promise = Promise.resolve().then(async () => {
      try {
        const privateRuntime = item.kind === 'cloudstream';
        const result = privateRuntime
          ? await (runtimePlugin?.verify?.({host}) ?? Promise.reject(new Error('Private verification unavailable')))
          : await plugin.begin({host});
        if (closed || job.discarded) return {ok:false,cancelled:true};
        if (result?.host !== host || result?.state !== 'verified' || privateRuntime && result.ok !== true) {
          const failure = result?.host === host && result.state !== 'verified' ? result : {state:'failed',reason:'invalid_result'};
          require({...item,state:failure.state,reason:failure.reason});
          return {...failure,ok:false,error:verificationMessage(failure)};
        }
        // CloudStream already replays its scoped operation on the native bridge.
        // A foreground consumer may reuse that result or restore a different operation.
        const resume = retry ?? (!privateRuntime ? item.retry : null);
        if (!resume) {
          pending.delete(host);
          // «verified» من المحرك يعني أن الموقع قبل الطلب المرفوض نفسه بعد نقل الجلسة (VerificationPlugin.confirm)
          return privateRuntime ? result : {ok:true,confirmed:true,...result};
        }
        job.replaying = true;
        let retried;
        try { retried = await resume(result); }
        catch (error) {
          if (closed || job.discarded) return {ok:false,cancelled:true};
          if (job.rechallenged || isSourceChallenge(error)) return failed('still_challenged');
          pending.delete(host);
          return {ok:false,verified:true,error:'اكتمل التحقق، لكن تعذّر إعادة تحميل المحتوى'};
        }
        if (closed || job.discarded) return {ok:false,cancelled:true};
        if (job.rechallenged || retried?.needsHuman) return failed('still_challenged');
        pending.delete(host);
        return retried ?? {ok:true,...result};
      } catch (error) {
        if (closed || job.discarded) return {ok:false,cancelled:true};
        return failed(isSourceChallenge(error) ? 'still_challenged' : error?.code === 'VERIFICATION_NOT_PENDING' ? 'timeout' : 'launch_failed');
      } finally {
        active.delete(host);
        const latest = pending.get(host);
        if (latest) latest.verifying = false;
        render();
      }
    });
    active.set(host, job);
    require({...item});
    return job.promise;
  }
  function state(item) {
    if (closed || !validHost(item?.host)) return;
    if (item.state === 'discarded') {
      const host = item.host.toLowerCase();
      const job = active.get(host);
      if (job) job.discarded = true;
      pending.delete(host);
      render();
    } else if (item.state === 'verified') {
      const host = item.host.toLowerCase();
      if (!active.has(host)) { pending.delete(host); render(); }
    } else if (['active', 'required', 'expired', 'failed', 'cancelled'].includes(item.state)) require(item);
  }
  async function refresh() {
    if (!plugin || closed) return;
    try {
      const out = await plugin.pending();
      for (const item of out?.pending ?? []) {
        const previous = pending.get(item.host);
        if (!previous || previous.token !== item.token) require(item);
      }
    } catch { /* The previous observation remains visible if the bridge is unavailable. */ }
  }
  async function beginSource({host, domains = [], sourceId, sourceName, retry, isActive = () => true} = {}) {
    await ready;
    await refresh();
    if (!isActive()) return {ok:false,cancelled:true};
    const hosts = new Set(domains.map(value => {
      try { return new URL(value?.url ?? value).hostname.toLowerCase(); } catch { return null; }
    }).filter(Boolean));
    const rows = snapshot();
    const byId = sourceId ? rows.filter(item => item.sourceId === sourceId) : [];
    const byName = sourceName ? rows.filter(item => item.sourceName?.trim().toLowerCase() === sourceName.trim().toLowerCase()) : [];
    const item = host ? pending.get(String(host).toLowerCase()) : byId.length === 1 ? byId[0]
      : rows.find(row => hosts.has(row.host) && (!row.sourceId || row.sourceId === sourceId)) ?? (byName.length === 1 ? byName[0] : null);
    if (!item) return {ok:false,error:'لا يوجد طلب تحقق مسجّل لهذا المصدر الآن.'};
    return begin(item.host, {retry});
  }
  const ready = (async () => {
    if (!plugin) return;
    await Promise.all(['required','state'].map(async name => {
      try {
        const handle = await plugin.addListener(name,name === 'required' ? require : state);
        if (closed) await handle?.remove?.(); else handles.push(handle);
      } catch { /* Optional old bridge. */ }
    }));
    await refresh();
  })();
  return {
    ready,require,begin,beginSource,list:snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function' || closed) return () => {};
      listeners.add(listener);
      try { listener(snapshot()); } catch {}
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      pending.clear(); listeners.clear();
      for (const handle of handles) void Promise.resolve(handle?.remove?.()).catch(() => {});
      handles.length = 0;
    },
  };
}

/** Existing anime Verify button: choose the exact source domain, then one retry. */
export async function verifySourceDomains({domains,sourceName,retry,plugin=nativeVerificationPlugin(),runtimePlugin=globalThis.Capacitor?.Plugins?.VantaraRuntime}={}) {
  if(!plugin)return {ok:false,error:'التحقق داخل التطبيق يحتاج نسخة Android محدثة'};
  try{
    const hosts=new Set((domains??[]).map(url=>{try{return new URL(url).hostname.toLowerCase();}catch{return null;}}).filter(Boolean));
    const out=await plugin.pending(),match=(out?.pending??[]).find(x=>hosts.has(x.host));
    if(!match)return {ok:false,error:'لا يوجد تحدي تحقق مسجّل لهذا المصدر. أعد فحصه أولًا.'};
    const result=match.kind==='cloudstream'
      ? await (runtimePlugin?.verify?.({host:match.host}) ?? Promise.reject(new Error('Private verification unavailable')))
      : await plugin.begin({host:match.host});
    if(result?.host!==match.host||result?.state!=='verified')return {ok:false,error:verificationMessage(result?.host===match.host?result:{})};
    return match.kind!=='cloudstream'&&typeof retry==='function'?await retry():{ok:true};
  }catch{return {ok:false,error:`تعذّر التحقق من ${sourceName||'المصدر'}`};}
}
