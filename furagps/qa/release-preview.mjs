import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {catalog,languages} from '../server/wwwroot/translations.js';
import {setLanguage,translate} from '../server/wwwroot/i18n.js';
setLanguage('en',false);
const dir=path.dirname(fileURLToPath(import.meta.url)),base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28889';assert.equal(new URL(base).hostname,'127.0.0.1');
const images=path.join(dir,'screens/release');await fs.mkdir(images,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const connection=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});const errors=[];connection.on('pageerror',e=>errors.push(e.message));
 await connection.goto(base+'/connection.html?lang=sl');await connection.waitForFunction(()=>window.FuraGPSConnect);
 await connection.evaluate(()=>FuraGPSConnect.init({server:'http://192.168.1.100:28888'}));
 const keys=new Set(catalog.map(r=>r[0])),normalize=t=>t.trim().replace(/\s+/g,' ');
 for(const name of ['connection.html','index.html']){
  const fixture=await browser.newPage();const html=await fs.readFile(path.resolve(dir,'../server/wwwroot',name),'utf8');await fixture.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
  const texts=await fixture.evaluate(()=>{const nodes=[],walk=document.createTreeWalker(document.body,4);let n;while(n=walk.nextNode())if(!n.parentElement.closest('[data-no-translate],script,style'))nodes.push(n.textContent.trim().replace(/\s+/g,' '));for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]'))if(!el.closest('[data-no-translate]'))for(const a of ['title','aria-label','placeholder'])if(el.hasAttribute(a))nodes.push(el.getAttribute(a));return nodes});
  const missing=[...new Set(texts.map(normalize))].filter(t=>/[A-Za-zČŠŽčšž]/.test(t)&&/[\sčšžČŠŽ]/.test(t)&&!keys.has(t)&&translate(t)===t&&!/^[–0-9]|^FURA GPS|^Fura GPS|^Euro Truck Simulator|^American Truck Simulator|^ETS2|^Ljubljana,|^192\.168/.test(t));assert.deepEqual(missing,[],name+' static text translation coverage');await fixture.close();
 }
 for(const {id}of languages){await connection.selectOption('#language',id);assert.equal(await connection.locator('html').getAttribute('lang'),id);await connection.setViewportSize({width:390,height:844});const result=await connection.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,input:document.getElementById('host').getBoundingClientRect().width,button:document.querySelector('.primary').getBoundingClientRect().height}));assert.equal(result.overflow,false,id);assert.ok(result.input>100&&result.button>=44,id);}
 await connection.selectOption('#language','en');await connection.setViewportSize({width:1280,height:800});await connection.screenshot({path:path.join(images,'connect-desktop-en.png')});await connection.setViewportSize({width:390,height:844});await connection.screenshot({path:path.join(images,'connect-phone-en.png'),fullPage:true});
 await connection.selectOption('#language','sl');await connection.setViewportSize({width:1280,height:800});await connection.screenshot({path:path.join(images,'connect-desktop-sl.png')});
 await connection.evaluate(()=>{window.qaSelected=null;window.FuraGPSConnectNative={connect:address=>{qaSelected=address},discover:()=>FuraGPSConnect.found([{address:'http://192.168.1.100:28888',name:'Gaming PC'}])}});await connection.click('#discover');await connection.locator('#devices button').click();assert.equal(await connection.evaluate(()=>qaSelected),'http://192.168.1.100:28888');
 await connection.fill('#host','8.8.8.8');await connection.click('.primary');assert.equal(await connection.locator('#feedback').getAttribute('data-error'),'true');
 const module=await connection.evaluate(async()=>{const m=await import('./connection.js');return {good:m.parseAddress('10.0.0.2','28888'),reject:['https://10.0.0.2','10.0.0.2/path','999.1.1.1','8.8.8.8'].map(x=>{try{m.parseAddress(x);return false}catch{return true}})}});assert.ok(module.reject.every(Boolean));assert.equal(module.good,'http://10.0.0.2:28888');
 await connection.close();
 const app=await fs.readFile(path.resolve(dir,'../server/wwwroot/app.js'),'utf8');
 for(const game of ['ets2','ats']){
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(game=>{localStorage.setItem('furagps-game',game);localStorage.setItem('furagps-language','en')},game);
  await page.route('**/app.js*',route=>route.fulfill({contentType:'text/javascript',body:`const jump=maplibregl.Map.prototype.jumpTo;maplibregl.Map.prototype.jumpTo=function(...args){window.qaMap=this;return jump.apply(this,args)};\n`+app+`\nwindow.qa={state,renderer,receiveTelemetry,dashboard};`}));
  await page.goto(base+'/?lang=en');await page.waitForFunction(()=>window.qa?.state.cities.length>0&&window.qaMap?.isStyleLoaded());await page.click('#demo');await page.waitForFunction(()=>qa.state.demo&&qa.state.route&&qaMap.areTilesLoaded());
  assert.equal(await page.locator('#mapFailure').isVisible(),false);assert.equal(await page.locator('#speedUnit').textContent(),game==='ats'?'mph':'km/h');assert.equal(await page.locator('#comfortPanel').isVisible(),game==='ets2');
  assert.equal(await page.evaluate(()=>qa.renderer.game),game);assert.ok(await page.evaluate(game=>qaMap.getStyle().sources.roads.url.includes('/'+game+'/'),game));
  await page.click('#brand');await page.selectOption('#units',game==='ats'?'km':'mi');assert.equal(await page.locator('#speedUnit').textContent(),game==='ats'?'km/h':'mph');assert.ok((await page.locator('#remaining').textContent()).endsWith(game==='ats'?'km':'mi'));await page.selectOption('#units','auto');await page.locator('[data-close="connectionDialog"]').click();
  // Translation changes update a running demo without reloading or losing route.
  await page.click('#brand');for(const {id}of languages){await page.selectOption('#language',id);assert.equal(await page.locator('html').getAttribute('lang'),id);assert.ok(await page.evaluate(()=>qa.state.demo&&qa.state.route));}
  await page.selectOption('#language','en');await page.locator('[data-close="connectionDialog"]').click();await page.waitForTimeout(300);
  await page.screenshot({path:path.join(images,game+'-tablet-en.png')});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await page.screenshot({path:path.join(images,game+'-phone-en.png')});
  if(game==='ets2'){await page.click('#brand');await page.selectOption('#gameSelection','ats');await page.locator('[data-close="connectionDialog"]').click();await page.waitForFunction(()=>qa.renderer.game==='ats'&&qa.renderer.ready&&qa.state.cities.some(c=>c.token==='san_francisc'));assert.equal(await page.evaluate(()=>qa.state.route),null);await page.click('#demo');await page.waitForFunction(()=>qa.state.demo&&qa.state.route&&qaMap.areTilesLoaded());assert.equal(await page.locator('#speedUnit').textContent(),'mph');}
  console.log('PASS: '+game+' real map/routing demo, seven live languages, units/G visibility; game switching resets old routes.');await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: connection UI in seven languages at phone/tablet sizes, manual/discovery actions, LAN address validation and complete static translation coverage.');
}finally{await browser.close()}
