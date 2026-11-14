const { openDesktop, chromium } = require('./desktop-harness.cjs');
(async () => {
  const browser = await chromium.launch();
  const { page } = await openDesktop({ browser, storage: { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 'تجربة' }, savedAt: Date.now() } } });
  await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(5000);
  await page.evaluate(() => [...document.querySelectorAll('.drawer-item')].find(b => b.textContent.includes(process?.x ?? 'الإعدادات'))?.click()).catch(()=>{});
  await page.evaluate(() => [...document.querySelectorAll('.drawer-item')].find(b => b.textContent.includes('الإعدادات'))?.click());
  await page.waitForTimeout(2500);
  console.log(await page.evaluate(() => {
    const root = [...document.querySelectorAll('.sheet, .modal, [role=dialog], .page.active')].filter(e => e.checkVisibility());
    return root.map(r => `${r.className.slice(0,40)} :: ` + [...r.querySelectorAll('button, [role=button], a')].filter(b => b.checkVisibility()).map(b => `${b.className.split(' ')[0]}|${b.textContent.trim().replace(/\s+/g,' ').slice(0,26)}`).join(' ; ')).join('\n');
  }));
  await browser.close();
})();
