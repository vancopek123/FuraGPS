/* Shared with the APK. Reparent existing controls; keep their state/listeners. */
(function(){
 'use strict';
 if(window.FuraGPSHud?.build>=11)return;
 const api=window.FuraGPSHud={build:11,freeRect:null};
 api.setLarge=function(value){document.documentElement.classList.toggle('hud-large',Boolean(value));schedule()};
 let queued=false;
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;measure()})}
 function measure(){
  const root=document.getElementById('hudLayout'),center=document.getElementById('hudCenter');if(!root||!center)return;
  const coach=document.getElementById('coachPanel');root.classList.toggle('hud-no-coach',!coach||coach.hidden);
  const empty=document.getElementById('empty'),driving=!empty||empty.hidden;root.classList.toggle('hud-driving',driving);
  const rect=center.getBoundingClientRect(),toast=document.getElementById('toast'),notice=driving&&toast&&!toast.hidden?Math.min(rect.height,toast.getBoundingClientRect().height+6):0;
  api.freeRect={x:rect.x,y:rect.y+notice,width:rect.width,height:Math.max(0,rect.height-notice)};
  window.dispatchEvent(new Event('furagps-hud-resize'));
 }
 function mount(){
  if(document.getElementById('hudLayout')){document.documentElement.classList.add('furagps-layout');observe(document.getElementById('hudLayout'));return}
  const header=document.querySelector('body > header'),nav=document.getElementById('maneuver'),tools=document.querySelector('.map-controls'),speed=document.querySelector('.speedbox'),distance=document.querySelector('footer');
  if(!header||!tools||!speed||!distance)return;
  const root=document.createElement('div');root.id='hudLayout';
  const coach=document.getElementById('coachPanel'),body=coach?.querySelector('.coach-body'),values=body?.querySelector('.coach-values');
  // Also support the 0.6/0.7 PC interface when this file is injected by the APK.
  let extra=body?.querySelector('.coach-extra');
  if(body&&values&&!extra){extra=document.createElement('details');extra.className='coach-extra';const summary=document.createElement('summary');summary.textContent='Dodatni števci';extra.append(summary,values);body.append(extra)}
  if(extra){const info=document.createElement('div');info.className='g-extra';for(const id of ['gVertical','gPeak']){const node=document.getElementById(id);if(node&&!extra.contains(node))info.append(node)}if(info.children.length)extra.append(info)}
  const slot=(id,node)=>{const box=document.createElement('div');box.id=id;if(node)box.append(node);root.append(box);return box};
  slot('hudHeader',header);slot('hudNavigation',nav);slot('hudCoach',document.getElementById('coachPanel'));slot('hudControls',tools);const center=slot('hudCenter',document.getElementById('empty'));const toast=document.getElementById('toast');if(toast)center.prepend(toast);
  const bottom=slot('hudBottom');bottom.append(speed,distance);distance.classList.add('distance-card');
  const search=document.getElementById('searchButton');if(search&&!tools.contains(search))tools.prepend(search);
  if(values)for(const [id,label]of [['fuel','GORIVO'],['gear','PRESTAVA']]){const node=document.getElementById(id);if(node&&distance.contains(node)){const cell=document.createElement('div'),name=document.createElement('small'),value=document.createElement('b');name.textContent=label;value.append(node);cell.append(name,value);values.append(cell)}}
  if(!distance.querySelector('.distance-caption')){const caption=document.createElement('small');caption.className='distance-caption';caption.textContent='KILOMETRI DO CILJA';distance.querySelector('.trip>div')?.prepend(caption)}
  document.body.append(root);document.documentElement.classList.add('furagps-layout');
  observe(root);
 }
 function observe(root){
  if(typeof ResizeObserver==='function'){const resize=new ResizeObserver(schedule);[root,...root.children].forEach(node=>resize.observe(node))}
  const mutations=new MutationObserver(schedule);mutations.observe(root,{attributes:true,attributeFilter:['hidden','open','class'],subtree:true});
  window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);schedule();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
