// State/lifecycle checks without a browser. Visual layout still needs device QA.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createDomLookup} from '../server/wwwroot/dom-view.js';
import {translate,locale,languages,getLanguage} from '../server/wwwroot/i18n.js';
import {MotionTimeline,MapCamera,angleDelta,wrapHeading,demoPose} from '../server/wwwroot/camera.js';
class Element {
 constructor(){this.hidden=false;this.textContent='';this.value='';this.dataset={};this.checked=false;this.children=[];this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v),toggle:(v,force)=>{if(force??!this.classes.has(v)){this.classes.add(v);return true}this.classes.delete(v);return false}};}
 querySelector(name){this.parts??=new Map();if(!this.parts.has(name))this.parts.set(name,new Element());return this.parts.get(name)}
 append(...v){this.children.push(...v)}replaceChildren(...v){this.children=v}showModal(){this.open=true}close(){this.open=false}focus(){}addEventListener(){}setPointerCapture(){}setAttribute(name,value){this[name]=value}
}
const elements=new Map(),body=new Element(),canvas=new Element();let drawnSegments=0;
let mapFrames=0,clearedFrames=0;
class MockRoadRenderer{constructor(){this.camera=new MapCamera()}frame(options){this.camera.configure(options);mapFrames++}project(p){return this.camera.project(p)}unproject(x,y){return this.camera.unproject(x,y)}setRoute(){}setProgress(){}applyTheme(){}}
class MockCoachDashboard{update(data,context){assert.equal(typeof context.valid,'boolean')}}
const finite=(...numbers)=>numbers.forEach(n=>assert.ok(Number.isFinite(n),'finite canvas coordinate'));
const canvasContext=new Proxy({clearRect(){clearedFrames++},createLinearGradient(...coordinates){finite(...coordinates);return{addColorStop(){}}}}, {get(target,key){return key in target?target[key]:(...values)=>{for(const v of values)if(typeof v==='number')finite(v)}}});
class TestPath{moveTo(x,y){finite(x,y)}lineTo(x,y){finite(x,y);drawnSegments++}}
canvas.getContext=()=>canvasContext;elements.set('map',canvas);
const cityData=[{token:'ljubljana',name:'Ljubljana',countryToken:'slovenia',x:100,z:200,y:200},{token:'koper',name:'Koper',countryToken:'slovenia',x:1100,y:200}];
const sampleRoute={points:[{x:100,z:200},{x:600,z:200},{x:1100,z:200}],instructions:[{index:2,kind:'arrive',text:'Cilj',distance:1000}],distance:1000,snapDistance:0,endSnapDistance:0,edges:2,usedDlcs:[8]};
let routeCalls=0;
const context=vm.createContext({console,CoachDashboard:MockCoachDashboard,structuredClone,MotionTimeline,MapCamera,RoadRenderer:MockRoadRenderer,angleDelta,wrapHeading,demoPose,performance,Path2D:TestPath,getComputedStyle:()=>({getPropertyValue:key=>({'--bg':'#101c23','--road':'#46606b','--roadEdge':'#20353e','--muted':'#91a5ad','--grid':'#ffffff03'}[key])}),innerWidth:900,innerHeight:500,devicePixelRatio:1,addEventListener(){},navigator:{},localStorage:{getItem(){},setItem(){}},document:{body,visibilityState:'visible',addEventListener(){},querySelector:()=>new Element(),querySelectorAll:()=>[],createElement:()=>new Element(),getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id)}},setTimeout(){return 1},clearTimeout(){},setInterval(){return 1},clearInterval(){},requestAnimationFrame(){},AbortSignal,Date,Math,Map,Set,fetch:async(url,options)=>{
 url=url.split('?')[0];
 if(url==='/api/status')return{ok:true,json:async()=>({telemetry:{connected:false,data:{}},addresses:[],pluginInstalled:false})};
 if(url==='/api/cities')return{ok:true,json:async()=>cityData};
 if(url==='/api/route'){routeCalls++;return{ok:true,json:async()=>structuredClone(sampleRoute)}}
 throw Error(url);
}});
const source=fs.readFileSync(new URL('../server/wwwroot/app.js',import.meta.url),'utf8');
context.createDomLookup=createDomLookup;
Object.assign(context,{initI18n(){},translate,locale,languages,getLanguage,onLanguageChange(){}});
vm.runInContext(source.replace(/^import .*;\r?\n/gm,'')+';globalThis.access={state,selectDestination,calculateRoute,clearRoute,trackRoute,zoom,world,screen,stopDemo,startDemo,updateAnimation,receiveTelemetry,draw,setGameGps,applyGameGps};',context);
await new Promise(r=>setImmediate(r));
const app=context.access;
app.selectDestination({x:1100,z:200,name:'Koper'});assert.equal(routeCalls,0);assert.equal(app.state.destination.name,'Koper');
console.log('PASS: selecting a destination without game telemetry does not invent a truck position or calculate a live route');
app.state.valid=true;app.state.x=100;app.state.z=200;await app.calculateRoute();assert.equal(routeCalls,1);assert.ok(app.state.route);assert.equal(elements.get('empty').hidden,true);assert.equal(elements.get('maneuver').hidden,false);
console.log('PASS: valid position enables routing and switches to navigation');
app.state.x=850;app.state.z=200;app.trackRoute();assert.equal(app.state.progress,1);assert.ok(elements.get('remaining').textContent.includes('5'));
app.state.x=1100;app.trackRoute();assert.equal(app.state.arrived,true);assert.equal(elements.get('turnText').textContent,'Prispel si do cilja');
console.log('PASS: route progress and arrival are derived from truck position');
app.zoom(1e10);assert.equal(app.state.zoom,2);app.zoom(1e-10);assert.equal(app.state.zoom,.018);
app.updateAnimation(performance.now());const p={x:app.state.x+10,z:app.state.z+20},screen=app.screen(p),world=app.world(screen.x,screen.y);assert.ok(Math.hypot(world.x-p.x,world.z-p.z)<1e-6);
console.log('PASS: zoom bounds and map coordinate transforms');
assert.equal(app.state.view3d,true);elements.get('viewMode').onclick();assert.equal(app.state.view3d,false);elements.get('viewMode').onclick();assert.equal(app.state.view3d,true);
console.log('PASS: 3D is the default and the 2D/3D toggle remains available');
app.clearRoute();assert.equal(app.state.route,null);assert.equal(app.state.destination,null);assert.equal(elements.get('maneuver').hidden,true);assert.equal(elements.get('empty').hidden,false);
console.log('PASS: cancel restores destination selection');
await app.startDemo();assert.equal(app.state.demo,true);assert.equal(elements.get('status').querySelector('span').textContent,'DEMO VOŽNJA');const started=performance.now();app.updateAnimation(started);const demoX=app.state.x;app.updateAnimation(started+100);assert.ok(app.state.x>demoX);
for(let i=0;i<20;i++)app.draw(started+110+i*1000/60);assert.ok(mapFrames>=20&&clearedFrames>=20);
elements.get('viewMode').onclick();for(let i=0;i<40;i++)app.draw(started+500+i*1000/60);assert.ok(mapFrames>=60&&clearedFrames>=60);
console.log('PASS: GPU camera updates and transparent vehicle overlay stay synchronized in 3D and 2D');
app.stopDemo();assert.equal(app.state.demo,false);assert.equal(app.state.valid,false);assert.equal(app.state.route,null);
console.log('PASS: demo is explicit, visibly labeled, and does not leave a fake live position after stopping');
app.state.valid=true;app.state.connected=true;app.state.paused=false;app.state.x=100;app.state.z=200;app.setGameGps(true);
const gps={state:'ready',message:'GPS igre',revision:1,fingerprint:'first',targets:[{id:'a',x:600,z:200},{id:'b',x:1100,z:200}],route:{...structuredClone(sampleRoute),source:'game',geometry:'approximate',gameDistance:19000}};
const beforeGpsCalls=routeCalls;app.applyGameGps(gps);assert.equal(app.state.route.source,'game');assert.equal(app.state.gpsTargets.length,2);
app.state.x=100;app.state.z=600;app.state.lastRoute=0;app.trackRoute();await new Promise(r=>setImmediate(r));assert.equal(routeCalls,beforeGpsCalls,'game owns replanning, including off-route');
console.log('PASS: imported game route and two targets never trigger our own route calculation');
const nextGps=structuredClone(gps);nextGps.fingerprint='second';nextGps.revision=2;nextGps.route.points[1].z=250;nextGps.targets.shift();app.applyGameGps(nextGps);assert.equal(app.state.route.points[1].z,250);assert.equal(app.state.gpsTargets.length,1);
console.log('PASS: same-length replanning and next-target transition update the displayed route');
app.applyGameGps({state:'no_route',message:'Čakam na naslednjo etapo',revision:3,targets:[],route:null});assert.equal(app.state.route,null);assert.equal(app.state.gameGps,true);assert.equal(app.state.destination,null);
app.applyGameGps(nextGps);assert.equal(app.state.route.source,'game');app.applyGameGps({state:'read_failed',message:'Ni podatkov',revision:4,targets:[],route:null});assert.equal(app.state.route,null);assert.equal(app.state.gpsTargets.length,0);
console.log('PASS: leg completion waits for the next game route; failed reads clear stale routes and targets');
app.applyGameGps(nextGps);elements.get('cancelRoute').onclick();assert.equal(app.state.gameGps,false);assert.equal(app.state.route,null);app.applyGameGps(gps);assert.equal(app.state.route,null);
console.log('PASS: cancel disables game following and manual navigation remains available');
