import {catalog,languages} from './translations.js?v=0.11.1';
export {languages};
let language='sl',documentRef=null;
const textBindings=new Map(),attributeBindings=new Map(),listeners=new Set();
const normalize=s=>s.trim().replace(/\s+/g,' ');
const index=new Map(catalog.map(row=>[normalize(row[0]),row]));
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=catalog.filter(row=>/\{\d+\}/.test(row[0])).map(row=>{const keys=[];let cursor=0,expression='^';for(const match of row[0].matchAll(/\{(\d+)\}/g)){expression+=escape(row[0].slice(cursor,match.index))+'(.*?)';keys.push(match[1]);cursor=match.index+match[0].length}return{row,keys,re:new RegExp(expression+escape(row[0].slice(cursor))+'$','u')}});
export const getLanguage=()=>language;
export const locale=()=>({sl:'sl-SI',en:'en-US',de:'de-DE',hr:'hr-HR',it:'it-IT',fr:'fr-FR',es:'es-ES'}[language]);
export function translate(value,depth=0){
 const original=String(value??''),source=normalize(original);if(language==='sl'||!source)return original;
 const column=languages.findIndex(l=>l.id===language),row=index.get(source);let result=row?.[column];
 if(result===undefined&&depth<3)for(const pattern of patterns){const match=source.match(pattern.re);if(match){const values=Object.fromEntries(pattern.keys.map((key,i)=>[key,translate(match[i+1],depth+1)]));result=pattern.row[column].replace(/\{(\d+)\}/g,(_,key)=>values[key]);break}}
 return result===undefined?original:original.replace(original.trim(),result);
}
export function writeText(node,value){const source=String(value??'');textBindings.set(node,source);const next=translate(source);if(node.textContent!==next)node.textContent=next}
export function writeAttribute(node,name,value){const source=String(value);if(!attributeBindings.has(node))attributeBindings.set(node,new Map());attributeBindings.get(node).set(name,source);const next=translate(source);if(node.getAttribute(name)!==next)node.setAttribute(name,next)}
export function localizeTree(root){
 if(!root?.ownerDocument)return;
 const walker=root.ownerDocument.createTreeWalker(root,4);let node;while(node=walker.nextNode()){if(!node.parentElement?.closest('script,style,code,[data-no-translate]')&&!textBindings.has(node)&&node.textContent.trim()){textBindings.set(node,node.textContent);const next=translate(node.textContent);if(next!==node.textContent)node.textContent=next}}
 for(const el of [root,...root.querySelectorAll('[title],[aria-label],[placeholder]')])for(const name of ['title','aria-label','placeholder'])if(el.hasAttribute(name)&&!attributeBindings.get(el)?.has(name))writeAttribute(el,name,el.getAttribute(name));
}
export function onLanguageChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}
export function setLanguage(value,persist=true){
 const next=languages.some(l=>l.id===value)?value:'en';language=next;
 if(persist)try{globalThis.localStorage?.setItem('furagps-language',next);globalThis.FuraGPSNative?.languageChanged(next)}catch{}
 if(documentRef){documentRef.documentElement.lang=next;for(const[node,source]of textBindings)if(node.isConnected){const value=translate(source);if(node.textContent!==value)node.textContent=value}for(const[node,attributes]of attributeBindings)if(node.isConnected)for(const[name,source]of attributes){const value=translate(source);if(node.getAttribute(name)!==value)node.setAttribute(name,value)}documentRef.getElementById('language')?.setAttribute('data-language',next);}
 for(const fn of listeners)fn(next);
}
export function initI18n(document=globalThis.document){
 documentRef=document;let saved;try{saved=new URL(globalThis.location.href).searchParams.get('lang')||globalThis.localStorage?.getItem('furagps-language')}catch{}
 const candidate=saved||globalThis.navigator?.language?.split('-')[0]||'en';setLanguage(candidate,false);localizeTree(document.body);
 globalThis.FuraGPSI18n={setLanguage,getLanguage};
 return language;
}
