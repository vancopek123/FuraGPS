import {MotionTimeline,angleDelta,wrapHeading,demoPose} from './camera.js?v=0.8.0';
import {RoadRenderer} from './road-renderer.js?v=0.8.0';
import {CoachDashboard} from './dashboard.js?v=0.8.0';
const $=id=>document.getElementById(id);
const canvas=$('map'),ctx=canvas.getContext('2d');
const state={x:24000,z:28000,heading:0,speed:0,connected:false,valid:false,paused:true,follow:true,headingUp:true,view3d:localStorage.getItem('furagps-view')!=='2d',zoom:.42,route:null,progress:0,destination:null,demo:false,cities:[],status:null,busy:false,lastRoute:0};
state.tilt=Math.max(42,Math.min(64,Number(localStorage.getItem('furagps-tilt'))||54));
state.gameGps=localStorage.getItem('furagps-game-gps')!=='off';state.gpsTargets=[];
let gameGpsRevision=-1,lastGameGps=null,lastGameGpsRoute=null,appliedGpsFingerprint=null;
const dashboard=new CoachDashboard({openSettings:()=>{$('connectionDialog').showModal();$('coachSettings').scrollIntoView?.({block:'start',behavior:'smooth'})}});
const motion=new MotionTimeline();
let width=innerWidth,height=innerHeight,dpr=1,center={x:24000,z:28000},toastTimer,dirty=true,routeId=0,searchTimer;
let renderPose=null,cameraHeading=0,cameraTilt=state.view3d?state.tilt:0,cameraAnchor=state.view3d?.70:.5,displayZoom=state.zoom,lastFrame=0,lastHud=0,lastStream=0,lastSample=null;
let demoRun=null,palette=null,renderer=null,mapErrorShown=false;
const icons={left:'↰',right:'↱',roundabout:'⟳',ferry:'⛴',arrive:'⚑'};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const norm=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
function resize(){width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;dirty=true}
addEventListener('resize',resize);resize();
if(localStorage.getItem('furagps-theme')==='light')document.body.classList.add('light');
function mapFailure(message){mapErrorShown=true;$('mapFailure').textContent=message;$('mapFailure').hidden=false}
try{renderer=new RoadRenderer($('roadMap'),{light:document.body.classList.contains('light'),onReady:()=>{$('mapFailure').hidden=true;dirty=true},onError:mapFailure})}catch(error){mapFailure(error.message)}
function screen(p){return renderer?renderer.project(p):{x:0,y:0,visible:false}}
function world(x,y){return renderer?renderer.unproject(x,y):null}
function configureCamera(){renderer?.frame({width,height,x:center.x,z:center.z,zoom:displayZoom,heading:cameraHeading,tilt:cameraTilt,anchor:cameraAnchor})}
configureCamera();
function updateAnimation(now){
 const dt=Math.max(0,Math.min(80,lastFrame?now-lastFrame:16));lastFrame=now;
 if(state.demo&&demoRun){const pose=demoPose(demoRun.route,now-demoRun.started);state.x=pose.x;state.z=pose.z;state.heading=pose.heading;state.speed=pose.finished?0:70;renderPose=pose;
  if(now-lastHud>100){trackRoute();updateStats({speedLimit:80,fuel:432,gear:pose.finished?0:10});lastHud=now}dirty=true;
 }else if(state.valid){const next=motion.at(now)||state;if(!renderPose||Math.hypot(renderPose.x-next.x,renderPose.z-next.z)>.0001||Math.abs(angleDelta(renderPose.heading,next.heading))>.001)dirty=true;renderPose={x:next.x,z:next.z,heading:next.heading}}
 else renderPose=null;
 if(state.follow&&renderPose){center.x=renderPose.x;center.z=renderPose.z}
 const desiredHeading=state.headingUp?(state.follow&&renderPose?renderPose.heading:cameraHeading):0;
 const desiredTilt=state.view3d?state.tilt:0,desiredAnchor=state.view3d?(height<500?.66:.71):(state.follow&&state.route?.59:.5);
 const headingStep=angleDelta(cameraHeading,desiredHeading)*(1-Math.exp(-dt/190));
 if(Math.abs(headingStep)>.001){cameraHeading=wrapHeading(cameraHeading+headingStep);dirty=true}
 const ease=1-Math.exp(-dt/180);
 if(Math.abs(cameraTilt-desiredTilt)>.02){cameraTilt+=(desiredTilt-cameraTilt)*ease;dirty=true}else cameraTilt=desiredTilt;
 if(Math.abs(cameraAnchor-desiredAnchor)>.0001){cameraAnchor+=(desiredAnchor-cameraAnchor)*ease;dirty=true}else cameraAnchor=desiredAnchor;
 if(Math.abs(displayZoom-state.zoom)>.00001){displayZoom+=(state.zoom-displayZoom)*ease;dirty=true}else displayZoom=state.zoom;
 configureCamera();
 if(renderer){renderer.setRoute(state.route);const behind=state.route?Math.max(0,(state.route.cumulative[Math.max(0,state.progress-4)]||0)-8)/state.route.distance:0;renderer.setProgress(behind)}
}
function draw(now){
 updateAnimation(now);
 if(dirty){dirty=false;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);if(!palette){const style=getComputedStyle(document.body);palette={};for(const key of ['bg','muted'])palette[key]=style.getPropertyValue('--'+key).trim()}
  const occupied=[];ctx.font='600 13px "Segoe UI",sans-serif';ctx.textAlign='center';
  for(const city of state.cities){const p=screen({x:city.x,z:city.y});if(!p.visible||p.x<30||p.x>width-30||p.y<110||p.y>height-110)continue;if(occupied.some(o=>Math.hypot(p.x-o.x,p.y-o.y)<130))continue;occupied.push(p);ctx.lineWidth=4;ctx.strokeStyle=palette.bg;ctx.strokeText(city.name,p.x,p.y-10);ctx.fillStyle=palette.muted;ctx.fillText(city.name,p.x,p.y-10);}
  if(state.route){const dest=screen(state.route.points.at(-1));if(dest.visible&&dest.x>0&&dest.x<width&&dest.y>0&&dest.y<height){ctx.fillStyle='#12bbaa';ctx.beginPath();ctx.arc(dest.x,dest.y,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(dest.x,dest.y,3,0,Math.PI*2);ctx.fill();}}
  if(state.route?.source==='game'){ctx.font='700 11px "Segoe UI",sans-serif';for(const[t,target]of state.gpsTargets.entries()){const p=screen(target);if(!p.visible||p.x<20||p.x>width-20||p.y<80||p.y>height-80)continue;ctx.fillStyle='#087c79';ctx.beginPath();ctx.arc(p.x,p.y,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillText(String(t+1),p.x,p.y+4)}}
  if(renderPose){const p=screen(renderPose),r=renderPose.heading*Math.PI/180,ahead=screen({x:renderPose.x+Math.sin(r)*20,z:renderPose.z-Math.cos(r)*20});if(p.visible){ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle='#0004';ctx.beginPath();ctx.ellipse(0,18,25,8,0,0,Math.PI*2);ctx.fill();ctx.rotate(Math.atan2(ahead.x-p.x,-(ahead.y-p.y)));ctx.shadowColor='#0006';ctx.shadowBlur=12;ctx.beginPath();ctx.moveTo(0,-26);ctx.lineTo(18,18);ctx.lineTo(0,10);ctx.lineTo(-18,18);ctx.closePath();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();const paint=ctx.createLinearGradient(0,-26,0,18);paint.addColorStop(0,'#73f5e2');paint.addColorStop(1,'#07998f');ctx.fillStyle=paint;ctx.fill();ctx.restore();}}
 }
 requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function updateStats(data){
 if(state.demo){const elapsed=Math.max(0,performance.now()-(demoRun?.started||performance.now()))/1000;data={...data,pluginVersion:'0.7.0',rpm:state.speed?1450+Math.sin(elapsed/5)*170:650,fuelRange:980,cruiseSpeed:state.speed?70:0,parkingBrake:!state.speed,retarder:0,accelerationX:state.speed?Math.sin(elapsed/4)*2:0,accelerationZ:state.speed?Math.sin(elapsed/7)*.7:0,accelerationY:state.speed?Math.sin(elapsed/2)*.3:0,coach:null,gameMinutes:480+elapsed*19/60,multiplayerOffset:0,navigationTime:Math.max(0,30-elapsed*19/60)*60,navigationValid:true,bus:{active:true,nextStopId:'demo',nextStopName:'Koper · demo postanek',plannedArrival:512,stages:3,satisfaction:.94}}}
 const end=state.route?.points.at(-1),scope=end?`${state.route.source||'own'}:${Math.round(end.x)},${Math.round(end.z)}`:'free';
 dashboard.update(data,{valid:state.valid,paused:state.paused,demo:state.demo,scope});
 $('speed').textContent=state.valid?Math.round(Math.abs(state.speed)):'–';
 $('limit').textContent=state.valid&&data.speedLimit>0?Math.round(data.speedLimit):'–';
 document.querySelector('.speedbox').classList.toggle('over',state.valid&&data.speedLimit>0&&state.speed>data.speedLimit+3);
 $('fuel').textContent=state.valid?`${Math.round(data.fuel||0)} l`:'– l';
 $('gear').textContent=state.valid?`PRESTAVA ${data.gear===0?'N':data.gear<0?'R':data.gear}`:'–';
 const status=state.demo?'DEMO VOŽNJA':!state.connected?'ČAKAM NA ETS2':!state.valid?'VSTOPI V TOVORNJAK':state.paused?'IGRA JE NA PAVZI':'ETS2 POVEZAN';
 $('status').querySelector('span').textContent=status;$('status').classList.toggle('online',state.connected&&state.valid);
 $('emptyText').textContent=state.gameGps?'Nastavi GPS pot v ETS2 / HaulMP. Aktivna etapa in spremembe ciljev se prenesejo samodejno.':state.valid?'Poišči mesto ali drži prst na cesti za poljuben cilj.':'Izberi cilj. Ko vstopiš v vozilo, se zemljevid postavi na tvojo lokacijo.';
}
function receiveTelemetry(t){
 if(t.connected&&t.data.positionValid&&state.demo)stopDemo();
 state.connected=t.connected;if(state.demo)return;
 const wasValid=state.valid;state.valid=t.connected&&t.data.positionValid;state.paused=t.data.paused;state.speed=t.data.speed;
 if(state.valid){state.x=t.data.x;state.z=t.data.z;state.heading=t.data.heading;
  if(!wasValid){motion.clear();lastSample=null}
  if(t.sequence!==lastSample||t.sequence==null){motion.push(t.data,performance.now()-Math.min(1,t.age||0)*1000,t.sequence);lastSample=t.sequence;trackRoute()}
 }else{motion.clear();lastSample=null;renderPose=null;if(state.route?.source==='game')clearRoute()}
 dirty=true;updateStats(t.data);
 if(state.destination&&!state.route&&!state.busy&&state.valid&&!state.gameGps)calculateRoute();
}
function setGameGps(enabled){
 if(state.demo&&enabled)stopDemo();state.gameGps=enabled;localStorage.setItem('furagps-game-gps',enabled?'on':'off');$('gameGpsFollow').checked=enabled;
 if(enabled||state.route?.source==='game')clearRoute();gameGpsRevision=-1;appliedGpsFingerprint=null;
 $('gpsMode').textContent=enabled?'SLEDUJEM GPS-U IGRE':'LASTNA POT';
 if(enabled){$('empty').querySelector('h1').textContent='GPS iz igre';$('emptyText').textContent='Nastavi pot v ETS2 / HaulMP. Aktivna etapa in spremembe ciljev se prenesejo samodejno.'}
}
function applyGameGps(snapshot){
 lastGameGps=snapshot;gameGpsRevision=snapshot.revision;
 $('gameGpsState').textContent=snapshot.message;$('gameGpsState').dataset.state=snapshot.state;
 if(snapshot.route)lastGameGpsRoute=snapshot.route;
 if(snapshot.state!=='ready')lastGameGpsRoute=null;
 const targets=snapshot.targets||[];$('gpsTargets').replaceChildren(...targets.map((target,i)=>{const item=document.createElement('li');let nearest=null,near=Infinity;for(const city of state.cities){const d=distance(target,{x:city.x,z:city.y});if(d<near){near=d;nearest=city}}item.textContent=`Cilj GPS ${i+1}${nearest&&near<1800?' · '+nearest.name:''}`;return item}));
 $('gpsTargetsHint').textContent=targets.length?'Cilji, ki jih trenutno izpostavi GPS igre.':'Ko igra aktivira naslednjo etapo, se trasa samodejno zamenja. Celoten seznam Coach postankov morda ni izpostavljen.';
 if(!state.gameGps||state.demo)return;
 if(snapshot.state!=='ready'||!lastGameGpsRoute){if(state.route?.source==='game')clearRoute();$('gpsMode').textContent='GPS IGRE · ČAKAM';return}
 if(!state.valid){if(state.route?.source==='game')clearRoute();return}
 if(state.route?.source==='game'&&appliedGpsFingerprint===snapshot.fingerprint)return;
 const result=structuredClone(lastGameGpsRoute);if(!Array.isArray(result.points)||result.points.length<2)return;
 routeId++;result.cumulative=[0];for(let i=1;i<result.points.length;i++)result.cumulative[i]=result.cumulative[i-1]+distance(result.points[i-1],result.points[i]);
 state.route=result;state.destination=null;state.progress=0;state.arrived=false;state.gpsTargets=targets;appliedGpsFingerprint=snapshot.fingerprint;
 let best=Infinity;for(let i=0;i<result.points.length-1;i++){const a=result.points[i],b=result.points[i+1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((state.x-a.x)*dx+(state.z-a.z)*dz)/(dx*dx+dz*dz||1))),d=distance(state,{x:a.x+t*dx,z:a.z+t*dz});if(d<best){best=d;state.progress=i}}
 $('maneuver').hidden=false;$('empty').hidden=true;$('destinationLabel').textContent='AKTIVNA TRASA ETS2 / HAULMP';$('gpsMode').textContent='GPS IGRE';trackRoute();dirty=true;
}
async function pollGameGps(){
 try{const response=await fetch('/api/game-gps?after='+gameGpsRevision,{cache:'no-store',signal:AbortSignal.timeout(2500)});if(!response.ok)throw Error();applyGameGps(await response.json())}
 catch{gameGpsRevision=-1;lastGameGpsRoute=null;appliedGpsFingerprint=null;$('gameGpsState').textContent='GPS bralnik ni dosegljiv. Preveri FuraGPS.exe 0.8.';if(state.route?.source==='game')clearRoute();if(state.gameGps&&!state.demo)$('gpsMode').textContent='GPS IGRE · BREZ POVEZAVE'}
 finally{setTimeout(pollGameGps,750)}
}
pollGameGps();
function startTelemetryStream(){if(typeof EventSource==='undefined')return;const stream=new EventSource('/api/telemetry');stream.onmessage=event=>{try{const t=JSON.parse(event.data);lastStream=performance.now();receiveTelemetry(t)}catch{}};stream.onerror=()=>{lastStream=0};}
startTelemetryStream();
async function poll(){try{
 const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(2500)});if(!response.ok)throw Error();
 const status=await response.json();state.status=status;const t=status.telemetry;
 if(!lastStream||performance.now()-lastStream>1800)receiveTelemetry(t);
 $('connectionState').textContent=t.connected?(t.data.positionValid?'Podatki iz igre prihajajo.':'Vtičnik deluje. Vstopi v tovornjak.'):'Računalnik deluje. Čakam na podatke iz ETS2.';
 $('pluginState').textContent=status.pluginInstalled?'Vtičnik Fura GPS je nameščen. Če si ga dodal med delovanjem igre, ponovno zaženi ETS2.':'V mapi programa zaženi Namesti-vticnik.cmd, nato ponovno zaženi ETS2. Za povezavo telefona dovoli program v zasebnem omrežju Windows.';
 $('addresses').replaceChildren(...status.addresses.map(a=>{const el=document.createElement('code');el.textContent=a;return el}));
 $('job').hidden=!t.data.destinationCity;
}catch{if(!state.demo&&(!lastStream||performance.now()-lastStream>1800)){state.connected=false;state.valid=false;motion.clear();renderPose=null;dirty=true;updateStats({});}$('connectionState').textContent='Povezava z računalnikom je prekinjena. Preveri FuraGPS.exe, Wi-Fi in požarni zid.'}finally{setTimeout(poll,lastStream&&performance.now()-lastStream<1800?1400:200)}}poll();
async function loadCities(){try{const r=await fetch('/api/cities');if(!r.ok)throw Error();state.cities=await r.json();if(!state.valid){const c=state.cities.find(c=>c.token==='ljubljana')||state.cities[0];if(c){center={x:c.x,z:c.y};state.x=c.x;state.z=c.y}}dirty=true;renderResults()}catch{toast('Mest ni bilo mogoče naložiti. Preveri povezavo z računalnikom.');setTimeout(loadCities,4000)}}loadCities();
function openSearch(){$('searchDialog').showModal();$('search').focus();renderResults()}
function renderResults(){const query=norm($('search').value);let cities=state.cities.filter(c=>norm(c.name).includes(query)||norm(c.token).includes(query));cities.sort((a,b)=>query?a.name.localeCompare(b.name):distance({x:a.x,z:a.y},state)-distance({x:b.x,z:b.y},state));$('results').replaceChildren(...cities.slice(0,40).map(city=>{const button=document.createElement('button'),label=document.createElement('div'),name=document.createElement('b'),country=document.createElement('small'),arrow=document.createElement('span');name.textContent=city.name;country.textContent=city.countryToken.replaceAll('_',' ').toUpperCase();arrow.textContent='↗';label.append(name,country);button.append(label,arrow);button.onclick=()=>selectDestination({x:city.x,z:city.y,name:city.name});return button}));if(!cities.length)$('results').textContent='Ni zadetkov v nameščenem zemljevidu.'}
function selectDestination(dest){setGameGps(false);state.destination=dest;state.route=null;state.progress=0;routeId++;$('searchDialog').close();if(state.valid)calculateRoute();else{toast('Cilj je izbran. Vstopi v vozilo ali zaženi demo.');$('empty').querySelector('h1').textContent=dest.name;$('chooseDestination').textContent='Spremeni cilj'}dirty=true}
async function calculateRoute(automatic=false){if(state.busy||!state.destination||!state.valid||(state.gameGps&&!state.demo))return;state.busy=true;state.lastRoute=Date.now();const id=++routeId,destination={...state.destination};
 try{if(!automatic)toast('Računam pot …');const r=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:state.x,z:state.z,toX:destination.x,toZ:destination.z,heading:state.demo?null:state.heading,avoidFerries:$('avoidFerries').checked}),signal:AbortSignal.timeout(25000)});const result=await r.json();if(id!==routeId)return;if(!r.ok)throw Error(result.error||'Pot ni na voljo.');
 result.cumulative=[0];for(let i=1;i<result.points.length;i++)result.cumulative[i]=result.cumulative[i-1]+distance(result.points[i-1],result.points[i]);state.route=result;state.progress=0;state.follow=true;state.arrived=false;if(state.demo)demoRun={route:result,started:performance.now()};$('follow').classList.add('active');$('maneuver').hidden=false;$('empty').hidden=true;$('destinationLabel').textContent=`PROTI ${destination.name.toUpperCase()}`;trackRoute();dirty=true;if(!automatic)toast(result.snapDistance>150?'Pot se začne na najbližji dostopni cesti.':'Pot je pripravljena. Srečno vožnjo!');
 }catch(error){if(id===routeId){toast(error.message==='The operation was aborted due to timeout'?'Izračun poti je trajal predolgo. Poskusi drug cilj.':error.message);if(!automatic){state.destination=null;state.route=null;$('empty').hidden=false;$('maneuver').hidden=true}}}
 finally{state.busy=false}
}
function trackRoute(){const route=state.route;if(!route||!state.valid)return;let best=Infinity,index=state.progress,along=0;
 const lo=Math.max(0,state.progress-50),hi=Math.min(route.points.length-1,state.progress+500);
 for(let i=lo;i<hi;i++){const a=route.points[i],b=route.points[i+1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((state.x-a.x)*dx+(state.z-a.z)*dz)/(dx*dx+dz*dz||1))),d=distance(state,{x:a.x+dx*t,z:a.z+dz*t});if(d<best){best=d;index=i;along=route.cumulative[i]+distance(a,b)*t}}
 state.progress=index;const left=Math.max(0,route.distance-along);
 if(route.source==='game'){
  const game=state.status?.telemetry?.data,meters=game?.navigationDistance>0?game.navigationDistance:Math.max(0,route.gameDistance-along*19);
  $('remaining').textContent=meters<1000?`${Math.round(meters)} m`:`${(meters/1000).toLocaleString('sl-SI',{maximumFractionDigits:0})} km`;
  $('eta').textContent=`GPS IGRE${game?.navigationTime>0?' · '+Math.round(game.navigationTime/60)+' min v igri':''}${route.geometry==='approximate'?' · približen izris':''}`;
  $('turn').textContent='↑';$('turnDistance').textContent='GPS IZ IGRE';$('turnText').textContent='Sledi aktivni poti';
  if(left<20&&distance(state,route.points.at(-1))<50&&!(game?.navigationDistance>100)){$('turn').textContent='⚑';$('turnText').textContent='Konec aktivne etape';$('turnDistance').textContent='ČAKAM NA NASLEDNJI CILJ IGRE'}
  return; // Replanning and stop progression belong to ETS2, never our own router.
 }
 // Route distance is an estimate: city/rural/UK scale differs. In-game distance remains separate.
 const km=left*19/1000;$('remaining').textContent=km<1?`${Math.round(km*1000)} m`:`≈ ${km.toLocaleString('sl-SI',{maximumFractionDigits:0})} km`;
 const game=state.status?.telemetry?.data,gameLeft=game?.navigationDistance;
 $('eta').textContent=state.demo?'DEMO · Ljubljana → Koper':gameLeft>0?`GPS igre: ${(gameLeft/1000).toLocaleString('sl-SI',{maximumFractionDigits:0})} km · ${Math.round((game.navigationTime||0)/60)} min v igri`:'Ocena razdalje · lastna pot Fura GPS';
 const next=route.instructions.find(i=>i.index>index+1)||route.instructions.at(-1);
 if(next){const meters=Math.max(0,(route.cumulative[Math.min(next.index,route.points.length-1)]||route.distance)-along)*19;$('turn').textContent=icons[next.kind]||'↑';$('turnDistance').textContent=meters>1000?`ČEZ ${(meters/1000).toLocaleString('sl-SI',{maximumFractionDigits:1})} km`:`ČEZ ${Math.round(meters/10)*10} m`;$('turnText').textContent=next.text;}
 if(left<20&&distance(state,route.points.at(-1))<50){$('turn').textContent='⚑';$('turnText').textContent='Prispel si do cilja';$('turnDistance').textContent='SREČNO DOSTAVO';state.arrived=true;}
 if(!state.demo&&!state.paused&&!state.arrived&&best>100&&Date.now()-state.lastRoute>10000)calculateRoute(true);
}
function clearRoute(){routeId++;state.destination=null;state.route=null;state.progress=0;state.gpsTargets=[];appliedGpsFingerprint=null;$('maneuver').hidden=true;$('empty').hidden=false;$('empty').querySelector('h1').textContent=state.gameGps?'GPS iz igre':'Kam greva?';$('chooseDestination').textContent='⌕   Poišči mesto';$('remaining').textContent='– km';$('eta').textContent=state.gameGps?'Čakam na GPS igre':'Izberi cilj';dirty=true}
function stopDemo(){demoRun=null;motion.clear();renderPose=null;state.demo=false;state.valid=false;document.body.classList.remove('demo');$('demo').textContent='Preizkusi demo vožnjo ↗';clearRoute();$('gpsMode').textContent=state.gameGps?'GPS IGRE · ČAKAM':'LASTNA POT'}
async function startDemo(){
 if(state.demo){stopDemo();return}if(state.connected&&state.valid){toast('Igra je povezana. Demo je na voljo, ko ni podatkov iz igre.');return}
 const from=state.cities.find(c=>c.token==='ljubljana'),to=state.cities.find(c=>c.token==='koper');if(!from||!to){toast('Počakaj, da se naložijo mesta.');return}
 state.demo=true;state.valid=true;state.paused=false;state.x=from.x;state.z=from.y;state.heading=0;state.speed=70;document.body.classList.add('demo');$('gpsMode').textContent='DEMO · LASTNA POT';$('demo').textContent='Končaj demo';state.destination={x:to.x,z:to.y,name:to.name};await calculateRoute();
 if(!state.route){stopDemo();return}updateStats({speedLimit:80,fuel:432,gear:10});
}
$('demo').onclick=startDemo;
$('status').onclick=()=>{$('connectionDialog').showModal()};$('brand').onclick=$('status').onclick;
$('searchButton').onclick=openSearch;$('chooseDestination').onclick=openSearch;
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderResults,80)};
$('cancelRoute').onclick=()=>{if(state.demo)stopDemo();else if(state.route?.source==='game')setGameGps(false);else clearRoute()};
$('job').onclick=()=>{const token=state.status?.telemetry?.data.destinationCity,city=state.cities.find(c=>c.token===token);if(city)selectDestination({x:city.x,z:city.y,name:city.name});else toast('Mesto trenutne dostave ni na voljo v nameščenem zemljevidu.')};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('theme').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('furagps-theme',document.body.classList.contains('light')?'light':'dark');palette=null;renderer?.applyTheme(document.body.classList.contains('light'));dirty=true};
function zoom(factor){state.zoom=Math.max(.018,Math.min(2,state.zoom*factor));dirty=true}
$('zoomIn').onclick=()=>zoom(1.4);$('zoomOut').onclick=()=>zoom(1/1.4);
$('follow').onclick=()=>{state.follow=true;$('follow').classList.add('active');dirty=true};
$('north').onclick=()=>{state.headingUp=!state.headingUp;$('north').textContent=state.headingUp?'➤':'N ↑';dirty=true};
$('viewMode').textContent=state.view3d?'3D':'2D';$('viewMode').classList.toggle('active',state.view3d);$('viewMode').setAttribute('aria-pressed',String(state.view3d));$('north').textContent='➤';
$('viewMode').onclick=()=>{state.view3d=!state.view3d;localStorage.setItem('furagps-view',state.view3d?'3d':'2d');$('viewMode').textContent=state.view3d?'3D':'2D';$('viewMode').classList.toggle('active',state.view3d);$('viewMode').setAttribute('aria-pressed',String(state.view3d));if(state.view3d){state.headingUp=true;$('north').textContent='➤'}dirty=true};
$('tilt').value=state.tilt;$('tiltValue').textContent=state.tilt+'°';$('tilt').oninput=()=>{state.tilt=Math.max(42,Math.min(64,Number($('tilt').value)||54));$('tiltValue').textContent=state.tilt+'°';localStorage.setItem('furagps-tilt',String(state.tilt));dirty=true};
$('gameGpsFollow').checked=state.gameGps;$('gameGpsFollow').onchange=()=>setGameGps($('gameGpsFollow').checked);$('gpsMode').textContent=state.gameGps?'GPS IGRE · ČAKAM':'LASTNA POT';
if(state.gameGps)setGameGps(true);
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1/1.15:1.15)},{passive:false});
const touches=new Map();let panStart,holdTimer,pinchDistance,moved=false;
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===1){panStart={x:e.clientX,y:e.clientY,anchor:world(e.clientX,e.clientY)};moved=false;holdTimer=setTimeout(()=>{if(!moved){const p=world(e.clientX,e.clientY);if(p)selectDestination({...p,name:'Izbrana lokacija'});else toast('Izberi cesto pod obzorjem.');moved=true}},700)}else{clearTimeout(holdTimer);const [a,b]=[...touches.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y)}});
canvas.addEventListener('pointermove',e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2){clearTimeout(holdTimer);const [a,b]=[...touches.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance)zoom(d/pinchDistance);pinchDistance=d;moved=true;return}if(!panStart?.anchor)return;const dx=e.clientX-panStart.x,dy=e.clientY-panStart.y;if(Math.hypot(dx,dy)<7&&!moved)return;moved=true;clearTimeout(holdTimer);state.follow=false;$('follow').classList.remove('active');const current=world(e.clientX,e.clientY);if(current){center.x+=panStart.anchor.x-current.x;center.z+=panStart.anchor.z-current.z;configureCamera()}dirty=true});
function release(e){touches.delete(e.pointerId);clearTimeout(holdTimer);panStart=null;pinchDistance=null}canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){motion.clear();lastSample=null;dirty=true;lastFrame=0}});
// Browser mode also keeps the display awake where supported. The APK uses FLAG_KEEP_SCREEN_ON.
let wakeLock;async function keepAwake(){try{if('wakeLock'in navigator&&document.visibilityState==='visible')wakeLock=await navigator.wakeLock.request('screen')}catch{}}
document.addEventListener('pointerdown',keepAwake,{once:true});document.addEventListener('visibilitychange',keepAwake);
