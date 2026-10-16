import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { snapshotP2016 } from '../../src/p2-016-domain-contracts.mjs';
import { assertLocalDateTime,assertEpochMsString } from '../../src/platform/time-contract.mjs';
const cache=new Map();
// Test-only checks for the exact JSON Schema vocabulary used by the P2-016 contracts; runtime uses domain guards.
export async function assertP2016Schema(name,input){
  const value=snapshotP2016(input);
  const load=async filename=>{assert.match(filename,/^[a-z0-9_-]+\.schema\.json$/u);if(!cache.has(filename))cache.set(filename,JSON.parse(await readFile(new URL('../../contracts/'+filename,import.meta.url),'utf8')));return cache.get(filename);};
  async function visit(schema,v,location,document){
    if(schema.$ref){
      if(schema.$ref.startsWith('#/')){assert.match(schema.$ref,/^#\/\$defs\/[a-zA-Z0-9_-]+$/u);const key=schema.$ref.slice('#/$defs/'.length);assert.ok(document.$defs&&Object.hasOwn(document.$defs,key),location+' defined local ref');return visit(document.$defs[key],v,location,document);}
      const reference=schema.$ref.replace(/^\.\//u,'');
      if(reference==='local_datetime.schema.json')assertLocalDateTime(v);if(reference==='epoch_ms_string.schema.json')assertEpochMsString(v);
      const external=await load(reference);return visit(external,v,location,external);
    }
    if(schema.anyOf){let matched=false;for(const candidate of schema.anyOf){try{await visit(candidate,v,location,document);matched=true;break;}catch{/* next defined alternative */}}assert.ok(matched,location+' matches no alternative');}
    if(schema.oneOf){let matches=0;for(const candidate of schema.oneOf){try{await visit(candidate,v,location,document);matches++;}catch{/* next defined alternative */}}assert.equal(matches,1,location+' must match exactly one alternative');}
    for(const candidate of schema.allOf??[])await visit(candidate,v,location,document);
    if(schema.if){let matches=true;try{await visit(schema.if,v,location,document);}catch{matches=false;}const branch=matches?schema.then:schema.else;if(branch)await visit(branch,v,location,document);}
    if(Object.hasOwn(schema,'const'))assert.deepEqual(v,schema.const,location);
    if(schema.enum)assert.ok(schema.enum.includes(v),location+' enum');
    if(schema.type==='null')assert.equal(v,null,location);
    if(schema.type==='boolean')assert.equal(typeof v,'boolean',location);
    if(schema.type==='integer'||schema.type==='number'){assert.equal(typeof v,'number',location);assert.ok(Number.isFinite(v),location);if(schema.type==='integer')assert.ok(Number.isInteger(v),location);if(schema.minimum!==undefined)assert.ok(v>=schema.minimum,location);if(schema.maximum!==undefined)assert.ok(v<=schema.maximum,location);}
    if(schema.type==='string'){assert.equal(typeof v,'string',location);if(schema.minLength!==undefined)assert.ok(v.length>=schema.minLength,location);if(schema.maxLength!==undefined)assert.ok(v.length<=schema.maxLength,location);if(schema.pattern)assert.match(v,new RegExp(schema.pattern,'u'),location);}
    if(schema.type==='array')assert.ok(Array.isArray(v),location);
    if(Array.isArray(v)){if(schema.minItems!==undefined)assert.ok(v.length>=schema.minItems,location);if(schema.maxItems!==undefined)assert.ok(v.length<=schema.maxItems,location);if(schema.items)for(let i=0;i<v.length;i++)await visit(schema.items,v[i],location+'['+i+']',document);}
    if(schema.type==='object')assert.ok(v!==null&&typeof v==='object'&&!Array.isArray(v),location);
    if(v!==null&&typeof v==='object'&&!Array.isArray(v)){
      for(const key of schema.required??[])assert.ok(Object.hasOwn(v,key),location+'.'+key+' required');
      if(schema.additionalProperties===false)assert.ok(Object.keys(v).every(k=>Object.hasOwn(schema.properties??{},k)),location+' closed keys');
      for(const [key,child]of Object.entries(v))if(schema.properties?.[key])await visit(schema.properties[key],child,location+'.'+key,document);
    }
  }
  const document=await load(name+'.schema.json');await visit(document,value,name,document);
}
