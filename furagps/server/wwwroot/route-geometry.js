const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
function direction(a,b){const d=distance(a,b);return d>.00001?{x:(b.x-a.x)/d,z:(b.z-a.z)/d}:null}
const dot=(a,b)=>a.x*b.x+a.z*b.z;
export function simplify(points,tolerance=.35){
 if(points.length<3)return points.slice();const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;const stack=[[0,points.length-1]],sq=tolerance*tolerance;
 while(stack.length){const[start,end]=stack.pop(),a=points[start],b=points[end],dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz;let max=sq,index=-1;
  for(let i=start+1;i<end;i++){const p=points[i],t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/len)):0,d=(p.x-a.x-dx*t)**2+(p.z-a.z-dz*t)**2;if(d>max){max=d;index=i}}
  if(index>=0){keep[index]=1;stack.push([start,index],[index,end])}
 }return points.filter((_,i)=>keep[i]);
}
function sample(points,cumulative,s){let lo=0,hi=points.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(cumulative[m]<=s)lo=m;else hi=m}return{point:mix(points[lo],points[hi],Math.max(0,Math.min(1,(s-cumulative[lo])/(cumulative[hi]-cumulative[lo]||1)))),index:lo}}

// Routing segments can end on opposite lane offsets at the same graph node.
// Replace only short transverse seams between almost parallel road tangents.
// This changes display geometry; the route graph, manoeuvres and distances stay intact.
export function prepareDisplayRoute(input){
 const points=input.filter((p,i)=>Number.isFinite(p.x)&&Number.isFinite(p.z)&&(i===0||distance(p,input[i-1])>.005)).map(p=>({x:p.x,z:p.z}));
 if(points.length<3)return points;
 const cumulative=[0];for(let i=1;i<points.length;i++)cumulative[i]=cumulative[i-1]+distance(points[i-1],points[i]);
 const candidates=[],seams=new Set();
 for(let i=1;i<points.length-2;i++){
  const a=points[i-1],b=points[i],c=points[i+1],d=points[i+2],length=distance(b,c),incoming=direction(a,b),outgoing=direction(c,d),step=direction(b,c);
  if(!incoming||!outgoing||!step||length<.65||length>16||dot(incoming,outgoing)<.97||Math.abs(dot(incoming,step))>.48)continue;
  const reach=Math.max(7,Math.min(35,length*2.4)),startS=Math.max(0,cumulative[i]-reach),endS=Math.min(cumulative.at(-1),cumulative[i+1]+reach);
  seams.add(i);candidates.push({i,startS,endS,incoming});
 }
 const groups=[];
 for(const candidate of candidates){const previous=groups.at(-1);if(previous&&candidate.startS<=previous.endS+2&&candidate.endS-previous.startS<160&&dot(previous.incoming,candidate.incoming)>.97)previous.endS=Math.max(previous.endS,candidate.endS);else groups.push({...candidate})}
 const spans=[];
 for(const group of groups){const {startS,endS,incoming}=group;
  const start=sample(points,cumulative,startS),end=sample(points,cumulative,endS);let straight=true;
  for(let j=start.index;j<=end.index;j++){
   if(seams.has(j))continue;const v=direction(points[j],points[j+1]);if(v&&dot(v,incoming)<.92){straight=false;break}
  }
  if(!straight)continue;
  const t0=direction(start.point,sample(points,cumulative,Math.min(endS,startS+3)).point)||incoming,t1=direction(sample(points,cumulative,Math.max(startS,endS-3)).point,end.point)||incoming,handle=distance(start.point,end.point)/3;
  spans.push({startS,endS,start,end,c1:{x:start.point.x+t0.x*handle,z:start.point.z+t0.z*handle},c2:{x:end.point.x-t1.x*handle,z:end.point.z-t1.z*handle}});
 }
 const out=[];let cursor=0;
 for(const span of spans){while(cursor<points.length&&cumulative[cursor]<span.startS)out.push(points[cursor++]);out.push(span.start.point);
  const count=Math.max(8,Math.ceil((span.endS-span.startS)/1.5));for(let j=1;j<count;j++){const t=j/count,u=1-t;out.push({x:u*u*u*span.start.point.x+3*u*u*t*span.c1.x+3*u*t*t*span.c2.x+t*t*t*span.end.point.x,z:u*u*u*span.start.point.z+3*u*u*t*span.c1.z+3*u*t*t*span.c2.z+t*t*t*span.end.point.z})}
  out.push(span.end.point);while(cursor<points.length&&cumulative[cursor]<=span.endS)cursor++;
 }
 while(cursor<points.length)out.push(points[cursor++]);
 // A small, bounded corner fillet removes hard pixel corners without cutting
 // through a genuine hairpin, roundabout or motorway exit.
 const clean=simplify(out),rounded=[clean[0]];
 for(let i=1;i<clean.length-1;i++){const a=clean[i-1],b=clean[i],c=clean[i+1],v0=direction(a,b),v1=direction(b,c);if(!v0||!v1||dot(v0,v1)<-.65||dot(v0,v1)>.998){rounded.push(b);continue}
  const cut=Math.min(1.4,distance(a,b)*.2,distance(b,c)*.2),p={x:b.x-v0.x*cut,z:b.z-v0.z*cut},q={x:b.x+v1.x*cut,z:b.z+v1.z*cut};rounded.push(p);for(const t of[.25,.5,.75]){const u=1-t;rounded.push({x:u*u*p.x+2*u*t*b.x+t*t*q.x,z:u*u*p.z+2*u*t*b.z+t*t*q.z})}rounded.push(q);
 }
 rounded.push(clean.at(-1));return rounded;
}
