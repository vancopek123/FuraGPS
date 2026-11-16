import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28889';assert.equal(new URL(base).hostname,'127.0.0.1');
const controller=new AbortController(),records={ets2:[],ats:[]};
async function collect(game){const response=await fetch(base+'/api/telemetry?game='+game,{signal:controller.signal});const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';try{for(;;){const{value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let at;while((at=pending.indexOf('\n\n'))>=0){const row=pending.slice(0,at);pending=pending.slice(at+2);if(row.startsWith('data: '))records[game].push(JSON.parse(row.slice(6)))}}}catch(e){if(e.name!=='AbortError')throw e}}
const streams=['ets2','ats'].map(collect);await new Promise(r=>setTimeout(r,200));
try{for(const [game,sdk]of [['ets2','eut2'],['ats','ats']]){
 await new Promise((resolve,reject)=>{const child=spawn(path.join(root,'build/plugin-test.exe'),['build/test/furagps-telemetry.dll',sdk],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(output)))});await new Promise(r=>setTimeout(r,150));
 const samples=records[game].filter(t=>t.connected&&t.data.positionValid&&t.data.pluginVersion==='0.11.0');assert.ok(samples.length>=3,`${game}: ${samples.length} native samples`);assert.ok(samples.every(t=>t.data.game===game));assert.ok(samples.some(t=>Math.abs(t.data.x-1234.5)<.01&&Math.abs(t.data.speed-72)<.01));assert.ok(samples.some(t=>Number.isFinite(t.data.accelerationX)&&Number.isFinite(t.data.accelerationZ)));console.log(`PASS: SDK ${sdk} -> DLL 0.11 -> UDP 28897 -> ${game} HTTP/SSE, ${samples.length} samples, identity/position/speed/G axes.`);
 }}finally{controller.abort();await Promise.all(streams)}
