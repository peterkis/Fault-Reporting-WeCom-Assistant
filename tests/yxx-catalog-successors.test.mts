import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {validateYxxCatalog,validateYxxCatalogWithSuccessors} from '../app/server/scripts/yxx-self-service-migrate.mjs';

type Constraint={relation:string;name:string;type:string;validated:boolean;deferrable:boolean;deferred:boolean;definition:string};
type Catalog={relations:unknown[];columns:unknown[];constraints:Constraint[];indexes:unknown[];forbidden_timezone_columns:number};
const read=(name:string)=>JSON.parse(readFileSync(new URL('../contracts/'+name,import.meta.url),'utf8')) as Record<string,unknown>;
const frozen=read('yxx_self_service_catalog.json')['034'] as Catalog,successors=read('yxx_self_service_catalog_successors.json') as Record<'071'|'072',Constraint[]>;
const withConstraints=(replacements:Constraint[]):Catalog=>{
 const copy=structuredClone(frozen);
 for(const item of replacements){const index=copy.constraints.findIndex(c=>c.relation===item.relation&&c.name===item.name);assert.ok(index>=0,item.name);copy.constraints[index]=item;}
 return copy;
};
const drift={code:'YXX_SELF_SERVICE_CATALOG_DRIFT'};

test('SS-010 catalog: the frozen 034 contract is unchanged and successors replace only their recorded Intake constraints',()=>{
 assert.deepEqual(successors['071'].map(c=>c.name),['service_intake_event_type_check']);
 assert.deepEqual(successors['072'].map(c=>c.name),['service_intake_status_check','service_intake_event_type_check']);
 for(const item of [...successors['071'],...successors['072']])assert.ok(frozen.constraints.some(c=>c.relation===item.relation&&c.name===item.name&&c.definition!==item.definition),item.name);
 assert.match(String(successors['072'].find(c=>c.name==='service_intake_status_check')?.definition),/'DISMISSED'::text/u);
 assert.doesNotMatch(String(successors['072'].find(c=>c.name==='service_intake_status_check')?.definition),/'IGNORED'::text/u);
 assert.match(String(successors['072'].find(c=>c.name==='service_intake_event_type_check')?.definition),/'intake\.dismissed'::text/u);
});

test('SS-010 catalog: each schema is accepted only with exactly the successors registered for it',()=>{
 const at071=withConstraints(successors['071']),at072=withConstraints(successors['072']);
 assert.equal(validateYxxCatalogWithSuccessors(frozen),frozen);
 assert.equal(validateYxxCatalogWithSuccessors(at071,{successors:['071']}),at071);
 assert.equal(validateYxxCatalogWithSuccessors(at072,{successors:['071','072']}),at072);
 // The original stage contract keeps rejecting every successor; the successor-aware check never loosens it.
 assert.throws(()=>validateYxxCatalog(at071),drift);assert.throws(()=>validateYxxCatalog(at072),drift);
 // A schema must match its registry: no successor claimed for a changed catalog, or claimed for an unchanged one.
 for(const [inventory,claimed] of [[at071,[]],[at072,[]],[at072,['071']],[frozen,['071']],[frozen,['071','072']],[at071,['071','072']]] as const)
  assert.throws(()=>validateYxxCatalogWithSuccessors(inventory,{successors:[...claimed]}),drift,JSON.stringify(claimed));
 // Only the two lawful orders exist; 072 never stands without 071.
 for(const claimed of [['072'],['072','071'],['071','071'],['070']])assert.throws(()=>validateYxxCatalogWithSuccessors(at072,{successors:claimed}),drift,JSON.stringify(claimed));
});

test('SS-010 catalog: any drift outside the recorded successor constraints is still rejected',()=>{
 const at072=withConstraints(successors['072']);
 const changed=(mutate:(catalog:Catalog)=>void)=>{const copy=structuredClone(at072);mutate(copy);return copy;};
 const cases:Array<[string,Catalog]>=[
  ['other constraint',changed(c=>{const other=c.constraints.find(x=>x.name!=='service_intake_status_check'&&x.name!=='service_intake_event_type_check');assert.ok(other);other.definition+=' ';})],
  ['successor constraint edited',changed(c=>{const status=c.constraints.find(x=>x.name==='service_intake_status_check');assert.ok(status);status.definition=status.definition.replace("'FAILED'::text","'FAILED'::text, 'EXTRA'::text");})],
  ['constraint validity',changed(c=>{const status=c.constraints.find(x=>x.name==='service_intake_status_check');assert.ok(status);status.validated=false;})],
  ['extra constraint',changed(c=>{c.constraints.push({...c.constraints[0] as Constraint,name:'zz_extra_check'});})],
  ['index',changed(c=>{c.indexes.pop();})],['column',changed(c=>{c.columns.pop();})],['relation',changed(c=>{c.relations.pop();})],
  ['timezone columns',changed(c=>{c.forbidden_timezone_columns=1;})],
 ];
 for(const [name,inventory] of cases)assert.throws(()=>validateYxxCatalogWithSuccessors(inventory,{successors:['071','072']}),drift,name);
 assert.throws(()=>validateYxxCatalogWithSuccessors(null,{successors:[]}),drift);
});
