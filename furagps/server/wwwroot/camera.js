const RAD=Math.PI/180;
export const angleDelta=(from,to)=>((to-from+540)%360+360)%360-180;
export const wrapHeading=value=>((value%360)+360)%360;

// Keep a short playback buffer. Interpolation removes packet cadence from the
// display; bounded prediction bridges brief jitter without driving on stale data.
export class MotionTimeline {
 constructor(delay=200,{adaptive=false,smoothing=0}={}){this.baseDelay=delay;this.adaptive=adaptive;this.smoothing=smoothing;this.clear();}
 clear(){this.samples=[];this.lastSequence=null;this.offset=null;this.output=null;this.lastRender=null;this.delay=this.baseDelay;this.targetDelay=this.baseDelay;this.jitter=0;this.cadence=[];}
 push(pose,time,sequence,sourceTime=null){
  if(!Number.isFinite(pose.x)||!Number.isFinite(pose.z)||!Number.isFinite(pose.heading))return false;
  if(sequence!=null&&sequence===this.lastSequence)return false;
  let previous=this.samples.at(-1);
  if(previous&&(Math.hypot(pose.x-previous.x,pose.z-previous.z)>250||(sequence!=null&&sequence<this.lastSequence)||(Number.isFinite(sourceTime)&&Number.isFinite(previous.source)&&sourceTime<previous.source))){this.clear();previous=null;}
  const arrival=time,hasSource=Number.isFinite(sourceTime);
  if(hasSource){
   const candidate=arrival-sourceTime;
   const offset=this.offset===null?candidate:Math.min(candidate,this.offset+Math.max(0,arrival-(previous?.arrival??arrival))*.0002);
   if(this.offset!==null){const shift=offset-this.offset;for(const old of this.samples)old.time+=shift}
   this.offset=offset;time=sourceTime+offset;
  }
  if(previous&&this.adaptive&&!pose.paused){
   const gap=arrival-previous.arrival,steps=Math.max(1,(sequence??0)-(this.lastSequence??0));
   if(gap>=20&&gap/steps<=400){this.cadence.push(gap/steps);if(this.cadence.length>16)this.cadence.shift()}
   const sorted=[...this.cadence].sort((a,b)=>a-b),period=sorted[Math.floor(sorted.length/2)]||100;
   const expected=hasSource&&Number.isFinite(previous.source)?sourceTime-previous.source:period*steps;
   this.jitter=Math.max(Math.min(400,Math.abs(gap-expected)),this.jitter*.88);
   this.targetDelay=Math.min(380,Math.max(this.baseDelay,period*1.5)+this.jitter*.9);
  }
  const sample={x:pose.x,z:pose.z,heading:wrapHeading(pose.heading),paused:!!pose.paused,time,arrival,source:hasSource?sourceTime:null};
  if(previous&&this.samples.length&&time<=previous.time)sample.time=previous.time+1;
  this.samples.push(sample);if(this.samples.length>32)this.samples.shift();this.lastSequence=sequence;
  if(sample.paused){this.samples=[sample];this.output=null;}
  return true;
 }
 at(now){
  const a=this.samples;if(!a.length)return null;
  const dt=this.lastRender===null?0:Math.max(0,now-this.lastRender);
  if(this.adaptive){if(dt>1000)this.delay=this.targetDelay;else this.delay+=Math.max(-dt*.05,Math.min(dt*.2,this.targetDelay-this.delay));}
  const raw=this.raw(now-this.delay);
  if(!this.smoothing||!this.output||raw.paused||dt>250){this.output={...raw};}
  else{const mix=1-Math.exp(-dt/this.smoothing);this.output={x:this.output.x+(raw.x-this.output.x)*mix,z:this.output.z+(raw.z-this.output.z)*mix,heading:wrapHeading(this.output.heading+angleDelta(this.output.heading,raw.heading)*mix)};}
  this.lastRender=now;return{...this.output};
 }
 raw(time){
  const a=this.samples;
  if(a.length===1||time<=a[0].time)return {...a[0]};
  for(let i=1;i<a.length;i++)if(time<=a[i].time){const from=a[i-1],to=a[i],t=(time-from.time)/(to.time-from.time);return{x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t,heading:wrapHeading(from.heading+angleDelta(from.heading,to.heading)*t)}}
  const last=a.at(-1),previous=a.at(-2);if(last.paused)return {...last};
  const dt=Math.max(1,last.time-previous.time),extra=Math.max(0,Math.min(200,time-last.time));
  const vx=(last.x-previous.x)/dt,vz=(last.z-previous.z)/dt;
  // Teleports and long gaps are not motion estimates.
  if(dt>1200||Math.hypot(vx,vz)>.08)return {...last};
  const angularVelocity=Math.max(-.12,Math.min(.12,angleDelta(previous.heading,last.heading)/dt));
  return{x:last.x+vx*extra,z:last.z+vz*extra,heading:wrapHeading(last.heading+angularVelocity*extra)};
 }
}

// Perspective projection of the road plane. Labels and HUD stay upright.
// The inverse is used for picking and dragging, including in tilted view.
export class MapCamera {
 constructor(){this.configure({width:900,height:600,x:0,z:0,zoom:.35,heading:0,tilt:0,anchor:.5});}
 configure({width,height,x,z,zoom,heading,tilt,anchor,anchorX=.5}){
  this.width=width;this.height=height;this.x=x;this.z=z;this.zoom=zoom;
  this.rotation=-heading*RAD;this.cos=Math.cos(this.rotation);this.sin=Math.sin(this.rotation);
  this.pitch=tilt*RAD;this.cp=Math.cos(this.pitch);this.sp=Math.sin(this.pitch);
  this.focal=height*.70;this.near=this.focal*.12;this.ox=width*anchorX;this.oy=height*anchor;
  this.horizon=this.sp>0?this.oy-this.focal*this.cp/this.sp:-Infinity;
 }
 plane(x,z){const dx=(x-this.x)*this.zoom,dz=(z-this.z)*this.zoom;return{u:dx*this.cos-dz*this.sin,v:dx*this.sin+dz*this.cos}}
 projectPlane(u,v){const depth=this.focal-v*this.sp,scale=this.focal/Math.max(this.near,depth);return{x:this.ox+u*scale,y:this.oy+v*this.cp*scale,scale,visible:depth>=this.near}}
 project(p){const q=this.plane(p.x,p.z);return this.projectPlane(q.u,q.v)}
 unproject(x,y){const sy=y-this.oy,denominator=this.cp*this.focal+sy*this.sp;if(denominator<=this.focal*.02)return null;
  const v=sy*this.focal/denominator,scale=this.focal/(this.focal-v*this.sp),u=(x-this.ox)/scale;
  return{x:this.x+(u*this.cos+v*this.sin)/this.zoom,z:this.z+(-u*this.sin+v*this.cos)/this.zoom};
 }
 segment(a,b){let p=this.plane(a.x,a.z),q=this.plane(b.x,b.z);const d0=this.focal-p.v*this.sp,d1=this.focal-q.v*this.sp;
  if(d0<this.near&&d1<this.near)return null;
  if(d0<this.near){const t=(this.near-d0)/(d1-d0);p={u:p.u+(q.u-p.u)*t,v:p.v+(q.v-p.v)*t}}
  else if(d1<this.near){const t=(this.near-d0)/(d1-d0);q={u:p.u+(q.u-p.u)*t,v:p.v+(q.v-p.v)*t}}
  return[this.projectPlane(p.u,p.v),this.projectPlane(q.u,q.v)];
 }
}

export function pointAlong(route,distance){
 const pts=route.points,cum=route.cumulative,d=Math.max(0,Math.min(route.distance,distance));let lo=0,hi=pts.length-1;
 while(lo+1<hi){const mid=(lo+hi)>>1;if(cum[mid]<=d)lo=mid;else hi=mid}
 const a=pts[lo],b=pts[Math.min(lo+1,pts.length-1)],t=Math.min(1,(d-cum[lo])/Math.max(.00001,cum[Math.min(lo+1,cum.length-1)]-cum[lo]));
 return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
}
export function demoPose(route,elapsed,speed=40){
 const distance=Math.max(0,Math.min(route.distance,elapsed*speed/1000)),position=pointAlong(route,distance);
 const behind=pointAlong(route,distance-6),ahead=pointAlong(route,distance+10);
 return{...position,heading:wrapHeading(Math.atan2(ahead.x-behind.x,-(ahead.z-behind.z))/RAD),finished:distance>=route.distance};
}
