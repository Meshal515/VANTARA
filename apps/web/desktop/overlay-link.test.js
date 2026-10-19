import {expect,it,vi} from 'vitest';
import {createOverlayLink} from './overlay-link.js';
it('closes a native overlay that finishes opening after its player has been dismissed',async()=>{
 let opened;
 const bridge={playerOverlay:vi.fn(args=>args.open?new Promise(resolve=>opened=resolve):Promise.resolve(true)),onOverlayCommand:()=>()=>{}};
 const link=createOverlayLink({bridge,session:'old',snapshot:()=>({}),onCommand:()=>{}});
 const pending=link.open();link.close();opened(true);
 expect(await pending).toBe(false);
 expect(bridge.playerOverlay).toHaveBeenCalledWith({session:'old',close:true});
});
