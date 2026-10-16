import {expect,it,vi,afterEach} from 'vitest';
import {parseHTML} from 'linkedom';
afterEach(()=>vi.unstubAllGlobals());
it('exposes second/ten-second adjustments, signed current difference, reset and offset bounds',async()=>{
  const {document}=parseHTML('<html><body></body></html>');vi.stubGlobal('document',document);
  const {createVideoOffsetControls}=await import('./offset-controls.js');expect(typeof createVideoOffsetControls).toBe('function');
  let value=0;const commands=[];const controls=createVideoOffsetControls({getOffset:()=>value,setOffset:ms=>{value=ms;commands.push(ms);return true;}});
  const buttons=[...controls.querySelectorAll('button')];expect(buttons.map(b=>b.textContent)).toEqual(['−10ث','−1ث','+1ث','+10ث','تصفير']);
  buttons[3].onclick();expect(value).toBe(10000);expect(controls.textContent).toContain('+10 ثانية');
  buttons[4].onclick();expect(value).toBe(0);value=120000;controls.refresh();expect(buttons[3].disabled).toBe(true);
  value=-120000;controls.refresh();expect(buttons[0].disabled).toBe(true);
});
