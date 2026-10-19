const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createWindowFullscreen}=require('./fullscreen.cjs');
function fixture(){
 const window=new EventEmitter();window.webContents=new EventEmitter();window.enabled=false;
 window.isFullScreen=()=>window.enabled;window.setFullScreen=enabled=>{window.enabled=enabled;};
 const states=[],layouts=[];
 const controller=createWindowFullscreen({window,layout:()=>layouts.push(window.enabled),onState:enabled=>states.push(enabled)});
 return {window,controller,states,layouts};
}
test('fullscreen transitions update both surfaces and publish native window state',()=>{
 const f=fixture();f.controller.set(true);f.window.emit('enter-full-screen');
 assert.deepEqual(f.states,[true]);assert.deepEqual(f.layouts,[true]);
 f.controller.toggle();f.window.emit('leave-full-screen');
 assert.deepEqual(f.states,[true,false]);assert.deepEqual(f.layouts,[true,false]);
 assert.throws(()=>f.controller.set('true'),/غير صالح/);
});
test('F11 from main or focused controls toggles the parent once and suppresses Electron default handling',()=>{
 const f=fixture(),overlay={webContents:new EventEmitter()};f.controller.bindInput(overlay);
 let prevented=0;const event={preventDefault(){prevented++;}};
 overlay.webContents.emit('before-input-event',event,{type:'keyDown',key:'F11'});
 assert.equal(f.window.enabled,true);assert.equal(prevented,1);
 overlay.webContents.emit('before-input-event',event,{type:'keyDown',key:'F11',isAutoRepeat:true});
 assert.equal(f.window.enabled,true);assert.equal(prevented,2);
 f.window.webContents.emit('before-input-event',event,{type:'keyDown',key:'F11'});
 assert.equal(f.window.enabled,false);assert.equal(prevented,3);
 f.window.webContents.emit('before-input-event',event,{type:'keyDown',key:'Escape'});
 assert.equal(prevented,3);
});
test('native video focus sends F11 to the app instead of mpv fullscreen',()=>{
 const text=require('node:fs').readFileSync(require('node:path').join(__dirname,'native-host/input.conf'),'utf8');
 assert.match(text,/^F11 script-message vantara-fullscreen$/m);
 assert.match(text,/^ESC script-message vantara-back$/m);
});
