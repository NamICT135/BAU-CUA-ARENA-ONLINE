const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const root=path.resolve(__dirname,'..'), dir=path.join(root,'qa');
  await fs.mkdir(dir,{recursive:true});
  const types={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
  const server=http.createServer(async(req,res)=>{
    try { const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
      if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
      const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(bytes);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:524,height:724},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.evaluate(()=>window.__LION_READY);
    const shoot=async t=>{await page.evaluate(t=>{window.__timelines['red-lion'].seek(t,false);window.lionPainter.draw(t);},t);return page.screenshot();};
    const times=[0,.42,.82,1.68,2.45,3.4,4.6,5],images=[];
    for(const t of times){const bytes=await shoot(t);images.push(bytes);await fs.writeFile(path.join(dir,`frame-${t.toFixed(2)}.png`),bytes);}
    const raw=async b=>sharp(b).removeAlpha().raw().toBuffer();
    const first=await raw(images[0]),last=await raw(images.at(-1));
    assert.equal(Buffer.compare(first,last),0,'Loop endpoints must be pixel-identical');
    assert.equal(Buffer.compare(await raw(images[4]),await raw(await shoot(2.45))),0,'Backward seek must be deterministic');
    const end=await raw(await shoot(149/30)),peak=await raw(images[2]);let seam=0,change=0;
    for(let i=0;i<first.length;i++){seam+=Math.abs(first[i]-end[i]);change+=Math.abs(first[i]-peak[i]);}
    seam/=first.length;change/=first.length;assert.ok(seam<1.5);assert.ok(change>2);assert.deepEqual(errors,[]);
    const tiles=[];
    for(let i=0;i<images.length;i++)tiles.push({input:await sharp(images[i]).resize(262,362).toBuffer(),left:(i%4)*262,top:Math.floor(i/4)*362});
    await sharp({create:{width:1048,height:724,channels:3,background:'#210b20'}}).composite(tiles).png().toFile(path.join(dir,'contact-sheet.png'));
    await sharp(images[0]).webp({quality:92}).toFile(path.resolve(root,'../../public/assets/hub/friends-lion-poster.webp'));
    const report={duration:5,fps:30,width:524,height:724,seamExact:true,backwardSeekExact:true,seamMeanAbsoluteDifference:seam,peakMeanAbsoluteDifference:change,errors};
    await fs.writeFile(path.join(dir,'composition-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
