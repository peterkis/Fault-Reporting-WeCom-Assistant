import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {validateYxxCatalog,validateYxxCatalogWithSuccessors} from '../app/server/scripts/yxx-self-service-migrate.mjs';

type Constraint={relation:string;name:string;type:string;validated:boolean;deferrable:boolean;deferred:boolean;definition:string};
type IndexEntry={relation:string;name:string;unique_index:boolean;valid:boolean;ready:boolean;definition:string};
type Catalog={relations:unknown[];columns:unknown[];constraints:Constraint[];indexes:IndexEntry[];forbidden_timezone_columns:number};
type SuccessorMap={'071':Constraint[];'072':Constraint[];'076_indexes':IndexEntry[];'077_indexes':IndexEntry[]};

const readJson=(name:string):unknown=>JSON.parse(readFileSync(new URL('../contracts/'+name,import.meta.url),'utf8'));
const frozenMap=readJson('yxx_self_service_catalog.json') as Record<string,Catalog>;
const frozen=frozenMap['034'];
if(!frozen)throw new Error('Missing 034 catalog');
const capture=readJson('yxx_current_migration_catalog.v2.json');
assert.ok(capture&&typeof capture==='object'&&'catalogs' in capture);
assert.ok(capture.catalogs&&typeof capture.catalogs==='object'&&'yxx' in capture.catalogs);
const captured=capture.catalogs.yxx;
assert.ok(captured&&typeof captured==='object'&&'columns' in captured&&Array.isArray(captured.columns));
const successors=readJson('yxx_self_service_catalog_successors.json') as SuccessorMap;
const cmp=(a:string,b:string)=>(a<b?-1:a>b?1:0);
const withSuccessors=(replacements:Constraint[],addedIndexes:IndexEntry[]=[]):Catalog=>{
 const copy=structuredClone(frozen);
 if(addedIndexes.length)Object.assign(copy,structuredClone(captured));
 for(const item of replacements){const index=copy.constraints.findIndex(c=>c.relation===item.relation&&c.name===item.name);assert.ok(index>=0,item.name);copy.constraints[index]=item;}
 copy.indexes.push(...addedIndexes);
 copy.indexes.sort((a,b)=>cmp(a.relation,b.relation)||cmp(a.name,b.name));
 return copy;
};
const drift={code:'YXX_SELF_SERVICE_CATALOG_DRIFT'};

test('SS-010 catalog: the frozen 034 contract is unchanged and successors replace only their recorded Intake constraints and indexes',()=>{
 assert.deepEqual(successors['071'].map(c=>c.name),['service_intake_event_type_check']);
 assert.deepEqual(successors['072'].map(c=>c.name),['service_intake_status_check','service_intake_event_type_check']);
 for(const item of [...successors['071'],...successors['072']])assert.ok(frozen.constraints.some(c=>c.relation===item.relation&&c.name===item.name&&c.definition!==item.definition),item.name);
 assert.match(String(successors['072'].find(c=>c.name==='service_intake_status_check')?.definition),/'DISMISSED'::text/u);
 assert.doesNotMatch(String(successors['072'].find(c=>c.name==='service_intake_status_check')?.definition),/'IGNORED'::text/u);
 assert.match(String(successors['072'].find(c=>c.name==='service_intake_event_type_check')?.definition),/'intake\.dismissed'::text/u);

 // Every 076/077 Yxx index entry must match the corresponding migration SQL exactly.
 const sql076=readFileSync(new URL('../database/migrations/076_fk_indexes.sql',import.meta.url),'utf8');
 const sql077=readFileSync(new URL('../database/migrations/077_retention_and_time_contract.sql',import.meta.url),'utf8');
 assert.equal(successors['076_indexes'].length,20);
 assert.equal(successors['077_indexes'].length,4);
 for(const [sql,entries] of [[sql076,successors['076_indexes']],[sql077,successors['077_indexes']]] as const){
  const statements=sql.replace(/--[^\n]*/gu,'').split(';').map(statement=>statement.trim().replace(/\s+/gu,' '));
  for(const entry of entries){
   assert.ok(entry.definition.startsWith('CREATE INDEX '+entry.name+' ON '+entry.relation+' USING btree ('),entry.name);
   assert.ok(statements.includes(entry.definition.replace(' USING btree (',' (')),entry.name);
  }
 }
});

test('SS-010 catalog: each schema is accepted only with exactly the successors registered for it',()=>{
 const at071=withSuccessors(successors['071']),at072=withSuccessors(successors['072']);
 const at076=withSuccessors(successors['072'],successors['076_indexes']);
 const at077=withSuccessors(successors['072'],successors['077_indexes']);
 const at076and077=withSuccessors(successors['072'],[...successors['076_indexes'],...successors['077_indexes']]);

 assert.equal(validateYxxCatalogWithSuccessors(frozen),frozen);
 assert.equal(validateYxxCatalogWithSuccessors(at071,{successors:['071']}),at071);
 assert.equal(validateYxxCatalogWithSuccessors(at072,{successors:['071','072']}),at072);
 assert.equal(validateYxxCatalogWithSuccessors(at076,{successors:['071','072','076']}),at076);
 assert.equal(validateYxxCatalogWithSuccessors(at077,{successors:['071','072','077']}),at077);
 assert.equal(validateYxxCatalogWithSuccessors(at076and077,{successors:['071','072','076','077']}),at076and077);

 // The index-only projection on 034 lacks the real 042/064 columns and constraints.
 const impossible=structuredClone(at076and077);
 impossible.columns=structuredClone(frozen.columns);
 assert.throws(()=>validateYxxCatalogWithSuccessors(impossible,{successors:['071','072','076','077']}),drift);
 // The original stage contract keeps rejecting every successor; the successor-aware check never loosens it.
 assert.throws(()=>validateYxxCatalog(at071),drift);assert.throws(()=>validateYxxCatalog(at072),drift);
 assert.throws(()=>validateYxxCatalog(at076and077),drift);

 // A schema must match its registry: no successor claimed for a changed catalog, or claimed for an unchanged one.
 for(const [inventory,claimed] of [
  [at071,[]],[at072,[]],[at072,['071']],[frozen,['071']],[frozen,['071','072']],[at071,['071','072']],
  [at076,['071','072']],[at077,['071','072']],[at076and077,['071','072','076']],[at076and077,['071','072','077']],[at072,['071','072','076','077']],
 ] as const)
  assert.throws(()=>validateYxxCatalogWithSuccessors(inventory,{successors:[...claimed]}),drift,JSON.stringify(claimed));

 // Only lawful ordered profiles exist; 072 never stands without 071, and 076/077 never stand without 071+072.
 for(const claimed of [['072'],['072','071'],['071','071'],['070'],['076'],['077'],['071','076'],['071','072','077','076']])
  assert.throws(()=>validateYxxCatalogWithSuccessors(at076and077,{successors:claimed}),drift,JSON.stringify(claimed));
});

test('SS-010 catalog: any drift outside the recorded successor constraints or indexes is still rejected',()=>{
 const at072=withSuccessors(successors['072']);
 const changed=(base:Catalog,mutate:(catalog:Catalog)=>void)=>{const copy=structuredClone(base);mutate(copy);return copy;};
 const cases:Array<[string,Catalog,string[]]>=[
  ['other constraint',changed(at072,c=>{const other=c.constraints.find(x=>x.name!=='service_intake_status_check'&&x.name!=='service_intake_event_type_check');assert.ok(other);other.definition+=' ';}),['071','072']],
  ['successor constraint edited',changed(at072,c=>{const status=c.constraints.find(x=>x.name==='service_intake_status_check');assert.ok(status);status.definition=status.definition.replace("'FAILED'::text","'FAILED'::text, 'EXTRA'::text");}),['071','072']],
  ['constraint validity',changed(at072,c=>{const status=c.constraints.find(x=>x.name==='service_intake_status_check');assert.ok(status);status.validated=false;}),['071','072']],
  ['extra constraint',changed(at072,c=>{c.constraints.push({...c.constraints[0] as Constraint,name:'zz_extra_check'});}),['071','072']],
  ['index',changed(at072,c=>{c.indexes.pop();}),['071','072']],
  ['column',changed(at072,c=>{c.columns.pop();}),['071','072']],
  ['relation',changed(at072,c=>{c.relations.pop();}),['071','072']],
  ['timezone columns',changed(at072,c=>{c.forbidden_timezone_columns=1;}),['071','072']],
  ['missing 076 index',changed(withSuccessors(successors['072'],successors['076_indexes']),c=>{c.indexes=c.indexes.filter(i=>i.name!=='channel_leg_conversation_thread_fk_idx');}),['071','072','076']],
  ['extra unexpected index at 076+077',changed(withSuccessors(successors['072'],[...successors['076_indexes'],...successors['077_indexes']]),c=>{c.indexes.push({relation:'intake.service_intake',name:'zz_rogue_idx',unique_index:false,valid:true,ready:true,definition:'CREATE INDEX zz_rogue_idx ON intake.service_intake USING btree (id)'});}),['071','072','076','077']],
  ['altered 077 index definition',changed(withSuccessors(successors['072'],successors['077_indexes']),c=>{const idx=c.indexes.find(i=>i.name==='service_intake_retention_epoch_idx');assert.ok(idx);idx.definition='CREATE INDEX service_intake_retention_epoch_idx ON intake.service_intake USING btree (retention_until_epoch_ms)';}),['071','072','077']],
  ['invalid 076 index flag',changed(withSuccessors(successors['072'],successors['076_indexes']),c=>{const idx=c.indexes.find(i=>i.name==='web_submission_command_receipt_fk_idx');assert.ok(idx);idx.valid=false;}),['071','072','076']],
 ];
 for(const [name,inventory,claimed] of cases)assert.throws(()=>validateYxxCatalogWithSuccessors(inventory,{successors:claimed}),drift,name);
 assert.throws(()=>validateYxxCatalogWithSuccessors(null,{successors:[]}),drift);
});
