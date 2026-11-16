import assert from 'node:assert/strict';
import {MotionTimeline,MapCamera,angleDelta,demoPose} from '../server/wwwroot/camera.js';
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} ≈ ${b}`);
const camera=new MapCamera();
for(const tilt of [0,20,52])for(const heading of [0,90,181,359]){
 camera.configure({width:900,height:500,x:1000,z:2000,zoom:.35,heading,tilt,anchor:.7});
 for(const p of [{x:1000,z:2000},{x:1020,z:1910},{x:800,z:1700}]){const screen=camera.project(p),world=camera.unproject(screen.x,screen.y);assert.ok(world);near(world.x,p.x);near(world.z,p.z)}
}
console.log('PASS: 2D/3D picking round trips at multiple camera headings');
camera.configure({width:640,height:360,x:1000,z:2000,zoom:.35,heading:43,tilt:54,anchor:.6,anchorX:.42});
const shifted=camera.project({x:1000,z:2000});near(shifted.x,640*.42);near(shifted.y,360*.6);const picked=camera.unproject(shifted.x,shifted.y);near(picked.x,1000);near(picked.z,2000);
console.log('PASS: map focus and picking follow the free area between HUD cards');
camera.configure({width:900,height:500,x:0,z:0,zoom:.35,heading:0,tilt:52,anchor:.7});
const far=camera.project({x:100,z:-1000}),nearby=camera.project({x:100,z:200});assert.ok(far.scale<nearby.scale);assert.ok(far.y>camera.horizon);
assert.equal(camera.unproject(450,camera.horizon-10),null);
assert.equal(camera.segment({x:0,z:5000},{x:100,z:6000}),null);
const clipped=camera.segment({x:0,z:0},{x:100,z:5000});assert.ok(clipped);assert.ok(clipped.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
console.log('PASS: perspective depth, horizon picking and clipping behind the camera');
const motion=new MotionTimeline(180);
motion.push({x:0,z:0,heading:359},1000,1);motion.push({x:10,z:0,heading:1},1500,2);
const half=motion.at(1430);near(half.x,5);near(half.heading,0);assert.equal(angleDelta(359,1),2);
assert.equal(motion.push({x:999,z:0,heading:180},1600,2),false);
console.log('PASS: packet interpolation and the shortest turn across 359°/0°');
const predicted=motion.at(1900),frozen=motion.at(99999);near(predicted.x,14);near(frozen.x,14);
motion.push({x:11,z:0,heading:1,paused:true},2000,3);near(motion.at(3000).x,11);
motion.push({x:3000,z:3000,heading:90},3100,4);near(motion.at(3100).x,3000);
console.log('PASS: brief extrapolation is bounded, pause freezes, teleport snaps');
// Wi-Fi may deliver several packets together: retain their source cadence.
const batched=new MotionTimeline(200,{adaptive:true,smoothing:65});
batched.push({x:0,z:0,heading:359},1000,1,5000);
batched.push({x:2,z:0,heading:0},1300,2,5100);
batched.push({x:4,z:0,heading:1},1301,3,5200);
batched.push({x:6,z:0,heading:2},1302,4,5300);
for(let i=1;i<batched.samples.length;i++)near(batched.samples[i].time-batched.samples[i-1].time,100);
let last=batched.at(1310),maxStep=0;
for(let now=1326;now<1900;now+=16){const next=batched.at(now);assert.ok(next.x>=last.x-1e-8,'buffer growth must not reverse travel');maxStep=Math.max(maxStep,next.x-last.x);last=next}
assert.ok(maxStep<.65,`no packet-sized jump: ${maxStep}`);assert.ok(batched.delay>200&&batched.delay<=380);
const held=batched.at(9000);near(held.x,10);near(batched.at(10000).x,10);
batched.push({x:7,z:0,heading:3,paused:true},10001,5,5400);near(batched.at(10002).x,7);
batched.push({x:4000,z:1000,heading:90},10003,6,5500);near(batched.at(10004).x,4000);
console.log('PASS: batched Wi-Fi packets retain source timing, adaptive buffering stays forward and smooth, stale/pause/teleport stay bounded');
// Equal elapsed time produces equal travel, independent of screen refresh rate.
const route={points:[{x:0,z:0},{x:100,z:0},{x:100,z:100}],cumulative:[0,100,200],distance:200};
let last30,last144;for(let i=0;i<=30;i++)last30=demoPose(route,i*1000/30);for(let i=0;i<=144;i++)last144=demoPose(route,i*1000/144);
near(last30.x,last144.x);near(last30.z,last144.z);near(last30.x,40);
const frames=Array.from({length:10},(_,i)=>demoPose(route,i*1000/60));for(let i=1;i<frames.length;i++)near(frames[i].x-frames[i-1].x,40/60);
assert.equal(demoPose(route,100000).finished,true);
console.log('PASS: demo moves every frame at the same speed on 30/60/144 Hz displays');
