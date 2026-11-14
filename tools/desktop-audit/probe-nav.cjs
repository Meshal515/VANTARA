// يطبع بنود الشريط الجانبي لكل قسم داخل تطبيق ويندوز (desktop-harness)، لبناء جولة اللقطات.
const { openDesktop, chromium } = require('./desktop-harness.cjs');
(async () => {
  const browser = await chromium.launch();
  const content = process.argv[2] === 'content';
  const { page } = await openDesktop({ browser, storage: { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 'تجربة' }, savedAt: Date.now() }, 'vantara.experience.v1': { unifyContent: content } } });
  await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(5000);
  const list = () => page.evaluate(() => [...document.querySelectorAll('.drawer button, .drawer a, aside button')].filter(b => b.checkVisibility()).map(b => `${b.className.split(' ')[0]}:${b.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)}`));
  console.log('root', JSON.stringify(await list()));
  await browser.close();
})();
