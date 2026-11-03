import {expect,it,vi} from 'vitest';
import {createDiagnosticsVisibility,webDiagnosticsBridge} from './diagnostics-ui.js';
const setup=(debug=true, saved=false)=>{let pref=saved;const native={diagnostics:vi.fn(async args=>{if(debug && typeof args?.visible==='boolean')pref=args.visible;return {debug,visible:debug&&pref};})};return {ui:createDiagnosticsVisibility(()=>native),native,pref:()=>pref};};
it('defaults to hidden before native build confirmation, including no bridge',async()=>{const ui=createDiagnosticsVisibility(()=>null);expect(ui.visible()).toBe(false);await ui.initialize();expect(ui.available()).toBe(false);expect(ui.visible()).toBe(false);});
it('offers the setting only on confirmed Debug, off by default',async()=>{const {ui}=setup();await ui.initialize();expect(ui.available()).toBe(true);expect(ui.visible()).toBe(false);});
it('saves one device preference through native bridge and restores it on next session',async()=>{const {ui,native,pref}=setup();await ui.initialize();await ui.setVisible(true);expect(pref()).toBe(true);expect(ui.visible()).toBe(true);const next=createDiagnosticsVisibility(()=>native);await next.initialize();expect(next.visible()).toBe(true);});
it('denies Stable even with an old true preference or malformed visible=true response',async()=>{const {ui,native}=setup(false,true);native.diagnostics.mockResolvedValue({debug:false,visible:true});await ui.initialize();await ui.setVisible(true);expect(ui.available()).toBe(false);expect(ui.visible()).toBe(false);expect(native.diagnostics).toHaveBeenCalledTimes(1);});
it('notifies mounted tools for hide/show and allows cleanup',async()=>{const {ui}=setup();await ui.initialize();const update=vi.fn();const off=ui.subscribe(update);await ui.setVisible(true);expect(update).toHaveBeenCalled();off();update.mockClear();await ui.setVisible(false);expect(update).not.toHaveBeenCalled();expect(ui.visible()).toBe(false);});
it('fails closed on unavailable or rejecting native APIs',async()=>{const ui=createDiagnosticsVisibility(()=>({diagnostics:async()=>{throw Error('bridge unavailable')}}));await ui.initialize();await ui.setVisible(true);expect(ui.available()).toBe(false);expect(ui.visible()).toBe(false);});
it('serializes toggles so rapid clicks retain the last preference',async()=>{const {ui,pref}=setup();await ui.initialize();await Promise.all([ui.setVisible(true),ui.setVisible(false)]);expect(pref()).toBe(false);expect(ui.visible()).toBe(false);});

it('uses the baked browser build channel and refuses Stable despite old local storage',async()=>{
 const values=new Map([['vantara.debug.ui.showDiagnostics','true']]);
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 for(const version of ['1.2.3','__VANTARA_VERSION__',null]){
  const ui=createDiagnosticsVisibility(()=>webDiagnosticsBridge(version,storage));await ui.initialize();await ui.setVisible(true);
  expect(ui.available()).toBe(false);expect(ui.visible()).toBe(false);
 }
 const ui=createDiagnosticsVisibility(()=>webDiagnosticsBridge('web-debug-123',storage));await ui.initialize();expect(ui.visible()).toBe(true);await ui.setVisible(false);expect(values.get('vantara.debug.ui.showDiagnostics')).toBe('false');
});
it('keeps browser Debug default-off and survives inaccessible device storage',async()=>{
 const storage={getItem:()=>null,setItem:()=>{throw Error('blocked')}};
 const ui=createDiagnosticsVisibility(()=>webDiagnosticsBridge('web-debug-123',storage));await ui.initialize();expect(ui.available()).toBe(true);expect(ui.visible()).toBe(false);await ui.setVisible(true);expect(ui.visible()).toBe(false);
});
