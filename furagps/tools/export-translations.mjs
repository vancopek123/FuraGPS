import fs from 'node:fs';
import {catalog,languages} from '../server/wwwroot/translations.js';
for(const row of catalog)if(row.length!==languages.length||row.some(value=>!value))throw Error('Incomplete translation: '+row[0]);
const destination=new URL('../build/android/assets/strings.json',import.meta.url);fs.mkdirSync(new URL('.',destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(Object.fromEntries(catalog.map(row=>[row[0],row]))));
