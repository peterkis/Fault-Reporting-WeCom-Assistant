import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeCommand,hash} from '../src/p2-012-domain-contracts.mjs';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
test('T31 public command preserves the manually confirmed original summary and rejects unsafe or privileged inputs',()=>{
  const body={action:'PUBLISH_PUBLIC_PROGRESS',incident_id:randomUUID(),client_command_id:randomUUID(),expected_row_version:'9223372036854775807',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'😀'.repeat(1000),preview_confirmed:true};
  assert.deepEqual(normalizeCommand(body),body);assert.equal(hash(body),hash(Object.fromEntries(Object.entries(body).reverse())));assert.notEqual(hash(body),hash({...body,summary:'另一原意图'}));
  for(const changes of [{summary:'😀'.repeat(1001)},{summary:'x\ud800'},{summary:' \t\n'},{summary:'x\u007f'},{preview_confirmed:false},{audience:'GROUP'},{target_id:'synthetic'},{actor_principal_id:randomUUID()},{reason_code:'OPERATOR_REVIEWED'},{expected_row_version:'9223372036854775808'}])assert.throws(()=>normalizeCommand({...body,...changes}),{code:'P2_012_INPUT_INVALID'});
});
test('T31 the new purpose cannot inherit the old lifecycle live approval',async()=>{
  // Pool construction performs no query or connection; even the disabled base
  // must reject reusing an old approval before any live resource is created.
  const pool=createPostgresPool({max:1});
  try{for(const live of [{senderEnabled:true},{gatewayEnabled:true}])assert.throws(()=>createP2012Runtime({pool,publicOrigin:'http://127.0.0.1:1',incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentCandidateWorkspaceEnabled:true,incidentPublicProgressEnabled:true,incidentLiveApproval:{live:true,scope:true,send:true,publicNotice:true,privateNotice:true},...live}),{code:'P2_012_LIVE_APPROVAL_REQUIRED'});assert.equal(pool.totalCount,0);}finally{await pool.end();}
});
test('T31 frozen publication and Delivery schemas match real local business timestamps and reject escaped or fractional representations',async()=>{
  const publication:unknown=JSON.parse(await readFile(new URL('../contracts/workbench_incident_public_progress_page.schema.json',import.meta.url),'utf8')),delivery:unknown=JSON.parse(await readFile(new URL('../contracts/workbench_incident_public_progress_delivery_page.schema.json',import.meta.url),'utf8'));
  function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
  const properties=(v:unknown)=>object(object(object(object(object(v).properties).items).items).properties);
  const first=object(properties(publication).occurred_at),sent=object(properties(delivery).sent_at);assert.ok(Array.isArray(sent.anyOf));
  for(const pattern of [first.pattern,object(sent.anyOf[0]).pattern]){assert.equal(typeof pattern,'string');assert.ok(typeof pattern==='string');const re=new RegExp(pattern,'u');assert.equal(re.test('2026-10-13 18:00:01'),true);for(const bad of ['\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}','2026-10-13T18:00:01','2026-10-13 18:00:01.123'])assert.equal(re.test(bad),false);}
});
