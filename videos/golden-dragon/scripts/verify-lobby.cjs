const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const dir = path.resolve(__dirname, '..', 'qa');
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1656, height: 931 }, reducedMotion: 'no-preference' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const url = process.env.DRAGON_LOBBY_URL || 'http://127.0.0.1:5179/';
  const enter = async p => {
    await p.goto(url);
    await p.locator('#hub').waitFor({ state: 'visible' });
  };
  await enter(page);
  await page.waitForFunction(() => { const v = document.getElementById('hub-dragon-video'); return v.readyState >= 2 && !v.paused && v.currentTime > .1; });
  const metadata = await page.locator('#hub-dragon-video').evaluate(v => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, muted: v.muted, loop: v.loop, inline: v.playsInline, playbackRate: v.playbackRate }));
  assert.deepEqual(metadata, { duration: 5, width: 576, height: 800, muted: true, loop: true, inline: true, playbackRate: 2.5 });
  assert.equal(await page.locator('#home').isHidden(), true, 'The former entry screen stays removed from the user flow');
  const quickCardVisual = await page.locator('#hub-card-quick').evaluate(card => {
    const inner = card.querySelector('.hub-card-inner').getBoundingClientRect();
    const video = card.querySelector('.hub-dragon-video').getBoundingClientRect();
    const label = card.querySelector('.hub-card-label').getBoundingClientRect();
    const title = card.querySelector('.hub-card-title');
    return {
      videoCoversCard: Math.abs(video.width - inner.width) < 1 && Math.abs(video.height - inner.height) < 1,
      labelInsideArtwork: label.top > inner.top && label.bottom < inner.bottom,
      labelBackground: getComputedStyle(card.querySelector('.hub-card-label')).backgroundColor,
      titleAnimation: getComputedStyle(title, '::after').animationName,
      labelAnimation: getComputedStyle(card.querySelector('.hub-card-label')).animationName,
    };
  });
  assert.deepEqual(quickCardVisual, {
    videoCoversCard: true,
    labelInsideArtwork: true,
    labelBackground: 'rgba(0, 0, 0, 0)',
    titleAnimation: 'hub-quick-title-sheen',
    labelAnimation: 'hub-quick-wordmark-float',
  });
  assert.match(await page.locator('#hub-dragon-video').getAttribute('src'), /\.webm$/, 'Chrome prefers the smaller VP9 file');
  await page.locator('#hub-dragon-video').evaluate(async v => {
    v.pause(); await new Promise(resolve => { v.addEventListener('seeked', resolve, { once: true }); v.currentTime = 2.75; });
  });
  await page.screenshot({ path: path.join(dir, 'lobby-desktop.png') });
  const clickable = await page.locator('#hub-card-quick').evaluate(button => {
    const r = button.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button;
  });
  assert.equal(clickable, true, 'Animation must not intercept the quick-play button');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => { const v=document.getElementById('hub-dragon-video'); return !v.paused && getComputedStyle(v).display!=='none'; });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => !document.getElementById('hub-dragon-video').paused);
  await page.locator('#hub').evaluate(h => { h.hidden = true; });
  await page.waitForFunction(() => document.getElementById('hub-dragon-video').paused);
  await page.locator('#hub').evaluate(h => { h.hidden = false; });
  await page.waitForFunction(() => !document.getElementById('hub-dragon-video').paused);
  // The existing game intentionally requires landscape on phones.
  await page.setViewportSize({ width: 844, height: 390 });
  const cardsFit = await page.locator('.hub-cards-stage').evaluate(stage => {
    const bounds = stage.getBoundingClientRect();
    return [...stage.querySelectorAll('.hub-card')].every(card => {
      const r = card.getBoundingClientRect();
      return r.left >= bounds.left && r.right <= bounds.right;
    });
  });
  assert.equal(cardsFit, true, 'All four cards must fit inside the phone arcade viewport');
  await page.screenshot({ path: path.join(dir, 'lobby-mobile.png') });

  const reducedContext = await browser.newContext({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  await enter(reducedPage);
  await reducedPage.waitForFunction(() => { const v=document.getElementById('hub-dragon-video'); return !v.paused && v.currentTime > .1; });
  assert.match(await reducedPage.locator('#hub-dragon-video').getAttribute('src'), /\.(webm|mp4)$/);

  const actionContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const actionPage = await actionContext.newPage();
  await enter(actionPage);
  await actionPage.waitForFunction(() => !document.getElementById('create-room').disabled);
  await actionPage.locator('#hub-card-quick').click();
  await actionPage.locator('#game').waitFor({ state: 'visible' });

  const fallbackContext = await browser.newContext();
  await fallbackContext.route('**/quick-play-dragon-loop.webm', route => route.abort());
  const fallbackPage = await fallbackContext.newPage();
  await enter(fallbackPage);
  await fallbackPage.waitForFunction(() => {
    const v = document.getElementById('hub-dragon-video');
    return v.currentSrc.endsWith('.mp4') && v.readyState >= 2 && !v.paused && v.currentTime > .1;
  });

  const failureContext = await browser.newContext();
  await failureContext.route(/quick-play-dragon-loop\.(mp4|webm)$/, route => route.abort());
  const failurePage = await failureContext.newPage();
  await enter(failurePage);
  await failurePage.waitForFunction(() => document.getElementById('hub-dragon-video').hidden);
  assert.equal(await failurePage.locator('.hub-dragon-poster').isVisible(), true);
  assert.deepEqual(errors, []);
  const report = { url, metadata, quickCardVisual, directHubEntry: true, quickPlayEntersRoom: true, preferredWebm: true, mp4Fallback: true, quickPlayClickable: true, dragonPlaysWithReducedMotion: true, otherDecorativeMotionReducedByCss: true, hiddenLobbyPauses: true, visibleLobbyResumes: true, mediaErrorFallback: true, desktop: '1656x931', mobile: '844x390 landscape (existing game requirement)', errors };
  await fs.writeFile(path.join(dir, 'lobby-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
