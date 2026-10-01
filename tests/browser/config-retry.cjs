const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    let configRequests = 0;
    await page.route('**/api/config', route => {
      configRequests += 1;
      if (configRequests === 1) {
        return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"temporary"}' });
      }
      return route.continue();
    });
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:5179/');
    await page.getByText('Sẵn sàng. Tạo phòng mới hoặc nhập mã.', { exact: true }).waitFor({ timeout: 10_000 });
    assert.ok(configRequests >= 2, 'The app should retry a failed configuration request');
    assert.equal(await page.locator('#create-room').isEnabled(), true);
    console.log(JSON.stringify({ configRequests, recovered: true, createRoomEnabled: true }));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
