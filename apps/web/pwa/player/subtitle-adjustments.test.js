import { expect, it, vi } from "vitest";
import { createSubtitleAdjustments } from "./subtitle-adjustments.js";
function setup() {
  const cue = {
    startTime: 2,
    endTime: 5,
    line: "auto",
    snapToLines: true,
    lineAlign: "start",
  };
  const track = {
    cues: [cue],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const video = {
    clientHeight: 400,
    clientWidth: 800,
    videoHeight: 400,
    videoWidth: 800,
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    play: vi.fn(),
    load: vi.fn(),
    currentTime: 3,
  };
  const a = createSubtitleAdjustments({ video });
  return { a, cue, track, video };
}
it("no actual soft track means no controls", () => {
  const { a } = setup();
  expect(a.capabilities()).toEqual({
    timing: false,
    size: false,
    position: false,
  });
});
it("delay is live, signed, bounded and never cumulative or a media restart", () => {
  const { a, cue, track, video } = setup();
  a.bind(track, { timing: true });
  a.set("delay", 0.1);
  expect(cue.startTime).toBe(2.1);
  a.set("delay", 0.2);
  expect(cue.startTime).toBe(2.2);
  a.set("delay", -0.1);
  expect(cue.startTime).toBe(1.9);
  a.set("delay", 99);
  expect(a.values().delay).toBe(10);
  a.set("delay", -99);
  expect(a.values().delay).toBe(-10);
  expect(video.currentTime).toBe(3);
  expect(video.play).not.toHaveBeenCalled();
  expect(video.load).not.toHaveBeenCalled();
});
it("size and position have bounded actual effects", () => {
  const { a, cue, track, video } = setup();
  a.bind(track, { timing: true });
  for (const size of [75, 100, 250]) {
    a.set("size", size);
    expect(a.values().size).toBe(size);
  }
  expect(() => a.set("size", 999)).toThrow();
  for (const pos of [0, 50, 100]) {
    a.set("position", pos);
    expect(cue.line).toBe(pos);
    expect(cue.snapToLines).toBe(false);
  }
  expect(video.style.setProperty).toHaveBeenCalled();
});
it("switching track restores original cues and resets delay; newly arriving cues inherit settings", () => {
  const { a, cue, track } = setup();
  a.bind(track, { timing: true });
  a.set("delay", 0.3);
  a.set("position", 50);
  const next = {
    ...cue,
    startTime: 9,
    endTime: 11,
    line: "auto",
    snapToLines: true,
  };
  track.cues.push(next);
  a.refresh();
  expect(next.startTime).toBe(9.3);
  a.bind(null);
  expect(cue.startTime).toBe(2);
  expect(cue.line).toBe("auto");
  expect(a.values().delay).toBe(0);
  a.bind(track, { timing: false });
  expect(a.capabilities().timing).toBe(false);
  expect(() => a.set("delay", 1)).toThrow();
  a.close();
  expect(cue.line).toBe("auto");
});
it('notifies when real soft cues arrive after the selection sheet opened',()=>{
 const {video,track,cue}=setup();track.cues=[];const changed=vi.fn();const a=createSubtitleAdjustments({video,onChange:changed});a.bind(track,{timing:true});changed.mockClear();track.cues.push(cue);a.refresh();expect(changed).toHaveBeenCalledTimes(1);a.refresh();expect(changed).toHaveBeenCalledTimes(1);
});
it('scales portrait captions from the actual browser baseline, preserving the 100 percent default',()=>{
 const {video,track}=setup();Object.assign(video,{clientWidth:390,clientHeight:844,videoWidth:320,videoHeight:180});const a=createSubtitleAdjustments({video});a.bind(track,{timing:true});a.set('size',75);expect(video.style.setProperty).toHaveBeenLastCalledWith('--pp-subtitle-size','14.625px');a.set('size',250);expect(video.style.setProperty).toHaveBeenLastCalledWith('--pp-subtitle-size','48.75px');
});
