import assert from 'node:assert/strict';
import dgram from 'node:dgram';
const base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28889';
const port=Number(process.env.FURAGPS_TEST_UDP||28886);
const controller=new AbortController();
const stream=await fetch(base+'/api/telemetry',{signal:controller.signal});
assert.equal(stream.status,200);assert.ok(stream.headers.get('content-type').startsWith('text/event-stream'));
const reader=stream.body.getReader(),decoder=new TextDecoder(),messages=[];let pending='';
const read=(async()=>{try{for(;;){const{value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let index;while((index=pending.indexOf('\n\n'))>=0){const record=pending.slice(0,index);pending=pending.slice(index+2);if(record.startsWith('data: '))messages.push({...JSON.parse(record.slice(6)),received:performance.now()});}}}catch(error){if(error.name!=='AbortError')throw error}})();
const socket=dgram.createSocket('udp4');
try{
 for(let i=0;i<12;i++){
  const data=Buffer.from(JSON.stringify({x:100+i*2,z:200,heading:(359+i*.2)%360,speed:72,speedLimit:80,paused:false,positionValid:true}));
  await new Promise((resolve,reject)=>socket.send(data,port,'127.0.0.1',error=>error?reject(error):resolve()));
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 await new Promise(resolve=>setTimeout(resolve,150));
 const seen=new Set(),live=messages.filter(m=>{if(!m.connected||!m.data.positionValid||seen.has(m.sequence))return false;seen.add(m.sequence);return true});assert.ok(live.length>=10,`received ${live.length}/12 live samples`);
 assert.ok(live.every((m,i)=>i===0||m.sequence>live[i-1].sequence));
 assert.ok(live.every((m,i)=>Number.isFinite(m.sampleTime)&&(i===0||m.sampleTime>live[i-1].sampleTime)),'each new pose carries its monotonic server timestamp');
 const gaps=live.slice(1).map((m,i)=>m.received-live[i].received);
 assert.ok(Math.max(...gaps)<400,`stream gap ${Math.max(...gaps)} ms`);
 assert.equal(live.at(-1).data.x,122);
 console.log(`PASS: SSE delivered ${live.length}/12 unique live poses, maximum packet gap ${Math.round(Math.max(...gaps))} ms`);
 await new Promise(resolve=>setTimeout(resolve,3200));
 assert.equal(messages.at(-1).connected,false);
 console.log('PASS: the same stream marks data stale after the game stops');
}finally{socket.close();controller.abort();await read;}
