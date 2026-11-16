import assert from 'node:assert/strict';
import {catalog,languages} from '../server/wwwroot/translations.js';
import {setLanguage,translate,locale} from '../server/wwwroot/i18n.js';
const keys=new Set();
for(const row of catalog){assert.equal(row.length,7,row[0]);assert.ok(!keys.has(row[0]),'unique key: '+row[0]);keys.add(row[0]);const tokens=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();for(const value of row){assert.ok(value.length>0,row[0]);assert.deepEqual(tokens(value),tokens(row[0]),value)}}
for(const [column,{id}]of languages.entries()){setLanguage(id,false);for(const row of catalog)if(!row[0].includes('{'))assert.equal(translate(row[0]),row[column]);assert.ok(locale().includes('-'));assert.equal(translate('San Francisco'),'San Francisco');assert.ok(translate('ZAMUJAŠ 12 min').includes('12'));assert.ok(translate('V krožišču izberi 3. izvoz').includes('3'));assert.ok(translate('GPS 10:05 · cilj 10:00 · SDK · OCENA').includes('10:05'))}
setLanguage('en',false);assert.equal(translate('  ⌕   Poišči mesto  '),'  ⌕ Find a city  ');assert.equal(translate('Cilj 10:00 · SDK · OCENA'),'Target 10:00 · SDK · ESTIMATE');assert.equal(translate('Vrh 0.25 g'),'Peak 0.25 g');
console.log(`PASS: ${catalog.length} complete unique translation keys in seven languages, preserved parameters, nested dynamic messages and unchanged city names.`);
