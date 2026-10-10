import { expect, it } from 'vitest';
import { RoomCore, createSettings, positionAt } from './together-core.ts';
it('keeps manga scroll anchors fixed during reading and when changing mode', () => {
  const media = {key:'manga:solo#1',kind:'manga' as const,label:'solo'};
  const core=RoomCore.create(createSettings(null,'host','ABCDEF',0),media,0);
  core.join({conn:'h',userId:'host',name:'host',avatarKey:null},0);
  core.handle('h',{t:'cmd',op:'play',pos:4.25},1000);
  expect(positionAt(core.timeline,20000)).toBe(4.25);
  core.handle('h',{t:'mode',mode:'free'},20000);
  core.handle('h',{t:'report',state:'playing',pos:4.75,at:20000,mediaKey:media.key},20000);
  core.handle('h',{t:'mode',mode:'sync'},23000);
  expect(core.timeline.pos).toBe(4.75);
});
