import {prepareDisplayRoute} from './route-geometry.js?v=0.11.1';
const R=300000,DEG=180/Math.PI;
export function toGeo(p){return[p.x/R*DEG,(2*Math.atan(Math.exp(-p.z/R))-Math.PI/2)*DEG]}
export function toGame(p){return{x:p.lng/DEG*R,z:-R*Math.log(Math.tan((p.lat/DEG+Math.PI/2)/2))}}
export function mapZoom(scale){return Math.log2(scale*2*Math.PI*R/512)}
export const renderPixelRatio=(quality,density=globalThis.devicePixelRatio||1)=>Math.min(density,quality==='sharp'?1.75:1);
const themes={
 light:{land:'#e9eee5',water:'#b4d4df',shore:'#95bdc9',area:'#d9e1d3',road:'#fffdf7',edge:'#b5bdb9',border:'#bbc8ba',route:'#12bbaa',routeEdge:'#087c79'},
 dark:{land:'#152431',water:'#0d1b2b',shore:'#243f52',area:'#1e303d',road:'#667b8c',edge:'#223744',border:'#2c4250',route:'#66e5d1',routeEdge:'#0d6966'}
};
const roadWidth=['interpolate',['exponential',1.6],['zoom'],6,1,8,2.4,10,6,12,15,14,35];
const edgeWidth=['interpolate',['exponential',1.6],['zoom'],6,1.8,8,3.6,10,8.5,12,19,14,41];
export function makeMapStyle(light,base,game='ets2'){const t=themes[light?'light':'dark'];return{
 version:8,name:'Fura GPS road map',
 sources:{roads:{type:'vector',url:`pmtiles://${base}/api/map/${game}/roads.pmtiles`},details:{type:'vector',url:`pmtiles://${base}/api/map/${game}/details.pmtiles`},route:{type:'geojson',lineMetrics:true,data:{type:'FeatureCollection',features:[]}}},
 sky:{'sky-color':t.land,'horizon-color':t.land,'fog-color':t.land,'sky-horizon-blend':.8,'horizon-fog-blend':.2,'fog-ground-blend':.08},
 layers:[
  {id:'land',type:'background',paint:{'background-color':t.water}},
  // This archive's historical "water" layer is a land/coast mask.
  {id:'water',type:'fill',source:'details','source-layer':'water',paint:{'fill-color':t.land,'fill-antialias':true}},
  {id:'shore',type:'line',source:'details','source-layer':'water',paint:{'line-color':t.shore,'line-width':1,'line-opacity':.7}},
  {id:'areas',type:'fill',source:'details','source-layer':'mapAreas',minzoom:8,paint:{'fill-color':t.area,'fill-opacity':.7,'fill-antialias':true}},
  {id:'country-borders',type:'line',source:'details','source-layer':'countries',paint:{'line-color':t.border,'line-width':1,'line-dasharray':[4,4],'line-opacity':.45}},
  {id:'roads-edge',type:'line',source:'roads','source-layer':game,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':t.edge,'line-width':edgeWidth}},
  {id:'roads-fill',type:'line',source:'roads','source-layer':game,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':t.road,'line-width':roadWidth}},
  // Junctions and depot aprons are actual map polygons. They join the road ends
  // without synthesizing connections between nearby but unrelated streets.
  {id:'junctions',type:'fill',source:'details','source-layer':'prefabs',minzoom:8,paint:{'fill-color':t.road,'fill-antialias':true}},
  {id:'route-edge',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':t.routeEdge,'line-width':10,'line-opacity':.75}},
  {id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':t.route,'line-width':7}}
 ]
}}

export class RoadRenderer {
 constructor(container,{light=false,quality='smooth',game='ets2',onRender=()=>{},onError=()=>{},onReady=()=>{}}={}){
  this.light=light;this.quality=quality;this.ready=false;this.lastFrame='';this.route=null;this.progress=-1;this.onError=onError;this.renderPending=true;this.cityGeo=new WeakMap();
  const gl=globalThis.maplibregl,pm=globalThis.pmtiles;
  if(!gl||!pm)throw Error('Knjižnice zemljevida niso naložene. Preveri celotno mapo wwwroot.');
  if(typeof gl.supported==='function'&&!gl.supported())throw Error('3D zemljevid potrebuje WebGL. Preveri strojno pospeševanje brskalnika oziroma Android System WebView.');
  if(!RoadRenderer.protocol){RoadRenderer.protocol=new pm.Protocol();gl.addProtocol('pmtiles',RoadRenderer.protocol.tile)}
  this.game=game;this.map=new gl.Map({container,style:makeMapStyle(light,location.origin,game),center:[0,0],zoom:mapZoom(.35),pitch:58,bearing:0,interactive:false,attributionControl:false,renderWorldCopies:false,maxPitch:65,minZoom:5.5,maxZoom:14,fadeDuration:0,pixelRatio:renderPixelRatio(quality),maxTileCacheSize:160,canvasContextAttributes:{antialias:false},validateStyle:true});
  this.map.on('render',()=>{this.renderPending=false;onRender()});
  this.map.on('error',e=>{console.error('Fura GPS map:',e.error);onError('Zemljevida ni bilo mogoče naložiti. Preveri, ali sta datoteki roads.pmtiles in details.pmtiles v mapi data.')});
  this.map.on('style.load',()=>{this.ready=true;this.applyTheme(this.light);if(this.pendingRoute)this.setRoute(this.pendingRoute);onReady()});
 }
 setGame(game){if(game===this.game)return;this.game=game;this.ready=false;this.route=null;this.pendingRoute=null;this.lastFrame='';this.renderPending=true;this.map.setStyle(makeMapStyle(this.light,location.origin,game),{diff:false});}
 frame({x,z,zoom,heading,tilt,anchor,anchorX=.5,width,height}){
  const key=[x,z,zoom,heading,tilt,anchor,anchorX,width,height].map(v=>Number(v).toFixed(5)).join(',');if(key===this.lastFrame)return;this.lastFrame=key;
  if(this.width!==width||this.height!==height){this.width=width;this.height=height;this.map.resize()}
  this.renderPending=true;
  const dy=(anchor*2-1)*height,dx=(anchorX*2-1)*width;
  this.map.jumpTo({center:toGeo({x,z}),zoom:mapZoom(zoom),bearing:heading,pitch:tilt,padding:{top:Math.max(0,dy),bottom:Math.max(0,-dy),left:Math.max(0,dx),right:Math.max(0,-dx)}});
 }
 setQuality(quality){this.quality=quality;this.renderPending=true;this.map.setPixelRatio(renderPixelRatio(quality));}
 visibleCities(cities){
  const bounds=this.map.getBounds(),out=[];
  for(const city of cities){let geo=this.cityGeo.get(city);if(!geo){geo=toGeo({x:city.x,z:city.y});this.cityGeo.set(city,geo)}if(!bounds.contains(geo))continue;const q=this.map.project(geo);out.push({city,p:{x:q.x,y:q.y,visible:Number.isFinite(q.x)&&Number.isFinite(q.y)}})}
  return out;
 }
 project(p){const q=this.map.project(toGeo(p));return{x:q.x,y:q.y,visible:Number.isFinite(q.x)&&Number.isFinite(q.y)}}
 unproject(x,y){const p=toGame(this.map.unproject([x,y]));return Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.abs(p.x)<300000&&Math.abs(p.z)<300000?p:null}
 setRoute(route){
  if(!this.ready){this.pendingRoute=route;return}
  if(this.route===route)return;this.route=route;this.pendingRoute=null;this.progress=-1;
  this.map.getSource('route').setData(route?{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:prepareDisplayRoute(route.points).map(toGeo)}}:{type:'FeatureCollection',features:[]});
  this.setProgress(0);
 }
 setProgress(ratio){this.progress=Math.max(0,Math.min(1,ratio));}
 applyTheme(light){this.light=light;if(!this.ready)return;const t=themes[light?'light':'dark'];
  for(const[id,key,prop]of[['land','water','background-color'],['water','land','fill-color'],['shore','shore','line-color'],['areas','area','fill-color'],['country-borders','border','line-color'],['roads-edge','edge','line-color'],['roads-fill','road','line-color'],['junctions','road','fill-color'],['route-edge','routeEdge','line-color'],['route-line','route','line-color']])this.map.setPaintProperty(id,prop,t[key]);
  this.map.setSky({'sky-color':t.land,'horizon-color':t.land,'fog-color':t.land,'sky-horizon-blend':.8,'horizon-fog-blend':.2,'fog-ground-blend':.08});const progress=this.progress;this.progress=-1;this.setProgress(Math.max(0,progress));
 }
}
