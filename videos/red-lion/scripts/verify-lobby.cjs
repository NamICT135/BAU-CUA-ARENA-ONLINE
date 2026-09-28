const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const dir=path.resolve(__dirname,'../qa'),url=process.env.LION_LOBBY_URL||'http://127.0.0.1:5179/';
  try {
    const context=await browser.newContext({viewport:{width:1656,height:931},reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(url);await page.locator('#hub').waitFor({state:'visible'});
    const playing=p=>p.waitForFunction(()=>{const v=document.getElementById('hub-lion-video');return v.readyState>=2&&!v.paused&&v.currentTime>.1;});
    await playing(page);
    const metadata=await page.locator('#hub-lion-video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,muted:v.muted,loop:v.loop,inline:v.playsInline,rate:v.playbackRate,src:v.currentSrc}));
    assert.equal(metadata.duration,5);assert.equal(metadata.width,524);assert.equal(metadata.height,724);assert.ok(metadata.muted&&metadata.loop&&metadata.inline);assert.equal(metadata.rate,1);assert.match(metadata.src,/\.webm$/);
    assert.equal(await page.locator('#hub-dragon-video').evaluate(v=>v.playbackRate),2.5,'Existing dragon keeps its speed');
    assert.equal(await page.locator('#hub-card-friend .hub-card-title').textContent(),'Chơi với bạn');
    const covers=await page.locator('#hub-card-friend').evaluate(card=>{const a=card.querySelector('.hub-card-inner').getBoundingClientRect(),v=card.querySelector('video').getBoundingClientRect();return Math.abs(a.width-v.width)<1&&Math.abs(a.height-v.height)<1;});assert.ok(covers);
    const first=await page.locator('#hub-lion-video').evaluate(v=>v.currentTime);await page.waitForTimeout(350);
    assert.notEqual(await page.locator('#hub-lion-video').evaluate(v=>v.currentTime),first);
    await page.screenshot({path:path.join(dir,'lobby-desktop.png')});
    await page.locator('#hub-card-friend').screenshot({path:path.join(dir,'lion-card.png')});
    await page.locator('#hub').evaluate(h=>h.hidden=true);await page.waitForFunction(()=>document.getElementById('hub-lion-video').paused);
    await page.locator('#hub').evaluate(h=>h.hidden=false);await playing(page);
    await page.setViewportSize({width:844,height:390});await playing(page);await page.screenshot({path:path.join(dir,'lobby-mobile.png')});
    // This card must still open the existing friend panel, without a media layer intercepting input.
    await page.locator('#hub-card-friend').click();await page.locator('#hub-friend-dialog').waitFor({state:'visible'});
    const fallback=await browser.newContext({viewport:{width:1280,height:720}});
    await fallback.route('**/friends-lion-loop.webm',r=>r.abort());const mp4=await fallback.newPage();await mp4.goto(url);await playing(mp4);
    assert.match(await mp4.locator('#hub-lion-video').evaluate(v=>v.currentSrc),/\.mp4$/);
    const failed=await browser.newContext({viewport:{width:1280,height:720}});
    await failed.route(/friends-lion-loop\.(webm|mp4)$/,r=>r.abort());const still=await failed.newPage();await still.goto(url);
    await still.waitForFunction(()=>document.getElementById('hub-lion-video').hidden);assert.ok(await still.locator('.hub-lion-poster').isVisible());
    assert.deepEqual(errors,[]);
    const report={url,metadata,fullCard: covers,actualTimeAdvances:true,playsWithReducedMotion:true,hiddenPauses:true,visibleResumes:true,friendPanelWorks:true,mp4Fallback:true,posterFallback:true,errors};
    await fs.writeFile(path.join(dir,'lobby-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
