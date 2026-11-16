import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url)),base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28889';
assert.equal(new URL(base).hostname,'127.0.0.1');
const app=await fs.readFile(path.resolve(dir,'../server/wwwroot/app.js'),'utf8');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:960,height:600},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.js*',route=>route.fulfill({contentType:'text/javascript',body:
  `window.qaClears={map:0,other:0};const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='map')qaClears[window.qaInMapRender?'map':'other']++;return clear.apply(this,args)};const on=maplibregl.Map.prototype.on;maplibregl.Map.prototype.on=function(type,...args){if(type==='render'&&typeof args[0]==='function'){const fn=args[0];args[0]=function(...values){window.qaInMapRender=true;try{return fn.apply(this,values)}finally{window.qaInMapRender=false}}}return on.call(this,type,...args)};\n`+
  app.replaceAll('startTelemetryStream();','')+
  `\nglobalThis.qa={renderer,dashboard,state,motion,push(t){lastStream=performance.now();receiveTelemetry(t)},pose:()=>({...renderPose})};`}));
 await page.goto(base);await page.waitForFunction(()=>window.qa?.renderer.ready&&qa.state.cities.length>0);
 await page.evaluate(()=>{
  qa.state.gameGps=false;const c=qa.state.cities.find(c=>c.token==='ljubljana');window.qaStart={x:c.x,z:c.y};
  window.qaData={...c,z:c.y,heading:0,speed:72,speedLimit:80,positionValid:true,paused:false,rpm:1200,gear:8,fuel:300,accelerationX:0,accelerationY:0,accelerationZ:0,gameMinutes:600,bus:{active:true,nextStopName:'Test',plannedArrival:620},navigationTime:1200,navigationValid:true};
  window.qaSeq=1;qa.push({connected:true,age:0,sequence:qaSeq,sampleTime:10000,data:qaData});
 });
 await page.waitForTimeout(900);
 assert.equal(await page.locator('#comfortPanel').isVisible(),true);
 assert.equal(await page.evaluate(()=>qa.renderer.map.getPixelRatio()),1);
 const before=await page.evaluate(()=>qa.renderer.map.getCanvas().width);
 await page.evaluate(()=>{const s=document.getElementById('renderQuality');s.value='sharp';s.dispatchEvent(new Event('change'))});
 assert.equal(await page.evaluate(()=>qa.renderer.map.getPixelRatio()),1.75);
 const after=await page.evaluate(()=>qa.renderer.map.getCanvas().width);assert.ok(after>before*1.7);
 await page.evaluate(()=>{const s=document.getElementById('renderQuality');s.value='smooth';s.dispatchEvent(new Event('change'))});
 // Repeated identical telemetry must not repeatedly replace text/hidden/styles.
 const mutations=await page.evaluate(async()=>{
  const changes=[],observer=new MutationObserver(records=>changes.push(...records));observer.observe(document.getElementById('coachPanel'),{attributes:true,childList:true,subtree:true,characterData:true});
  for(let i=0;i<20;i++)qa.dashboard.update(qaData,{valid:true,paused:false,demo:false,scope:'free'});
  await Promise.resolve();observer.disconnect();return changes.map(r=>({id:r.target.id,attribute:r.attributeName,type:r.type}));
 });
 assert.deepEqual(mutations,[],'unchanged telemetry does not invalidate the Coach layout');
 const motion=await page.evaluate(async()=>{
  qaClears.map=qaClears.other=0;const frames=[];let running=true;
  const frame=time=>{frames.push({time,...qa.pose()});if(running)requestAnimationFrame(frame)};requestAnimationFrame(frame);
  // Two source samples are occasionally delivered together after a Wi-Fi gap.
  for(let i=1;i<=24;i++){
   if(i%6===0)await new Promise(r=>setTimeout(r,185));else if(i%6!==1)await new Promise(r=>setTimeout(r,100));else await new Promise(r=>setTimeout(r,15));
   qa.push({connected:true,age:0,sequence:++qaSeq,sampleTime:10000+i*100,data:{...qaData,z:qaStart.z-i*2}});
  }
  await new Promise(r=>setTimeout(r,300));running=false;
  const steps=frames.slice(1).map((p,i)=>({dz:p.z-frames[i].z,dt:p.time-frames[i].time}));
  return{frames:frames.length,maxBacktrack:Math.max(...steps.map(p=>p.dz)),mapClears:qaClears.map,otherClears:qaClears.other,moved:frames[0].z-frames.at(-1).z,buffer:qa.motion.delay};
 });
 assert.ok(motion.frames>20);assert.ok(motion.moved>20);assert.ok(motion.maxBacktrack<.05,JSON.stringify(motion));assert.ok(motion.mapClears>10);assert.equal(motion.otherClears,0,'moving overlay paints with the actual MapLibre render event');
 await page.evaluate(()=>qa.push({connected:true,age:0,sequence:++qaSeq,sampleTime:13000,data:{...qaData,bus:null}}));
 await page.waitForTimeout(200);assert.equal(await page.locator('#comfortPanel').isVisible(),false);assert.equal(await page.locator('#coachScheduleButton').isVisible(),false);
 await page.evaluate(()=>{const s=document.getElementById('gVisibility');s.value='on';s.dispatchEvent(new Event('change'))});assert.equal(await page.locator('#comfortPanel').isVisible(),true);
 await page.evaluate(()=>{const s=document.getElementById('gVisibility');s.value='off';s.dispatchEvent(new Event('change'))});assert.equal(await page.locator('#comfortPanel').isVisible(),false);
 await page.screenshot({path:path.join(dir,'screens/motion-truck-960x600.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);
 assert.equal(await page.locator('#comfortPanel').isVisible(),false);assert.equal(await page.locator('#coachClock').isVisible(),true);
 const panel=await page.locator('#coachPanel').boundingBox();assert.ok(panel.x>=0&&panel.y>=0&&panel.x+panel.width<=391&&panel.y+panel.height<=844);
 await page.screenshot({path:path.join(dir,'screens/motion-truck-390x844.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS: actual WebGL motion with Wi-Fi batches, synchronized overlay, quality toggle at DPR 2, unchanged HUD has zero DOM mutations, automatic/manual G visibility. '+JSON.stringify(motion));
}finally{await browser.close()}
