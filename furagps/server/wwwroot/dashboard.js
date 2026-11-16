import {createDomLookup} from './dom-view.js?v=0.11.1';
import {locale} from './i18n.js?v=0.11.1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const G=9.80665;
export function gameClock(data){if(data?.coach?.state==='ready'&&finite(data.coach.now))return data.coach.now;return finite(data?.gameMinutes)&&data.gameMinutes>=0?data.gameMinutes+(finite(data.multiplayerOffset)?data.multiplayerOffset:0):null}
export function formatClock(minutes){if(!finite(minutes))return'–:–';const m=((Math.floor(minutes)%1440)+1440)%1440;return`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`}
export function scheduleLabel(delta,showEarly=true){const onTime=Math.abs(delta)<=4||(!showEarly&&delta<0);return{status:onTime?'on-time':delta>0?'late':'early',label:onTime?'PRAVOČASNO':delta>0?`ZAMUJAŠ ${Math.abs(delta)} min`:`ZGODEN ${Math.abs(delta)} min`,delta}}
const gameRound=v=>Math.floor(Math.fround(Math.fround(v)+.5));
export function scheduleStatus(data,manual=null,showEarly=true){
 const coach=data?.coach;
 if(coach?.state==='ready'&&Number.isInteger(coach.delayMinutes)&&finite(coach.planned)&&finite(coach.now))return{...scheduleLabel(coach.delayMinutes,showEarly),detail:`ŽIVO · naslednji postanek${coach.gradual?' · sprotni urnik':''}`,source:'game',target:coach.planned};
 const now=gameClock(data);if(now===null)return{status:'unavailable',label:'Čakam na uro igre',detail:data.pluginVersion?'SDK še ne posreduje ure':'Potreben je vtičnik 0.7'};
 const bus=data.bus,offset=finite(data.multiplayerOffset)?data.multiplayerOffset:0;
 let target=manual?.target,source='ROČNO · OCENA',actual=null;
 if(!finite(target)&&bus?.active&&finite(bus.plannedArrival)&&bus.plannedArrival>0&&bus.plannedArrival!==4294967295){target=bus.plannedArrival+offset;source='SDK · OCENA';if(finite(bus.actualArrival)&&bus.actualArrival>0&&bus.actualArrival!==4294967295)actual=bus.actualArrival+offset}
 if(!finite(target))return{status:'unavailable',label:'Nastavi čas prihoda',detail:'Urnik ni posredovan · tapni za vnos'};
 if(Math.abs(target-now)>4320)return{status:'unavailable',label:'Preveri čas voznega reda',detail:'Čas SDK ni v pričakovanih minutah'};
 const eta=data.navigationValid===true&&finite(data.navigationTime)&&data.navigationTime>=0?now+gameRound(Math.fround(Math.fround(data.navigationTime)*Math.fround(1/60))):null;
 if(actual!==null&&Math.abs(actual-target)>4320)actual=null;
 const arrival=actual??eta;
 if(arrival===null)return{status:'unavailable',label:'Čakam na GPS čas',detail:`Cilj ${formatClock(target)} · ${source}`};
 const delta=Math.round(arrival-target);
 return{...scheduleLabel(delta,showEarly),detail:`${actual!==null?'Prihod SDK':'GPS'} ${formatClock(arrival)} · cilj ${formatClock(target)} · ${source}`,source:'estimate',target,arrival};
}
export const referenceRules={state:'reference',source:'ETS2 1.62 · referenca',limits:[{x:6,y:6,z:6},{x:1000,y:1000,z:11}],failureLimits:{x:-1,y:-1,z:22},captureSeconds:3,cooldownSeconds:5};
export function comfortLevel(axes,rules=referenceRules){
 const crosses=limit=>['x','y','z'].some(axis=>finite(axes[axis])&&finite(limit?.[axis])&&limit[axis]>0&&Math.abs(axes[axis])>limit[axis]);
 if(crosses(rules.failureLimits))return'failure';
 let level='smooth';for(const [i,limit]of(rules.limits||[]).entries())if(crosses(limit))level=i===0&&level==='smooth'?'firm':'harsh';return level;
}
// Visual comfort warning, separate from the much higher passenger-penalty limits.
// Calibratable approximation of the HUD, not a claim to read a passenger sensor.
export class PassengerComfort {
 constructor(){this.level='smooth';this.until=0}
 update(meter,active,sensitivity=1,now=performance.now()){
  if(!active||!meter.valid){this.level='unavailable';this.until=0;return this.level}
  const force=Math.max(meter.g,meter.intervalPeak)*clamp(sensitivity,.5,2.5);
  const requested=force>=.20?'harsh':force>=.10?'firm':'smooth';
  const rank={unavailable:-1,smooth:0,firm:1,harsh:2};
  if(rank[requested]>=rank[this.level]||now>=this.until){this.level=requested;if(requested!=='smooth')this.until=now+(requested==='harsh'?700:450)}
  return this.level;
 }
}
export class ComfortMeter{
 constructor(){this.reset()}
 reset(){this.x=0;this.z=0;this.peak=0;this.last=0;this.initial=false}
 update(data,active,now=performance.now()){
  if(!active||!finite(data.accelerationX)||!finite(data.accelerationZ)||Math.abs(data.accelerationX)>200||Math.abs(data.accelerationZ)>200){this.initial=false;this.x=this.z=0;this.last=now;return{valid:false,x:0,z:0,g:0,peak:this.peak}}
  const x=data.accelerationX/G,z=-data.accelerationZ/G,dt=clamp(now-this.last,0,500),mix=this.initial?1-Math.exp(-dt/180):1;
  this.x+=(x-this.x)*mix;this.z+=(z-this.z)*mix;this.initial=true;this.last=now;
  const g=Math.hypot(x,z),peak=finite(data.accelerationPeakG)&&data.accelerationPeakG>=0&&data.accelerationPeakG<30?data.accelerationPeakG:g;
  this.peak=Math.max(this.peak,g,peak);
  const axes={x:data.accelerationX,y:finite(data.accelerationY)&&Math.abs(data.accelerationY)<=200?data.accelerationY:null,z:data.accelerationZ};
  const pulseAxes=Object.fromEntries(['x','y','z'].map(axis=>{const p=data['accelerationPeak'+axis.toUpperCase()];return[axis,finite(p)&&p>=0&&p<=200?Math.max(p,Math.abs(axes[axis]??0)):axes[axis]]}));
  return{valid:true,x:this.x,z:this.z,g,peak:this.peak,axes,pulseAxes,intervalPeak:peak};
 }
}
export class CoachDashboard{
 constructor({openSettings=()=>{},document=globalThis.document,storage=globalThis.localStorage}={}){
  this.$=createDomLookup(document);this.storage=storage;this.meter=new ComfortMeter();this.demoMeter=new ComfortMeter();this.lastData={};this.context={};this.scope='free';
  this.gVisibility=['on','off'].includes(storage.getItem('furagps-g-visibility'))?storage.getItem('furagps-g-visibility'):'auto';
  this.enabled=storage.getItem('furagps-coach-hud')!=='off';this.collapsed=storage.getItem('furagps-coach-collapsed')==='yes';this.limit=clamp(Number(storage.getItem('furagps-comfort-limit'))||.25,.15,.6);
  this.comfortMode=['custom','rules'].includes(storage.getItem('furagps-comfort-mode'))?storage.getItem('furagps-comfort-mode'):'coach';this.showEarly=storage.getItem('furagps-schedule-view')!=='hud';
  this.sensitivity=clamp(Number(storage.getItem('furagps-comfort-sensitivity'))||1,.5,2.5);this.passenger=new PassengerComfort();this.demoPassenger=new PassengerComfort();
  try{this.manual=JSON.parse(storage.getItem('furagps-manual-arrival')||'null')}catch{this.manual=null}
  if(this.manual&&(!finite(this.manual.target)||!finite(this.manual.setAt)||typeof this.manual.scope!=='string'))this.manual=null;
  this.$('coachEnabled').checked=this.enabled;this.$('coachEnabled').onchange=()=>{this.enabled=this.$('coachEnabled').checked;storage.setItem('furagps-coach-hud',this.enabled?'on':'off');this.render()};
  this.$('coachCollapse').onclick=()=>{this.collapsed=!this.collapsed;storage.setItem('furagps-coach-collapsed',this.collapsed?'yes':'no');this.render()};
  this.$('coachScheduleButton').onclick=openSettings;
  this.$('gVisibility').value=this.gVisibility;this.$('gVisibility').onchange=()=>{this.gVisibility=['on','off'].includes(this.$('gVisibility').value)?this.$('gVisibility').value:'auto';storage.setItem('furagps-g-visibility',this.gVisibility);this.render()};
  this.$('comfortMode').value=this.comfortMode;this.$('comfortMode').onchange=()=>{this.comfortMode=['custom','rules'].includes(this.$('comfortMode').value)?this.$('comfortMode').value:'coach';storage.setItem('furagps-comfort-mode',this.comfortMode);this.render()};
  this.$('comfortSensitivity').value=String(this.sensitivity);this.$('comfortSensitivity').oninput=()=>{this.sensitivity=clamp(Number(this.$('comfortSensitivity').value)||1,.5,2.5);storage.setItem('furagps-comfort-sensitivity',String(this.sensitivity));this.passenger.until=this.demoPassenger.until=0;this.render()};
  this.$('scheduleView').value=this.showEarly?'stages':'hud';this.$('scheduleView').onchange=()=>{this.showEarly=this.$('scheduleView').value!=='hud';storage.setItem('furagps-schedule-view',this.showEarly?'stages':'hud');this.render()};
  this.$('comfortLimit').value=String(this.limit);this.$('comfortLimitValue').textContent=this.limit.toFixed(2)+' g';this.$('comfortLimit').oninput=()=>{this.limit=clamp(Number(this.$('comfortLimit').value)||.25,.15,.6);this.$('comfortLimitValue').textContent=this.limit.toFixed(2)+' g';storage.setItem('furagps-comfort-limit',String(this.limit));this.render()};
  this.$('arrivalSave').onclick=()=>this.saveArrival();this.$('arrivalClear').onclick=()=>{this.manual=null;this.persist();this.render()};
  this.$('comfortReset').onclick=()=>{this.meter.reset();this.demoMeter.reset();this.render()};this.render();
 }
 persist(){this.storage.setItem('furagps-manual-arrival',JSON.stringify(this.manual))}
 saveArrival(){
  const clock=gameClock(this.lastData),match=/^(\d{2}):(\d{2})$/.exec(this.$('arrivalTime').value);
  if(!this.context.valid||this.context.demo||clock===null||!match||Number(match[1])>23||Number(match[2])>59){this.$('arrivalHint').textContent='Vnesi veljaven čas; najprej mora priti ura iz igre.';return}
  const day=this.$('arrivalDay').value==='1'?1:0;
  this.manual={target:Math.floor(clock/1440)*1440+day*1440+Number(match[1])*60+Number(match[2]),scope:this.scope,setAt:clock};this.persist();this.render();
 }
 update(data,context){
  if(this.game&&context.game&&this.game!==context.game){this.liveCoach=null;this.manual=null;this.persist();this.meter.reset();this.demoMeter.reset()}
  if(context.game)this.game=context.game;
  this.lastData=data||{};this.context=context;const bus=data?.bus;
  const direct=data?.coach?.state==='ready'&&data.coach.scope?{scope:`coach:${data.coach.scope}`,stage:data.coach.stage,stop:bus?.nextStopId}:null;
  if(!context.demo&&context.valid){
   if(direct)this.liveCoach=direct;
   else if(data?.coach?.state==='no_bus_job'||(bus?.active&&this.liveCoach&&((Number.isInteger(bus.stage)&&bus.stage!==this.liveCoach.stage)||(bus.nextStopId&&this.liveCoach.stop&&bus.nextStopId!==this.liveCoach.stop))))this.liveCoach=null;
  }
  // A temporary decoder miss is not evidence of a different stop.
  this.scope=direct?.scope||(!context.demo?this.liveCoach?.scope:null)||(bus?.active&&bus.nextStopId?`bus:${bus.nextStopId}:${bus.stage??''}`:context.scope||'free');
  const now=gameClock(data);
  if(!context.demo&&this.manual&&context.valid&&((this.manual.scope!==this.scope&&this.scope!=='free')||(now!==null&&(now<this.manual.setAt-5||now>this.manual.target+1440)))){this.manual=null;this.persist()}
  this.render();
 }
 render(){
  const $=this.$,data=this.lastData||{},context=this.context||{},valid=Boolean(context.valid),active=valid&&!context.paused,live=valid&&!context.demo,clock=valid?gameClock(data):null;
  const collapsed=this.collapsed||!valid;$('coachPanel').hidden=!this.enabled;$('coachPanel').classList.toggle('collapsed',collapsed);$('coachCollapse').setAttribute('aria-expanded',String(!collapsed));
  const bus=context.game!=='ats'&&Boolean(context.demo||data.bus?.active||data.coach?.state==='ready'),showG=this.gVisibility==='on'||(this.gVisibility==='auto'&&bus);
  $('coachClock').textContent=formatClock(clock);$('coachSource').textContent=context.demo?'DEMO':context.paused&&valid?'PAVZA':bus?'COACH':'VOZILO';
  $('comfortPanel').hidden=!showG;$('gExtra').hidden=!showG;$('coachPanel').classList.toggle('g-hidden',!showG);
  $('gVisibilityHint').textContent=this.gVisibility==='auto'?'G-meter se prikaže ob zaznani Coach vožnji. Za avtobus brez aktivne vožnje izberi »Vedno pokaži«.':this.gVisibility==='on'?'G-meter je viden pri vsakem vozilu.':'G-meter je skrit; ostali števci ostanejo na voljo.';
  const meter=(context.demo?this.demoMeter:this.meter).update(data,active&&showG);
  const rules=data.coachRules||referenceRules,coachMode=this.comfortMode==='coach',rulesMode=this.comfortMode==='rules';
  const level=coachMode?(context.demo?this.demoPassenger:this.passenger).update(meter,active,this.sensitivity):!meter.valid?'unavailable':rulesMode?comfortLevel(meter.pulseAxes,rules):Math.max(meter.g,meter.intervalPeak)>=this.limit*1.5?'harsh':Math.max(meter.g,meter.intervalPeak)>=this.limit?'firm':'smooth';$('coachPanel').dataset.comfort=level;
  $('gValue').textContent=meter.valid?meter.g.toFixed(2)+' g':'– g';$('gPeak').textContent=`Vrh ${meter.peak.toFixed(2)} g`;
  $('gLabel').textContent=!valid?'NI PODATKOV':context.paused?'PAVZA':!meter.valid?'NI G-PODATKOV':level==='failure'?'ZELO MOČNO':level==='harsh'?'PREMOČNO':level==='firm'?'BOLJ NEŽNO':rulesMode&&meter.axes.y===null?'MANJKA NAVPIČNA OS':'MIRNO';
  $('gVertical').textContent=meter.valid&&meter.axes.y!==null?`Navpično ${(Math.abs(meter.axes.y)/G).toFixed(2)} g`:'Navpično – g';
  $('gSource').textContent=context.demo?'DEMO':coachMode?'UDOBJE · OCENA':rulesMode?'MEJE KAZNI':'LASTNI PRAG';
  const scale=coachMode ? .30/this.sensitivity : rulesMode?Math.max(.5,(rules.limits?.[0]?.x||6)/G):Math.max(.5,this.limit*2),length=Math.hypot(meter.x,meter.z),factor=length>scale?scale/length:1;
  $('gDot').style.setProperty('--gx',(meter.x*factor/scale*23).toFixed(1)+'px');$('gDot').style.setProperty('--gz',(-meter.z*factor/scale*23).toFixed(1)+'px');
  $('hudRpm').textContent=valid&&finite(data.rpm)&&data.rpm>=0?Math.round(data.rpm).toLocaleString(locale()):'–';
  let range=finite(data.fuelRange)&&data.fuelRange>=0?data.fuelRange:null,estimated=false;
  if(range===null&&finite(data.fuelConsumption)&&data.fuelConsumption>0&&finite(data.fuel)){range=data.fuel/data.fuelConsumption;estimated=true}
  $('hudRange').textContent=valid&&range!==null?`${estimated?'≈ ':''}${Math.round(range/(context.units==='mi'?1.609344:1))} ${context.units==='mi'?'mi':'km'}`:context.units==='mi'?'– mi':'– km';
  $('hudCruise').textContent=valid&&finite(data.cruiseSpeed)?data.cruiseSpeed>0?Math.round(data.cruiseSpeed/(context.units==='mi'?1.609344:1))+(context.units==='mi'?' mph':' km/h'):'IZKLOPLJEN':'–';
  const satisfaction=data.bus?.active&&finite(data.bus.satisfaction)&&data.bus.satisfaction>=0&&data.bus.satisfaction<=1?data.bus.satisfaction:null;
  $('hudSatisfaction').textContent=valid&&satisfaction!==null?Math.round(satisfaction*100)+' %':'–';
  $('hudParking').hidden=!(valid&&data.parkingBrake===true);$('hudRetarder').hidden=!(valid&&data.retarder>0);$('hudRetarder').textContent='RET '+data.retarder;$('hudFuelWarning').hidden=!(valid&&range!==null&&range<80);
  const schedule=valid?scheduleStatus(data,context.demo?null:this.manual,this.showEarly):{status:'unavailable',label:'Čakam na vozilo',detail:'GPS in števci ostanejo ob zemljevidu'};
  $('coachScheduleButton').hidden=!bus&&!this.manual;$('coachStop').hidden=!bus;$('coachStages').hidden=!bus;
  $('passengerMetric').hidden=!bus;
  if(context.demo)schedule.detail=schedule.detail.replace('SDK · OCENA','DEMO');
  $('coachScheduleButton').dataset.state=schedule.status;$('scheduleValue').textContent=schedule.label;$('scheduleDetail').textContent=schedule.detail;
  const direct=valid&&data.coach?.state==='ready';
  $('coachStop').textContent=direct?data.bus?.active&&data.bus.stage===data.coach.stage?data.bus.nextStopName||'Aktivna Coach etapa':'Aktivna Coach etapa':valid&&data.bus?.active?data.bus.nextStopName||'Aktivna etapa iz igre':'Aktivni cilj GPS';
  $('coachStages').textContent=direct?`${data.coach.stage+1} / ${data.coach.stages}`:valid&&data.bus?.active&&data.bus.stages>0?`${data.bus.stages} ETAP`:'';
  $('arrivalSave').disabled=!live||clock===null;$('arrivalClear').disabled=!this.manual;
  $('arrivalHint').textContent=direct?'Prikazan je sprotni status vožnje iz aktivne Coach etape. Ročni rezervni čas ga ne preglasi.':this.manual?`Ročno: ${formatClock(this.manual.target)} · rezervna ocena`:'Prednost ima sprotni Coach urnik iz igre. Ročni vnos uporabi le, če branje ni dosegljivo.';
  $('coachReaderHint').textContent=context.game==='ats'?'Coach urnik je na voljo samo v ETS2.':context.demo?'Demo ne potrjuje branja HaulMP.':data.coach?.state==='ready'?'Sprotni Coach urnik iz aktivne etape.':data.coach?.state==='no_bus_job'?'V igri ni aktivne Coach vožnje.':'Čakam na sveže Coach podatke. Rezervni prikaz je ocena.';
  $('comfortLimit').disabled=this.comfortMode!=='custom';$('customComfortSetting').hidden=this.comfortMode!=='custom';$('passengerSensitivitySetting').hidden=!coachMode;$('comfortSensitivityValue').textContent=this.sensitivity.toFixed(1)+'×';
  $('comfortRulesHint').textContent=coachMode?`Zelena: mirno. Oranžna: bolj nežno. Rdeča: premočno. Občutljiv odziv na ovinke in zaviranje; višja nastavitev opozori prej. Pri 1× sta praga 0,10 in 0,20 g. To je nastavljiva ocena HUD-a.`:rulesMode?(rules.state==='files'?'Meje kazni po oseh · lokalna pravila. Prikaz udobja je ocena.':'Meje kazni po oseh · referenčna ocena.'):'Lastni prag primerja vodoravno G-silo.';
  $('dashboardPluginHint').textContent=valid&&!['0.7.0','0.11.0'].includes(data.pluginVersion)?'Za tri osi in kratke sunke namesti vtičnik 0.7.':'Pospešek prihaja iz vozila. Opozorila za udobje so občutljivejša od mej kazni; ne pomenijo neposredno prebrane ocene potnikov.';
 }
}
