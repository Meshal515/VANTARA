import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { GLASS, engineRefracts, glassTier, noteSession, syncGlass } from './glass.js';
import { createDock } from './dock.js';
import { dockIn, dockOut } from './page-motion.js';

/**
 * التأثير الزجاجي (قرار المالك، 21 نوفمبر؛ docs/audits/GLASS_UI_PLACEMENT.md): خيار مستقل، والحالي بلا أي أثر.
 */
const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const glassOn = (extra = {}) => memory({ 'vantara.appearance.v1': JSON.stringify({ material: 'glass' }), ...extra });
const CHROME = { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' };
const SAFARI = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const CRIOS = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1' };
const win = (navigator, reducedTransparency = false) => ({ navigator, matchMedia: (q) => ({ matches: reducedTransparency && /reduced-transparency/.test(q) }) });

let frames;
beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = (f) => frames.push(f);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false });
  const { document, window } = parseHTML('<html dir="rtl"><body></body></html>');
  globalThis.document = document;
  globalThis.CustomEvent = window.CustomEvent;
});
afterEach(() => { delete globalThis.matchMedia; });

describe('مستوى الزجاج: بالقدرة ثم بالقياس، لا بالذاكرة', () => {
  it('الحالي افتراضيًا: بلا اختيار المستخدم لا زجاج إطلاقًا', () => {
    expect(glassTier({ appearance: { material: 'current' }, win: win(CHROME), storage: memory() })).toBe('off');
  });
  it('Chromium يكسر الضوء (a)، وSafari وChrome على iOS (WebKit) يأخذان الضباب (c)', () => {
    expect(engineRefracts(CHROME)).toBe(true);
    expect(engineRefracts({ userAgentData: { brands: [{ brand: 'Chromium', version: '140' }] } })).toBe(true);
    expect(engineRefracts(SAFARI)).toBe(false);
    expect(engineRefracts(CRIOS)).toBe(false);
    expect(glassTier({ appearance: { material: 'glass' }, win: win(CHROME), storage: memory() })).toBe('a');
    expect(glassTier({ appearance: { material: 'glass' }, win: win(SAFARI), storage: memory() })).toBe('c');
  });
  it('تقليل الشفافية يرجع للحالي، والمستوى الذي نزل إليه الجهاز لا يصعد وحده', () => {
    expect(glassTier({ appearance: { material: 'glass' }, win: win(CHROME, true), storage: memory() })).toBe('off');
    expect(glassTier({ appearance: { material: 'glass' }, win: win(CHROME), storage: memory({ 'vantara.glass.tier.v2': 'b' }) })).toBe('b');
    // جهاز بلا انكسار أصلًا لا «يصعد» إلى b بقيمة محفوظة
    expect(glassTier({ appearance: { material: 'glass' }, win: win(SAFARI), storage: memory({ 'vantara.glass.tier.v2': 'b' }) })).toBe('c');
  });
});

describe('syncGlass: سمتان على <html> فقط حين يختار المستخدم Glass', () => {
  it('الحالي لا يكتب شيئًا، وGlass يكتب المادة والمستوى، والإطفاء يمحوهما', () => {
    const html = document.documentElement;
    expect(syncGlass({ doc: document, storage: memory() })).toBe('off');
    expect(html.dataset.material).toBeUndefined();
    const s = glassOn();
    Object.defineProperty(document, 'defaultView', { value: win(CHROME), configurable: true });
    syncGlass({ doc: document, storage: s });
    expect(html.dataset.material).toBe('glass');
    expect(html.dataset.glassTier).toBe('a');
    s.setItem('vantara.appearance.v1', JSON.stringify({ material: 'current' }));
    syncGlass({ doc: document, storage: s });
    expect(html.dataset.material).toBeUndefined();
    expect(html.dataset.glassTier).toBeUndefined();
  });
});

describe('مراقب الأداء: الميزانية من المعدل الفعلي للجلسة، والنزول بعد تراجع متكرر فقط', () => {
  const smooth = Array(60).fill(16.7);
  const janky = [...Array(50).fill(16.7), ...Array(10).fill(33.4)]; // النسبة 95 ضعف الوسيط
  it('جلستان سيئتان لا تكفيان، والثالثة تنزل مستوى وتحفظه، وجلسة سليمة تصفّر العد', () => {
    const s = glassOn();
    Object.defineProperty(document, 'defaultView', { value: { ...win(CHROME), dispatchEvent() {}, CustomEvent: globalThis.CustomEvent }, configurable: true });
    syncGlass({ doc: document, storage: s });
    expect(noteSession(janky, { doc: document, storage: s })).toBeNull();
    expect(noteSession(smooth, { doc: document, storage: s })).toBeNull(); // تصفير
    expect(noteSession(janky, { doc: document, storage: s })).toBeNull();
    expect(noteSession(janky, { doc: document, storage: s })).toBeNull();
    expect(noteSession(janky, { doc: document, storage: s })).toBe('b');
    expect(document.documentElement.dataset.glassTier).toBe('b');
    expect(s.getItem('vantara.glass.tier.v2')).toBe('b');
  });
  it('تفاوت عادي في جوال 120Hz (لا إطارات ساقطة) لا ينزل شيئًا، مهما تكرر', () => {
    const s = glassOn();
    Object.defineProperty(document, 'defaultView', { value: { ...win(CHROME), dispatchEvent() {}, CustomEvent: globalThis.CustomEvent }, configurable: true });
    syncGlass({ doc: document, storage: s });
    const jitter = [...Array(54).fill(8.3), ...Array(6).fill(11.2)]; // النسبة 95 = 1.35 من الوسيط: كانت تُحسب سيئة
    for (let i = 0; i < 10; i++) expect(noteSession(jitter, { doc: document, storage: s })).toBeNull();
    expect(document.documentElement.dataset.glassTier).toBe('a');
  });
  it('لا ينزل تحت b أبدًا: الانكسار والتكبير يبقيان', () => {
    const s = glassOn({ 'vantara.glass.tier.v2': 'b' });
    Object.defineProperty(document, 'defaultView', { value: { ...win(CHROME), dispatchEvent() {}, CustomEvent: globalThis.CustomEvent }, configurable: true });
    syncGlass({ doc: document, storage: s });
    const janky = [...Array(50).fill(16.7), ...Array(10).fill(33.4)];
    for (let i = 0; i < 9; i++) expect(noteSession(janky, { doc: document, storage: s })).toBeNull();
    expect(document.documentElement.dataset.glassTier).toBe('b');
  });
  it('مستوى حفظته النسخة القديمة (v1) لا يُقرأ: الجهاز يرجع للمستوى الكامل', () => {
    expect(glassTier({ appearance: { material: 'glass' }, win: win(CHROME), storage: memory({ 'vantara.glass.tier.v1': 'c' }) })).toBe('a');
  });
  it('جلسة قصيرة (أقل من 20 إطارًا) لا يُحكم منها', () => {
    expect(noteSession(Array(10).fill(50), { doc: document, storage: glassOn() })).toBeNull();
  });
});

describe('الشريط في Glass: العدسة ترسم التحديد، والحالي يرجع كما هو', () => {
  const rect = (left, width, top = 700, height = 58) => () => ({ left, width, top, height, right: left + width, bottom: top + height, x: left, y: top });
  const mount = () => {
    const navBtn = (page) => `<button class="nav" data-page="${page}"><span class="nav-pill"><svg class="icon"></svg></span></button>`;
    const opt = (id) => `<button class="dock-opt" data-arg="${id}" tabindex="-1" inert aria-hidden="true"></button>`;
    document.body.innerHTML = `<div id="scrim" hidden></div><nav class="dock" id="bar">` +
      `<div class="dock-cap dock-cap--nav" id="capR"><div class="cap-body"><span class="cap-ind"></span>${navBtn('home')}${navBtn('discover')}</div>${opt('manga')}</div>` +
      `<div class="dock-cap dock-cap--switch"><button class="dock-switch" aria-expanded="false"><span class="dock-sq" data-arg="manga"></span><span class="dock-sq" data-arg="anime"></span><span class="dock-sq" data-arg="cinema"></span></button>${opt('anime')}</div>` +
      `<div class="dock-cap dock-cap--nav" id="capL"><div class="cap-body"><span class="cap-ind"></span>${navBtn('library')}${navBtn('majlis')}</div>${opt('cinema')}</div></nav>`;
    const $ = (s) => document.querySelector(s);
    $('#bar').getBoundingClientRect = rect(0, 336);
    $('#capR').getBoundingClientRect = rect(224, 112);
    $('#capL').getBoundingClientRect = rect(0, 112);
    $('[data-page="home"]').getBoundingClientRect = rect(280, 56);
    $('[data-page="discover"]').getBoundingClientRect = rect(224, 56);
    $('[data-page="library"]').getBoundingClientRect = rect(56, 56);
    $('[data-page="majlis"]').getBoundingClientRect = rect(0, 56);
    const calls = [];
    for (const ind of document.querySelectorAll('.cap-ind')) ind.animate = (keys) => (calls.push(keys), { cancel() {} });
    return { $, calls, dock: () => createDock({ bar: $('#bar'), scrim: $('#scrim'), current: 'anime' }) };
  };

  it('Glass: عدسة واحدة وأيقونات فوق الزجاج (منها المربعات)، والدائرة الحالية لا تتحرك', () => {
    document.documentElement.dataset.material = 'glass';
    const { $, calls, dock } = mount();
    const d = dock();
    expect($('#bar .g-lens')).toBeTruthy();
    expect(document.querySelectorAll('#bar .g-glyph')).toHaveLength(5); // أربع وجهات والمبدّل
    expect(document.querySelectorAll('#bar .g-glyph.g-sw .dock-sq')).toHaveLength(3);
    d.activate('home');
    d.activate('discover');
    expect(calls).toHaveLength(0);
    expect(document.querySelector('.g-glyph[data-page="discover"]').classList.contains('active')).toBe(true);
  });

  it('المبدّل والقسم: مربع القسم الحالي يتبع، وألوان الأقسام على طبقاتها', () => {
    document.documentElement.dataset.material = 'glass';
    const { dock } = mount();
    const d = dock();
    d.setSection('cinema');
    const cur = [...document.querySelectorAll('.g-glyph.g-sw .dock-sq')].map((q) => q.classList.contains('current'));
    expect(cur).toEqual([false, false, true]);
  });

  it('إطفاء Glass يزيل العدسة ويرجع الدائرة الحالية بلا أثر', () => {
    document.documentElement.dataset.material = 'glass';
    const { $, calls, dock } = mount();
    const d = dock();
    d.activate('home');
    delete document.documentElement.dataset.material;
    d.refreshMaterial();
    expect($('#bar .g-lens')).toBeNull();
    expect($('#bar .g-glyphs')).toBeNull();
    d.activate('discover');
    expect(calls.length).toBeGreaterThan(0); // الدائرة الحالية رجعت تعمل
  });

  it('الحالي: لا عدسة ولا طبقة أيقونات، وتصغيره الخاص بالاتجاه (قرار المالك 22 نوفمبر: 80% وشفافية 50%)', () => {
    const { $, dock } = mount();
    const d = dock();
    expect($('#bar .g-lens')).toBeNull();
    d.scrolled(400);
    d.scrolled(800);
    expect($('#bar').classList.contains('g-compact')).toBe(false);
    expect($('#bar').classList.contains('d-compact')).toBe(true);
    d.scrolled(700); // لفوق
    expect($('#bar').classList.contains('d-compact')).toBe(false);
    d.scrolled(900);
    expect($('#bar').classList.contains('d-compact')).toBe(true);
    d.scrolled(10); // أعلى الصفحة
    expect($('#bar').classList.contains('d-compact')).toBe(false);
  });
});

describe('دخول الشريط وخروجه في Glass: بلا opacity على الشريط (تعزل زجاجه)، والمدة والمنحنى كما هما', () => {
  const setup = (glass) => {
    if (glass) document.documentElement.dataset.material = 'glass';
    document.body.innerHTML = '<nav class="dock" id="bar"><div class="dock-cap"></div><div class="dock-cap"></div><span class="g-lens"></span><div class="g-glyphs"></div></nav>';
    const nav = document.getElementById('bar');
    const anims = [];
    const fake = (el) => (keys, opts) => (anims.push({ el, keys, opts }), { cancel() {}, finished: Promise.resolve(), onfinish: null, addEventListener() {} });
    for (const el of [nav, ...nav.querySelectorAll('*')]) el.animate = fake(el);
    Object.defineProperty(document, 'defaultView', { value: { getComputedStyle: () => ({ backgroundColor: 'rgba(255, 255, 255, 0.045)', boxShadow: 'rgba(0, 0, 0, 0.32) 0px 10px 30px 0px' }) }, configurable: true });
    return { nav, anims };
  };
  it('Glass: الشريط يأخذ scale فقط، والتلاشي على الطبقات (زجاج الكبسولات وحوافها، والعدسة، والأيقونات)', () => {
    const { nav, anims } = setup(true);
    dockIn(nav, { doc: document });
    const onNav = anims.filter((a) => a.el === nav);
    expect(onNav).toHaveLength(1);
    expect(onNav[0].keys.every((k) => !('opacity' in k))).toBe(true);
    expect(onNav[0].opts.duration).toBe(400);
    expect(anims.filter((a) => a.opts.pseudoElement === '::before')).toHaveLength(2);
    expect(anims.filter((a) => a.opts.pseudoElement === '::after')).toHaveLength(2);
    expect(anims.some((a) => a.el.classList?.contains('g-lens') && a.keys[0].opacity === 0)).toBe(true);
    expect(anims.every((a) => a.opts.duration === 400)).toBe(true);
  });
  it('الحالي: كما كان حرفيًا (opacity وscale على الشريط وحده)', () => {
    const { nav, anims } = setup(false);
    dockOut(nav, { doc: document });
    expect(anims).toHaveLength(1);
    expect(anims[0].el).toBe(nav);
    expect(anims[0].keys).toEqual([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.96' }]);
  });
});

describe('أرقام v9 المقفلة', () => {
  it('النوابض والأحجام والتشتت كما اعتمدها المالك (الخطة 0.1)', () => {
    expect(GLASS.pos).toEqual({ travel: { k: 190, c: 21 }, follow: { k: 420, c: 38 } });
    expect(GLASS.lift).toEqual({ up: { k: 700, c: 42 }, down: { k: 300, c: 24 } });
    expect(GLASS.wobble).toEqual({ k: 520, c: 24 });
    expect(GLASS.form).toEqual({ k: 300, c: 30 });
    expect([GLASS.rest, GLASS.lifted.w, GLASS.lifted.h, GLASS.flight, GLASS.dispersion, GLASS.compact]).toEqual([40, 78, 60, 0.6, 0.26, 0.85]);
  });
});
