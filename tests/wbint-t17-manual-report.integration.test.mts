import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createP2016Runtime,type P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchSourceGroups} from '../app/server/scripts/workbench-source-groups-migrate.mjs';
interface Fixture {origin:string;cookies:string[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}

test('authorized staff admits a telephone fault with unknown location and an unverified real reporter while directory is unavailable',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool}:Fixture&{pool:PostgresPool})=>{
    const bootstrapResponse=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]}});
    assert.equal(bootstrapResponse.status,200);const bootstrap=object(await bootstrapResponse.json());
    assert.equal(typeof bootstrap.csrf_token,'string');assert.ok(bootstrap.csrf_token);const csrf=bootstrap.csrf_token as string;
    const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成电话报修：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'内线1234',department:'合成科室'}};
    const response=await fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
    assert.equal(response.status,202);const result=object(await response.json());
    assert.equal(result.manual_contact_required,true);assert.equal(result.external_notification,false);
    assert.equal(result.reporter_verification,'UNVERIFIED');assert.equal(result.source,'PHONE');assert.equal(object(result.ticket).status,'QUEUED');
    const registered=(await pool.query<{at:string}>("SELECT to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM intake.service_intake WHERE id=$1::uuid",[result.intake_id])).rows[0]?.at;assert.ok(registered);
    const detail=await fetch(origin+'/api/workbench/items/ticket/'+String(object(result.ticket).id),{headers:{cookie:cookies[0]}});assert.equal(detail.status,200);assert.equal(object(await detail.json()).reported_at,registered);
  },{workbenchManualReportsEnabled:true});
});

for(const followEnabled of [false,true])test(`manual and supplement card projections keep SQL fixed for 1, 10 and 50 real admissions; Follow=${followEnabled}`,async t=>{
  await withWeb01Fixture(async(f:Fixture&{pool:PostgresPool;runtime:P2016EnabledRuntime;databaseUrl:string;principals:{id:string}[]})=>{
    const {origin,pool}=f;await f.runtime.stop();
    await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'apply'});
    await migrateWorkbenchSourceGroups({databaseUrl:f.databaseUrl,mode:'apply'});
    const principal=f.principals[0];assert.ok(principal);
    // The original fixture's Follow preparation already applies the Manual
    // predecessors. Compose the combined host without reapplying legacy 022.
    const runtime=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:Number(new URL(origin).port),principalIds:[principal.id],
      externalSendEnabled:false,workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchFollowEnabled:followEnabled,workbenchSupplementFollowUpEnabled:true,sourceGroupDirectoryEnabled:true});
    try{
    await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(origin).port)});
    const session=runtime.authenticate.browserCookies?.()?.[0];assert.ok(session);const cookie=session.name+'='+session.value;
    const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}}),csrf=object(await bootstrap.json()).csrf_token;
    assert.equal(typeof csrf,'string');if(typeof csrf!=='string')throw Error('CSRF_REQUIRED');
    for(let index=0;index<50;index++){
      const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成电话报修：打印机无法打印 '+index,
        location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人'+index,contact:'内线1234',department:'合成科室'}};
      const response=await fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
      assert.equal(response.status,202,await response.text());
    }
    const original=pool.query,samples:{limit:number;queries:number;manual_queries:number;http_ms:number}[]=[];
    let count=0,manualCount=0,revokeAfterManual=false;
    pool.query=new Proxy(original,{apply(target,thisArg,args:unknown[]){
      count++;if(typeof args[0]==='string'&&args[0].includes('manual_report_snapshot AS snapshot'))manualCount++;
      const result:unknown=Reflect.apply(target,thisArg,args);
      if(revokeAfterManual&&typeof args[0]==='string'&&args[0].includes('manual_report_snapshot AS snapshot')){
        revokeAfterManual=false;return Promise.resolve(result).then(async value=>{
          await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principal.id]);return value;
        });
      }return result;
    }});
    try{
      for(const limit of [1,10,50]){
        count=0;manualCount=0;const start=performance.now();
        const response=await fetch(origin+'/api/workbench/board?column=pending&range=all&limit='+limit+(followEnabled?'&scope=team':''),{headers:{cookie}}),value=object(await response.json());
        assert.equal(response.status,200,JSON.stringify(value));assert.ok(Array.isArray(value.items));assert.equal(value.items.length,limit);
        for(const raw of value.items){const item=object(raw);assert.equal(item.source,'MANUAL');assert.equal(item.source_label,'电话代录');assert.equal(item.reporter_department,'合成科室');assert.match(String(item.reporter_name),/（身份未核实）$/u);assert.equal(object(item.supplement_follow_up).has_pending_supplements,false);if(followEnabled)assert.match(String(object(item.attention).follow_version),/^[a-f0-9]{64}$/u);else assert.equal(Object.hasOwn(item,'attention'),false);}
        samples.push({limit,queries:count,manual_queries:manualCount,http_ms:performance.now()-start});
      }
      t.diagnostic('MANUAL_BOARD_BATCH_QUERY_COUNTS '+JSON.stringify(samples));
      assert.ok(samples.every(sample=>sample.manual_queries===1&&sample.queries<=50));
      assert.ok(Math.max(...samples.map(s=>s.queries))-Math.min(...samples.map(s=>s.queries))<=2);
      revokeAfterManual=true;
      const denied=await fetch(origin+'/api/workbench/board?column=pending&range=all&limit=50'+(followEnabled?'&scope=team':''),{headers:{cookie}});
      assert.equal(revokeAfterManual,false);assert.equal(denied.status,403,'the final page check follows the manual projection wait');
      assert.equal(Object.hasOwn(object(await denied.json()),'items'),false);
    }finally{pool.query=original;}
    }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  },{workbenchFollowEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});
