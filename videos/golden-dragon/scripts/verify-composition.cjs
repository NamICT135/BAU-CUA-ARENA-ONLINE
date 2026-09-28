const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = path.resolve(__dirname, '..', 'qa');
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 576, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(process.env.DRAGON_COMPOSITION_URL || 'http://127.0.0.1:5179/videos/golden-dragon/index.html');
  await page.evaluate(() => window.__DRAGON_READY);
  const shoot = async t => {
    await page.evaluate(t => {
      window.__timelines['golden-dragon'].seek(t, false);
      window.dragonPainter.draw(t);
    }, t);
    return page.screenshot();
  };
  const times = [0, 1.5, 2.75, 3.4, 4.7, 5], images = [];
  for (const t of times) {
    const bytes = await shoot(t); images.push(bytes);
    await fs.writeFile(path.join(dir, `frame-${t.toFixed(2)}.png`), bytes);
  }
  const raw = async buf => sharp(buf).removeAlpha().raw().toBuffer();
  const first = await raw(images[0]), last = await raw(images.at(-1));
  assert.equal(Buffer.compare(first, last), 0, 'The t=0 / t=5 seam must be pixel-identical');
  const peak = await raw(images[2]), resought = await raw(await shoot(2.75));
  assert.equal(Buffer.compare(peak, resought), 0, 'Backward seeking must reproduce the peak frame');
  const nearEnd = await raw(await shoot(149 / 30));
  let difference = 0, peakDifference = 0;
  for (let i = 0; i < first.length; i++) {
    difference += Math.abs(first[i] - nearEnd[i]);
    peakDifference += Math.abs(first[i] - peak[i]);
  }
  const seamMeanAbsoluteDifference = difference / first.length;
  assert.ok(seamMeanAbsoluteDifference < 1.5, 'The last encoded frame must be close to the first');
  assert.ok(peakDifference / first.length > 1, 'The scene must visibly change at its peak');
  assert.deepEqual(errors, []);
  const tiles = [];
  for (let i = 0; i < images.length; i++) {
    const picture = await sharp(images[i]).resize(288, 400).png().toBuffer();
    tiles.push({ input: picture, left: (i % 3) * 288, top: Math.floor(i / 3) * 424 });
    const label = Buffer.from(`<svg width="288" height="24"><rect width="288" height="24" fill="#190e0b"/><text x="12" y="17" fill="#eed998" font-family="sans-serif" font-size="12">${times[i].toFixed(2)} s</text></svg>`);
    tiles.push({ input: label, left: (i % 3) * 288, top: Math.floor(i / 3) * 424 + 400 });
  }
  await sharp({ create: { width: 864, height: 848, channels: 3, background: '#190e0b' } }).composite(tiles).png().toFile(path.join(dir, 'contact-sheet.png'));
  await sharp(images[0]).webp({ quality: 93 }).toFile(path.resolve(__dirname, '../../../public/assets/hub/quick-play-dragon-poster.webp'));
  const report = { duration: 5, width: 576, height: 800, fps: 30, seamExact: true, backwardsSeekExact: true, seamMeanAbsoluteDifference, peakMeanAbsoluteDifference: peakDifference / first.length, errors };
  await fs.writeFile(path.join(dir, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
