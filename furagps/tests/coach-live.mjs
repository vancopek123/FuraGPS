// Opt-in: mirror real telemetry into an ISOLATED test receiver. Never the game
// plugin port or the user's running server. No synthetic position is injected.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
const source=process.env.FURAGPS_LIVE_SOURCE,target=process.env.FURAGPS_TEST_URL,port=Number(process.env.FURAGPS_TEST_UDP);
assert.ok(source&&target&&source!==target&&port>0&&port<65536&&port!==28887,'explicit isolated URLs and non-plugin UDP port required');
assert.equal(new URL(source).hostname,'127.0.0.1');assert.equal(new URL(target).hostname,'127.0.0.1');
const socket=dgram.createSocket('udp4');let ready=null;
try {
 for(let i=0;i<12;i++) {
  const actual=await fetch(source+'/api/status').then(r=>r.json());assert.equal(actual.telemetry.connected,true,'real game telemetry required');
  await new Promise((resolve,reject)=>socket.send(Buffer.from(JSON.stringify(actual.telemetry.data)),port,'127.0.0.1',error=>error?reject(error):resolve()));
  await new Promise(resolve=>setTimeout(resolve,250));
  const test=await fetch(target+'/api/status').then(r=>r.json());assert.equal(test.version,'0.11.1');
  if(test.telemetry.data.coach.state==='ready'){
   ready=test.telemetry.data.coach;assert.equal(ready.stages,actual.telemetry.data.bus.stages);
   if(ready.stage===actual.telemetry.data.bus.stage)assert.equal(ready.planned,actual.telemetry.data.bus.plannedArrival,'derived memory deadline agrees with the current SDK timetable');
  }
 }
 assert.ok(ready,'new reader resolves active Coach timetable from the running HaulMP game');
 console.log('PASS: live HaulMP -> isolated Fura GPS 0.10; active stage '+(ready.stage+1)+'/'+ready.stages+', delay '+ready.delayMinutes+' min, rolling adjustment '+ready.scheduleAdjustment+' min');
}finally{socket.close()}
await new Promise(resolve=>setTimeout(resolve,3200));
const stale=await fetch(target+'/api/status').then(r=>r.json());assert.equal(stale.telemetry.connected,false);assert.equal(stale.telemetry.data.coach.delayMinutes,null);
console.log('PASS: isolated receiver clears Coach status after the mirrored stream stops; source game/server remain untouched');
