import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url)),base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28889';
assert.equal(new URL(base).hostname,'127.0.0.1');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const legacy=process.env.FURAGPS_QA_LEGACY==='1',app=await fs.readFile(path.resolve(dir,legacy?'legacy-app-0.8.js':'../server/wwwroot/app.js'),'utf8');
 for(const [width,height]of [[960,600],[390,844],[640,360]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  if(legacy)await page.route(base+'/',async route=>route.fulfill({contentType:'text/html',body:await fs.readFile(path.join(dir,'legacy-0.8.html'),'utf8')}));
  await page.route('**/app.js*',route=>route.fulfill({contentType:'text/javascript',body:`const qaJump=maplibregl.Map.prototype.jumpTo;maplibregl.Map.prototype.jumpTo=function(options){globalThis.qaMap=this;return qaJump.call(this,options)};\n`+app}));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  if(legacy){await page.addStyleTag({content:await fs.readFile(path.resolve(dir,'../server/wwwroot/hud-layout.css'),'utf8')});await page.addScriptTag({content:await fs.readFile(path.resolve(dir,'../server/wwwroot/hud-layout.js'),'utf8')})}
  await page.locator('#demo').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('DEMO')&&window.qaMap?.isStyleLoaded()&&window.qaMap?.areTilesLoaded(),null,{timeout:30000});
  await page.waitForFunction(()=>{const r=window.FuraGPSHud?.freeRect;if(!r)return false;const p=window.qaMap.project(window.qaMap.getCenter());return p.x>r.x+5&&p.x<r.x+r.width-5&&p.y>r.y+5&&p.y<r.y+r.height-5});
  assert.equal(await page.locator('#mapFailure').isVisible(),false,'real WebGL map renders');
  assert.deepEqual(errors,[],'no runtime JavaScript errors');
  await page.screenshot({path:path.join(dir,'screens',`${legacy?'apk-legacy-':'demo-'}${width}x${height}.png`)});
  console.log(`PASS: ${legacy?'APK with PC 0.8':'current'} 3D demo, ${width}x${height}; vehicle focus inside the free map area, no JS/WebGL failure.`);
  await page.close();
 }
}finally{await browser.close()}
