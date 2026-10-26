import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { safeStageImage, stageArtwork, createDesktopLoadingStage } from './loading-stage.js';

describe('Windows artwork startup stage', () => {
  it('never loads active, untrusted or credential-bearing image URLs', () => {
    for (const url of ['javascript:alert(1)', 'http://bad.test/a.png', 'data:image/png;base64,AAA', '//bad.test/x', 'https://user:secret@bad.test/a', 'file:///etc/passwd', '\\evil']) {
      expect(safeStageImage(url)).toBeNull();
    }
    expect(safeStageImage('https://art.example/logo.png')).toBe('https://art.example/logo.png');
    expect(safeStageImage('/assets/logo.png')).toBe('/assets/logo.png');
  });
  it('selects banner then background then poster, with independent logo and title', () => {
    expect(stageArtwork({title:'عمل',media:{banner:'https://art.example/b.webp',logo:'https://art.example/l.png',poster:'https://art.example/p.png'}}))
      .toEqual({title:'عمل',background:'https://art.example/b.webp',logo:'https://art.example/l.png'});
  });
  it('starts with artwork, hides after the first frame, and returns for buffering', () => {
    const {document} = parseHTML('<html><body></body></html>');
    const stage = createDesktopLoadingStage(document); document.body.append(stage.element);
    stage.update({title:'فيلم',poster:'https://art.example/poster.webp',ready:false});
    expect(stage.element.hidden).toBe(false);
    expect(stage.element.querySelector('.v-stage__backdrop').getAttribute('src')).toBe('https://art.example/poster.webp');
    expect(stage.element.dataset.progress).toBe('indeterminate');
    stage.update({ready:true,title:'فيلم'});
    expect(stage.element.hidden).toBe(true);
    stage.update({ready:true,buffering:true,title:'فيلم'});
    expect(stage.element.hidden).toBe(false);
    expect(stage.element.dataset.mode).toBe('buffering');
    stage.close();expect(document.body.querySelector('.v-stage')).toBeNull();
  });
  it('never confuses invalid or unavailable progress with a real percentage', () => {
    const {document} = parseHTML('<html><body></body></html>');
    const stage=createDesktopLoadingStage(document);
    stage.update({ready:false,startupProgress:0.5});
    expect(stage.element.dataset.progress).toBe('measured');
    expect(stage.element.querySelector('.v-stage__logo--fill').style.clipPath).toContain('50%');
    stage.update({ready:false,startupProgress:NaN});
    expect(stage.element.dataset.progress).toBe('indeterminate');
  });
});
