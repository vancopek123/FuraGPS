import assert from 'node:assert/strict';
import dgram from 'node:dgram';
const base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28889',port=Number(process.env.FURAGPS_TEST_UDP||28897);assert.notEqual(port,28887);assert.equal(new URL(base).hostname,'127.0.0.1');
const status=id=>fetch(base+'/api/status?game='+id).then(r=>r.json());
for(const id of ['ets2','ats']){
 const s=await status(id);assert.equal(s.gameId,id);assert.equal(s.mapReady,true);assert.equal(s.version,'0.11.1');
 const cities=await fetch(base+'/api/cities?game='+id).then(r=>r.json());assert.ok(cities.length>100);assert.ok(cities.some(c=>c.token===(id==='ats'?'san_francisc':'ljubljana')));assert.equal(cities.some(c=>c.token===(id==='ats'?'ljubljana':'san_francisc')),false);
 for(const [from,to]of id==='ats'?[['san_francisc','sacramento'],['los_angeles','las_vegas'],['phoenix','portland']]:[['ljubljana','koper']]){
  const a=cities.find(c=>c.token===from),b=cities.find(c=>c.token===to);if(!a||!b)continue;
  const response=await fetch(base+'/api/route?game='+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:a.x,z:a.y,toX:b.x,toZ:b.y})});const route=await response.json();assert.equal(response.status,200,JSON.stringify(route));assert.ok(route.points.length>100);assert.ok(route.usedDlcs.every(d=>s.dlcs.includes(d)));console.log(`PASS: ${id} ${from} -> ${to}, ${route.points.length} points, owned DLCs only.`);
 }
 for(const name of ['roads','details']){const response=await fetch(base+`/api/map/${id}/${name}.pmtiles`,{headers:{range:'bytes=0-126'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,127)}
}
assert.equal((await fetch(base+'/api/map/unknown/roads.pmtiles')).status,404);
const socket=dgram.createSocket('udp4');const send=async(game,x,paused=false)=>{const data=Buffer.from(JSON.stringify({game,x,z:200,heading:20,speed:72,positionValid:true,paused}));await new Promise((resolve,reject)=>socket.send(data,port,'127.0.0.1',e=>e?reject(e):resolve()));await new Promise(r=>setTimeout(r,80))};
try{
 await send('ets2',100);await send('ats',500);const ets=await status('ets2'),ats=await status('ats');assert.equal(ets.telemetry.data.x,100);assert.equal(ats.telemetry.data.x,500);assert.equal(ets.telemetry.data.game,'ets2');assert.equal(ats.telemetry.data.game,'ats');assert.ok(ets.telemetry.connected&&ats.telemetry.connected);
 await send('ets2',101,true);assert.equal((await status('auto')).gameId,'ats','paused other game does not steal automatic selection');await send('ets2',102);assert.equal((await status('auto')).gameId,'ets2');assert.equal((await status('ats')).telemetry.data.x,500,'explicit other-game snapshot remains independent');
 console.log('PASS: ETS2/ATS snapshots are independent; automatic game selection follows driving, not a paused second game.');
}finally{socket.close()}
