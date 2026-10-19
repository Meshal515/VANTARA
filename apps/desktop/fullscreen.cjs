// Electron owns fullscreen for the app, native video and transparent controls.
// Prevent the focused child window or the menu default from toggling separately.
function createWindowFullscreen({window,layout=()=>{},onState=()=>{}}) {
  const set=enabled=>{
    if(typeof enabled!=='boolean')throw new Error('طلب ملء الشاشة غير صالح');
    window.setFullScreen(enabled);
    return true;
  };
  const toggle=()=>set(!window.isFullScreen());
  const bindInput=target=>target.webContents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown'||input.key!=='F11')return;
    event.preventDefault();
    if(!input.isAutoRepeat)toggle();
  });
  const changed=()=>{layout();onState(window.isFullScreen());};
  window.on?.('enter-full-screen',changed);
  window.on?.('leave-full-screen',changed);
  bindInput(window);
  return {set,toggle,bindInput};
}
module.exports={createWindowFullscreen};
