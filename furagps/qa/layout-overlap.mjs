import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),www=path.resolve(dir,'../server/wwwroot');
const read=name=>fs.readFile(path.join(www,name),'utf8');
const [html,base,oldHud,css,js,legacy]=await Promise.all([read('index.html'),read('style.css'),read('hud.css'),read('hud-layout.css'),read('hud-layout.js'),fs.readFile(path.join(dir,'legacy-0.8.html'),'utf8')]);
await fs.mkdir(path.join(dir,'screens'),{recursive:true});
const sizes=[[320,480],[360,640],[390,844],[568,320],[640,360],[740,360],[800,480],[960,600],[1024,600],[1280,800],[600,960],[800,1280]];
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 for(const mode of ['server','apk-on-0.8']){
  const page=await context.newPage();
  const document=(mode==='server'?html:legacy).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'').replace('</head>',`<style>${base}\n${oldHud}${mode==='server'?css:''}</style></head>`);
  await page.setContent(document);
  await page.evaluate(()=>{
   document.getElementById('searchButton').onclick=()=>{window.searchClicks=(window.searchClicks||0)+1};
   const values={coachClock:'18:42',scheduleValue:'ZAMUJAŠ 128 min',scheduleDetail:'ŽIVO · naslednji postanek · sprotni urnik',coachStop:'Bukarešta · naslednji avtobusni postanek',coachStages:'5 / 5',gValue:'0.18 g',gLabel:'BOLJ NEŽNO',gSource:'UDOBJE · OCENA',remaining:'12.345 km',eta:'GPS igre · 286 min do cilja',turnDistance:'ČEZ 1,2 km',turnText:'Sledi aktivni poti',destinationLabel:'PROTI BUKAREŠTI',speed:'108',limit:'90',hudRpm:'1.450',hudRange:'420 km',hudCruise:'80 km/h',hudSatisfaction:'98 %',fuel:'213 l',gear:'PRESTAVA 10'};
   for(const[id,value]of Object.entries(values))document.getElementById(id).textContent=value;
   document.getElementById('status').querySelector('span').textContent='ETS2 POVEZAN';
   document.getElementById('maneuver').hidden=false;document.getElementById('empty').hidden=true;
   document.getElementById('coachPanel').dataset.comfort='firm';
  });
  if(mode!=='server')await page.addStyleTag({content:css});
  await page.addScriptTag({content:js});await page.addScriptTag({content:js});
  assert.equal(await page.locator('#hudLayout').count(),1,'repeated APK injection keeps a single layout');
  for(const[width,height]of sizes)for(const large of [false,true]){
   await page.setViewportSize({width,height});await page.evaluate(v=>window.FuraGPSHud.setLarge(v),large);
   for(const expanded of [false,true]){
    await page.evaluate(v=>document.querySelector('.coach-extra').open=v,expanded);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const result=await page.evaluate(()=>{
     const r=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};
     const names=['hudHeader','hudNavigation','hudCoach','hudControls','hudBottom'];
     const boxes=Object.fromEntries(names.map(id=>[id,r(document.getElementById(id))]));
     const panels=['header','.maneuver','.coach-panel','.map-controls','.speedbox','footer.distance-card'].map(s=>({name:s,...r(document.querySelector('#hudLayout '+s))}));
     const buttons=[...document.querySelectorAll('.map-controls button')].map(node=>{const box=r(node),at=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return{id:node.id,...box,hit:at===node||node.contains(at)}});
     return{boxes,panels,buttons,free:window.FuraGPSHud.freeRect,viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    const label=`${mode} ${width}x${height} large=${large} expanded=${expanded}`;
    const within=b=>b.x>=-1&&b.y>=-1&&b.right<=width+1&&b.bottom<=height+1;
    for(const p of result.panels)assert.ok(within(p),`${label}: offscreen ${p.name} ${JSON.stringify(p)}`);
    for(let a=0;a<result.panels.length;a++)for(let b=a+1;b<result.panels.length;b++){
     const p=result.panels[a],q=result.panels[b],dx=Math.min(p.right,q.right)-Math.max(p.x,q.x),dy=Math.min(p.bottom,q.bottom)-Math.max(p.y,q.y);
     assert.ok(dx<=1||dy<=1,`${label}: overlap ${p.name} / ${q.name}: ${dx}x${dy}`);
    }
    for(const button of result.buttons)assert.ok(button.hit&&within(button),`${label}: button covered ${button.id} ${JSON.stringify(button)}`);
    assert.ok(result.free.width>=120&&result.free.height>=45,`${label}: map too small ${JSON.stringify(result.free)}`);
    assert.equal(result.overflow,false,label+': horizontal page overflow');checks++;
   }
   await page.evaluate(()=>{const toast=document.getElementById('toast');toast.textContent='Pot je pripravljena. Srečno vožnjo!';toast.hidden=false});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const notice=await page.evaluate(()=>{const b=document.getElementById('toast').getBoundingClientRect(),p=document.getElementById('hudCenter').getBoundingClientRect();return{inside:b.left>=p.left-1&&b.right<=p.right+1&&b.top>=p.top-1&&b.bottom<=p.bottom+1,free:window.FuraGPSHud.freeRect}});
   assert.ok(notice.inside&&notice.free.height>=35,`${mode} ${width}x${height}: temporary notice covers HUD or map focus`);checks++;
   await page.evaluate(()=>document.getElementById('toast').hidden=true);
   if(!large&&[[390,844],[960,600],[640,360]].some(([w,h])=>w===width&&h===height)){
    await page.evaluate(()=>document.querySelector('.coach-extra').open=false);
    await page.screenshot({path:path.join(dir,'screens',`${mode}-${width}x${height}.png`)});
   }
  }
  await page.locator('#searchButton').click();assert.equal(await page.evaluate(()=>window.searchClicks),1,'reparenting preserves controls');
  await page.evaluate(()=>{document.getElementById('coachPanel').hidden=true});
  await page.waitForFunction(()=>document.getElementById('hudLayout').classList.contains('hud-no-coach'));
  assert.ok((await page.evaluate(()=>window.FuraGPSHud.freeRect)).width>120);
  await page.close();
 }
 await context.close();
}finally{await browser.close()}
console.log(`PASS: ${checks} real Chromium layout states; no overlapping/offscreen cards, covered buttons or horizontal overflow; APK injection preserves controls.`);
