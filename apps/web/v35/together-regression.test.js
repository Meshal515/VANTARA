import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createTogether, readerBridge } from './together.js';
import { targetAt } from '../lib/together/sync.js';
const roomOf = () => {
  const listeners = new Map();
  const room = { timeline: { media: { key: 'manga:solo#1', kind: 'manga' }, started: true, playing: true, pos: 4.25, at: 0, seq: 1 }, info: {mode:'sync'}, isHost:false, canControl:false, me:'guest', roster:[], clock:{serverNow:()=>10000}, report:vi.fn(), command:vi.fn(), close:vi.fn(),
    on(e, fn) { const set = listeners.get(e) ?? new Set(); set.add(fn); listeners.set(e, set); return () => set.delete(fn); },
    emit(e, data) { for (const fn of listeners.get(e) ?? []) fn(data); } };
  return room;
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('retains the browser room when handing it to the web player', () => {
  vi.stubGlobal('Capacitor', undefined); const room = roomOf();
  const hub = createTogether({ sync:{}, baseUrl:()=> 'https://sync.test', joinRoomImpl:()=>room, openMedia:vi.fn(), toast:vi.fn() });
  hub.joinByCode('ABCDEF', {media_json:JSON.stringify({seriesRef:'anime:42',kind:'anime'}),mode:'sync'});
  const args = hub.handOff('anime:42'); expect(room.close).not.toHaveBeenCalled(); expect(args.session).toBe(hub.session); expect(args.hub).toBe(hub); hub.leave();
});
it('still closes the web connection before handing ownership to Android', () => {
  vi.stubGlobal('Capacitor', {isNativePlatform:()=>true}); const room=roomOf();
  const hub=createTogether({sync:{},baseUrl:()=> 'https://sync.test',joinRoomImpl:()=>room,openMedia:vi.fn(),toast:vi.fn()});
  hub.joinByCode('ABCDEF',{media_json:JSON.stringify({seriesRef:'anime:42'}),mode:'sync'});
  expect(hub.handOff('anime:42').code).toBe('ABCDEF'); expect(room.close).toHaveBeenCalledOnce(); expect(hub.session).toBeNull();
});
it('keeps launch routing metadata when the server sends its minimal timeline media', () => {
  const room = roomOf();
  const hub = createTogether({sync:{},baseUrl:()=> 'https://sync.test',joinRoomImpl:()=>room,openMedia:vi.fn(),toast:vi.fn()});
  hub.joinByCode('ABCDEF',{media_json:JSON.stringify({seriesRef:'anime:42',kind:'anime',key:'anime:42#1'}),mode:'sync'});
  room.emit('state',{state:{media:{key:'anime:42#2',kind:'anime',label:'episode 2'}}});
  expect(hub.session.media.seriesRef).toBe('anime:42');
  expect(hub.handOff('anime:42')?.session).toBe(hub.session);
  hub.leave();
});
it('follows within a page, rejects older updates and catches up after separate mode', () => {
  const room=roomOf(), onFollow=vi.fn(); const bridge=readerBridge({room,mode:'sync'},{seriesRef:'solo',onFollow});
  expect(bridge.initial()).toEqual({chapter:1,index:4.25});
  room.emit('state',{state:{...room.timeline,pos:4.75,seq:2},by:'host'}); expect(onFollow).toHaveBeenLastCalledWith({chapter:1,index:4.75});
  room.emit('state',{state:{...room.timeline,pos:4.1,seq:1},by:'host'}); expect(onFollow).toHaveBeenCalledTimes(1);
  room.info.mode='free'; room.emit('state',{state:{...room.timeline,pos:6.2,seq:3},by:'host'}); expect(onFollow).toHaveBeenCalledTimes(1);
  room.timeline={...room.timeline,pos:6.2,seq:3}; room.info.mode='sync'; room.emit('room',room.info); expect(onFollow).toHaveBeenLastCalledWith({chapter:1,index:6.2}); bridge.destroy();
});
it('sends continuous scroll while the host keeps moving instead of debouncing indefinitely', () => {
  vi.useFakeTimers(); const room=roomOf(); room.isHost=room.canControl=true;
  const bridge=readerBridge({room,mode:'sync'},{seriesRef:'solo',onFollow:vi.fn()});
  for(let i=0;i<20;i++) { bridge.page({chapter:1,index:4+i/100,pages:50}); vi.advanceTimersByTime(40); }
  expect(room.command.mock.calls.length).toBeGreaterThan(3); vi.advanceTimersByTime(120);
  expect(room.command).toHaveBeenLastCalledWith('seek',{pos:4.19}); bridge.destroy();
});
it('a reading position never advances as video milliseconds', () => {
  const room=roomOf(); expect(targetAt(room.timeline,10000)).toBe(4.25);
});
it('renders profile avatars and +N only, and updates overflow when people leave', () => {
  const { document } = parseHTML('<html><body><button id="strip"></button></body></html>');
  vi.stubGlobal('document', document);
  const room = roomOf(); room.status = 'live';
  room.roster = Array.from({length:8}, (_,i) => ({userId:`u${i}`,name:`Person ${i}`,avatarKey:`face-${i}`,joinedAt:i,host:i===0,state:'ready'}));
  const hub = createTogether({sync:{},baseUrl:()=> 'https://sync.test',joinRoomImpl:()=>room,openMedia:vi.fn(),avatarNode:p=> {
    const img=document.createElement('img'); img.src=`/avatars/${p.avatarKey}.png`; img.alt=p.displayName; return img;
  }});
  hub.joinByCode('ABCDEF',{media_json:JSON.stringify({seriesRef:'anime:42',kind:'anime'}),mode:'sync'});
  const strip=document.querySelector('#strip'); hub.mountStrip(strip);
  expect([...strip.querySelectorAll('img')].map(n=>n.getAttribute('src'))).toEqual(['/avatars/face-0.png','/avatars/face-1.png','/avatars/face-2.png']);
  expect(strip.textContent).toBe('+5');
  expect(strip.getAttribute('aria-label')).toContain('8');
  expect(strip.querySelector('.tg-connection')).toBeNull();
  room.roster=room.roster.slice(0,7); room.emit('roster',room.roster); expect(strip.textContent).toBe('+4');
  room.roster=room.roster.slice(0,3); room.emit('roster',room.roster); expect(strip.querySelectorAll('img')).toHaveLength(3); expect(strip.textContent).toBe('');
  room.roster=room.roster.slice(0,2); room.emit('roster',room.roster); expect(strip.querySelectorAll('img')).toHaveLength(2); expect(strip.querySelector('.tg-more')).toBeNull();
  hub.leave();
});
