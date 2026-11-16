import assert from 'node:assert/strict';
const base=process.env.FURAGPS_TEST_URL||'http://127.0.0.1:28888';
const status=await fetch(`${base}/api/status`).then(r=>r.json());
assert.ok(status.roads>300000);assert.ok(status.cities>300);assert.equal(status.telemetry.connected,false);
console.log('PASS: live server, graph, cities, disconnected state');
assert.equal(status.version,'0.11.1');
assert.equal(status.telemetry.data.coach.state,'waiting_vehicle');assert.equal(status.telemetry.data.coach.delayMinutes,null);
assert.ok(['files','reference'].includes(status.telemetry.data.coachRules.state));assert.ok(status.telemetry.data.coachRules.limits.length>0);
const gpsResponse=await fetch(base+'/api/game-gps');assert.equal(gpsResponse.status,200);assert.equal(gpsResponse.headers.get('cache-control'),'no-store');
const gps=await gpsResponse.json();assert.equal(gps.experimental,true);assert.equal(gps.route,null);assert.ok(['waiting_game','waiting_vehicle'].includes(gps.state));
const unchanged=await fetch(base+'/api/game-gps?after='+gps.revision).then(r=>r.json());assert.equal(unchanged.route,null);
const diagnosticResponse=await fetch(base+'/api/game-gps/diagnostics');assert.equal(diagnosticResponse.status,200);assert.ok(diagnosticResponse.headers.get('content-disposition').includes('FuraGPS-GPS-diagnostika.json'));
const diagnostic=await diagnosticResponse.json();assert.equal(diagnostic.appVersion,'0.11.1');assert.equal(diagnostic.snapshot.route,null);
assert.deepEqual(diagnostic.telemetry.data.coachRules,status.telemetry.data.coachRules);assert.equal(diagnostic.telemetry.data.coach.delayMinutes,null);
console.log('PASS: game GPS API, cache control, empty state and diagnostic download never invent a live route');
const cities=await fetch(`${base}/api/cities`).then(r=>r.json());
const pairs=[['ljubljana','koper'],['ljubljana','graz'],['munchen','paris'],['london','berlin'],['madrid','roma']];
let routes=[];
for(const [from,to] of pairs){
 const a=cities.find(c=>c.token===from),b=cities.find(c=>c.token===to);
 assert.ok(a,from);assert.ok(b,to);
 const start=performance.now();
 const response=await fetch(`${base}/api/route`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:a.x,z:a.y,toX:b.x,toZ:b.y,avoidFerries:false})});
 const route=await response.json();assert.equal(response.status,200,JSON.stringify(route));
 assert.ok(route.points.length>10);assert.ok(route.distance>1000);assert.ok(route.instructions.length>0);
 let sum=0,maxGap=0;for(let i=1;i<route.points.length;i++){const p=route.points[i-1],q=route.points[i];const gap=Math.hypot(p.x-q.x,p.z-q.z);assert.ok(Number.isFinite(gap));sum+=gap;maxGap=Math.max(maxGap,gap)}
 assert.ok(Math.abs(sum-route.distance)<1,'route distance matches geometry');
 assert.ok(route.instructions.every(i=>i.index>=0&&i.index<=route.points.length));
 assert.equal(route.instructions.at(-1).kind,'arrive');
 assert.ok(route.usedDlcs.every(d=>status.dlcs.includes(d)),'route stays within installed DLCs');
 console.log(`PASS: ${from} -> ${to}, ${route.edges} edges, ${route.points.length} points, ~${Math.round(route.distance*19/1000)} km, max geometry gap ${maxGap.toFixed(1)} m, ${(performance.now()-start).toFixed(0)} ms`);
 routes.push({from,to,edges:route.edges,points:route.points.length,maxGap,estimatedKm:route.distance*19/1000});
}
const a=cities.find(c=>c.token==='ljubljana');
const bad=await fetch(`${base}/api/route`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:999999,z:0,toX:a.x,toZ:a.y})});assert.equal(bad.status,400);
const disconnected=await fetch(`${base}/api/route`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:450000,z:450000,toX:a.x,toZ:a.y})});assert.equal(disconnected.status,404);
console.log('PASS: invalid coordinates and unavailable roads return clear errors');
const tileX=Math.floor(a.x/4096),tileZ=Math.floor(a.y/4096);
const tile=await fetch(`${base}/api/tile/${tileX}/${tileZ}`).then(r=>r.json());assert.ok(tile.roads.length>0);
assert.ok(tile.roads.every(r=>r.points.length>=4&&r.points.length%2===0));
console.log(`PASS: real Ljubljana tile, ${tile.roads.length} road geometries`);
const overview=await fetch(`${base}/api/tile/2/${Math.floor(a.x/16384)}/${Math.floor(a.y/16384)}`).then(r=>r.json());assert.ok(overview.roads.length>0);
console.log(`PASS: simplified overview tile for phone zooming, ${overview.roads.length} geometries`);
for(const url of ['/','/app.js','/camera.js','/road-renderer.js','/route-geometry.js','/dashboard.js','/style.css','/hud.css','/hud-layout.css','/hud-layout.js','/vendor/maplibre-gl.js','/vendor/pmtiles.js','/FuraGPS.apk']){const r=await fetch(base+url);assert.equal(r.status,200,url);assert.ok((await r.arrayBuffer()).byteLength>100)}
console.log('PASS: frontend and Android APK served locally');
console.log(JSON.stringify(routes,null,2));
