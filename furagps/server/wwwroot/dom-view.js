import {writeText,writeAttribute} from './i18n.js?v=0.11.1';
// Keep unchanged telemetry from invalidating layout, accessibility and styles.
export function createDomLookup(document){
 const elements=new Map(),objects=new WeakMap();
 const object=value=>{
  if(!value||typeof value!=='object')return value;if(objects.has(value))return objects.get(value);
  const methods=new Map(),proxy=new Proxy(value,{
   get(target,key){
    const v=Reflect.get(target,key,target);
    if(key==='style'||key==='dataset')return object(v);
    if(typeof v!=='function')return v;
    if(!methods.has(key))methods.set(key,key==='querySelector'?function(...args){return object(v.apply(target,args))}:key==='setAttribute'?function(name,val){if(['title','aria-label','placeholder'].includes(name)&&typeof target.getAttribute==='function')writeAttribute(target,name,val);else if(typeof target.getAttribute!=='function'||target.getAttribute(name)!==String(val))v.call(target,name,val)}:key==='setProperty'?function(name,val){if(typeof target.getPropertyValue!=='function'||target.getPropertyValue(name)!==String(val))v.call(target,name,val)}:v.bind(target));
    return methods.get(key);
   },
   set(target,key,value){if(key==='textContent'){writeText(target,value);return true}if(Reflect.get(target,key,target)!==value)Reflect.set(target,key,value,target);return true}
  });objects.set(value,proxy);return proxy;
 };
 return id=>{if(!elements.has(id))elements.set(id,object(document.getElementById(id)));return elements.get(id)};
}
