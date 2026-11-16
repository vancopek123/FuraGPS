import {initI18n,translate,languages,getLanguage,setLanguage,onLanguageChange,writeText} from './i18n.js?v=0.11.1';
initI18n();const $=id=>document.getElementById(id);let previous='',busy=false;
for(const language of languages){const option=document.createElement('option');option.value=language.id;option.textContent=language.name;$('language').append(option)}$('language').value=getLanguage();$('language').onchange=()=>setLanguage($('language').value);
onLanguageChange(()=>{$('language').value=getLanguage()});
function message(text,error=false){writeText($('feedback'),text);$('feedback').hidden=false;$('feedback').dataset.error=String(error)}
export function parseAddress(host,port='28888'){
 let raw=host.trim();if(raw.startsWith('http://')){const url=new URL(raw);if(url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!==''))throw Error();raw=url.hostname;if(url.port)port=url.port}
 if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw))throw Error();const parts=raw.split('.').map(Number);if(parts.some(n=>n>255)||!/^\d{1,5}$/.test(String(port)))throw Error();
 if(!(parts[0]===10||parts[0]===127||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===169&&parts[1]===254)||Number(port)<1||Number(port)>65535)throw Error();
 return 'http://'+parts.join('.')+':'+Number(port);
}
function connect(host,port){try{const address=parseAddress(host,port);if(globalThis.FuraGPSConnectNative){message('Povezujem se …');FuraGPSConnectNative.connect(address)}else message('Predogled povezave. V APK-ju se tukaj odpre navigacija.')}catch{message('Vpiši veljaven lokalni IP in vrata računalnika.',true)}}
$('connectForm').onsubmit=event=>{event.preventDefault();connect($('host').value,$('port').value)};
$('recent').onclick=()=>connect(previous);
$('discover').onclick=()=>{if(busy)return;if(!globalThis.FuraGPSConnectNative){message('Iskanje računalnika je na voljo v Android aplikaciji.');return}busy=true;$('discover').disabled=true;$('devices').replaceChildren();message('Iščem računalnik v omrežju Wi-Fi …');FuraGPSConnectNative.discover()};
globalThis.FuraGPSConnect={
 init(config){if(config.language)setLanguage(config.language,false);if(config.server){previous=config.server;try{const url=new URL(previous);$('host').value=url.hostname;$('port').value=url.port||'28888';$('recentAddress').textContent=url.host;$('recent').hidden=false}catch{}}},
 found(devices){busy=false;$('discover').disabled=false;$('devices').replaceChildren();for(const device of devices){try{const address=parseAddress(device.address);const button=document.createElement('button');button.type='button';button.textContent=(device.name||'Fura GPS')+' · '+new URL(address).host;button.onclick=()=>connect(address);$('devices').append(button)}catch{}}message(devices.length?'Izberi računalnik s seznama.':'Računalnika nisem našel. Zaženi FuraGPS.exe ali vpiši IP ročno.',!devices.length)},
 error(text){message(text,true)}
};
