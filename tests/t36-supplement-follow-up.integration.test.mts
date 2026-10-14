import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createYxxSelfServiceAuthorization} from '../src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import type {SupplementFollowUpCommand,SupplementFollowUpPage,SupplementFollowUpResult} from '../contracts/workbench_supplement_follow_up_contracts.js';
import type {PersonalReadPage} from '../contracts/workbench_personal_read_contracts.js';

interface MaterialDetail {records:{audience:string;text:string;read_material?:{source_ref:string;revision:string}}[];responsibility:unknown}
interface TicketFacts {id:string;ticket_no:string;status:string;version:number;resolver_team_id:string;assignee_id:string|null;updated_at:string}
interface Responsibility {ticket_assignee_id:string|null;conversations:unknown[]}

// SOURCE tracer: all runtime NOT_RUN. The first planned T36 GET is the missing public seam.
test('T36 ADMIN explicitly disposes WEB revision 2 while revision 3 stays pending and old UUID replay preserves independent facts',{timeout:240_000},()=>withT35Fixture(async f=>{
  await f.runtime.stop(); // Reuse the real isolated fixture with one App on its original port.
  const admin=f.principals[0];assert.ok(admin);
  const runtimeOptions={pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,
    listenPort:Number(new URL(f.origin).port),principalIds:[admin.id],externalSendEnabled:false,
    workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchConversationsEnabled:true,
    workbenchPersonalReadEnabled:true,workbenchSupplementFollowUpEnabled:true};
  // This opt-in is a planned composition input; current production ignores it until the RED-led implementation.
  const runtime=createP2016Runtime(runtimeOptions);
  if('disabled' in runtime)throw Error('T36_REAL_WORKBENCH_REQUIRED');
  try{
    const started=await runtime.start(),cookie=started.cookies?.[0];assert.ok(cookie);
    const cookieHeader=cookie.name+'='+cookie.value;
    const get=async(path:string)=>{try{return await fetch(f.origin+path,{headers:{cookie:cookieHeader}});}catch(error){const cause=error instanceof Error?error.cause:null;console.log('T36_FIRST_TRANSPORT '+JSON.stringify({method:'GET',path,origin:f.origin,address:runtime.server.address(),cause_code:typeof cause==='object'&&cause!==null&&'code' in cause?cause.code:null}));throw error;}};
    const read=async<T,>(path:string):Promise<T>=>{const response=await get(path);assert.equal(response.status,200,path);return await response.json() as T;};
    const csrf=(await read<{csrf_token:string}>('/api/lifecycle/bootstrap')).csrf_token;assert.ok(csrf);
    const post=(path:string,body:SupplementFollowUpCommand)=>fetch(f.origin+path,{method:'POST',headers:{cookie:cookieHeader,
      origin:f.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(body)});

    const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    // Only the trusted member identity boundary is synthetic. Store, Orchestrator, Core and HTTP are real.
    const memberAuth={profile:'MEMBER_SELF_SERVICE',write_flag:true,flags,csrf_token:'t36-synthetic-member-csrf',
      canonical_reporter_binding:createHash('sha256').update(randomUUID()).digest('hex'),
      source_corp_scope:'t36-synthetic-corp',source_app_scope:'t36-synthetic-app',proof_ref:'tests/t36-synthetic-web'};
    const authorization=createYxxSelfServiceAuthorization<null>({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async()=>memberAuth,
      recheck:Object.assign(async()=>memberAuth,{localOnly:true as const})});
    const store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:'t36-synthetic-web-source-secret'});
    const orchestrator=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags});
    const initial=await authorization.read({request:null,operation:'WEB_COMMAND',source:'WEB',run:context=>store.accept({scope:context.scope,
      input:{schema_version:1,client_command_id:randomUUID(),description:'处方提交不了',location:{text:'本部8层',unknown:false},
        service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null}})});
    assert.equal(initial.receipt.accepted_revision,'1');
    const created=await orchestrator.processOne({requestRef:initial.receipt.request_ref});
    assert.equal(created.processed,true);assert.ok('ticket_id' in created);assert.ok(created.ticket_id);assert.equal(created.result_code,'TICKET_ELIGIBLE');
    const ticketId=created.ticket_id,itemPath='/api/workbench/items/ticket/'+ticketId,ticketPath='/api/tickets/'+ticketId;
    const followPath=ticketPath+'/supplement-follow-up',positionPath=itemPath+'/read-position';
    const supplement=async(expectedRevision:string,text:string)=>{
      const accepted=await authorization.read({request:null,operation:'WEB_COMMAND',source:'WEB',run:context=>store.accept({scope:context.scope,
        kind:'SUPPLEMENT',requestRef:initial.receipt.request_ref,input:{schema_version:1,client_command_id:randomUUID(),expected_input_revision:expectedRevision,text}})});
      const processed=await orchestrator.processOne({requestRef:initial.receipt.request_ref});assert.equal(processed.processed,true);
      assert.ok('ticket_id' in processed);assert.equal(processed.ticket_id,ticketId);return accepted.receipt.accepted_revision;
    };
    const exactMaterial=async(text:string,revision:string)=>{
      const detail=await read<MaterialDetail>(itemPath),material=detail.records.find(record=>record.audience==='REPORT'&&record.text===text)?.read_material;
      assert.ok(material);assert.match(material.source_ref,/^web:[a-f0-9-]{36}$/u);assert.equal(material.revision,revision);return material;
    };
    const independentFacts=async()=>{
      const ticket=await read<TicketFacts>(ticketPath),responsibility=await read<Responsibility>(ticketPath+'/responsibility');
      return {ticket:{id:ticket.id,ticket_no:ticket.ticket_no,status:ticket.status,version:ticket.version,resolver_team_id:ticket.resolver_team_id,
        assignee_id:ticket.assignee_id,updated_at:ticket.updated_at},responsibility,events:await read<unknown>(ticketPath+'/events'),
        personalRead:await read<PersonalReadPage>(positionPath),materialResponsibility:(await read<MaterialDetail>(itemPath)).responsibility};
    };

    const r2Text='同一台工作站再次出现提交失败';assert.equal(await supplement('1',r2Text),'2');
    const r2=await exactMaterial(r2Text,'2'),before2=await independentFacts();
    assert.equal(before2.responsibility.ticket_assignee_id,null);assert.deepEqual(before2.responsibility.conversations,[]);
    assert.equal(before2.personalRead.sources.find(source=>source.source_kind==='WEB')?.last_read_position,'0');
    const pending2=await read<SupplementFollowUpPage>(followPath); // Planned first RED: real current route is absent; never run in SOURCE.
    assert.equal(pending2.ticket_id,ticketId);assert.equal(pending2.has_pending_supplements,true);
    assert.deepEqual(pending2.items.map(item=>[item.source_ref,item.revision,item.follow_up_state,item.resolution]),[[r2.source_ref,'2','PENDING',null]]);
    const command:SupplementFollowUpCommand={client_command_id:randomUUID(),action:'RECORD_DISPOSITION',...r2,
      disposition_note:'已确认补充现象，处理记录仅供内部使用',mark_followed_up:true};
    const response=await post(followPath,command);assert.equal(response.status,200);
    const result=await response.json() as SupplementFollowUpResult;
    assert.equal(result.ok,true);assert.equal(result.client_command_id,command.client_command_id);assert.equal(result.ticket_id,ticketId);
    assert.equal(result.source_ref,r2.source_ref);assert.equal(result.revision,'2');assert.equal(result.follow_up_state,'FOLLOWED_UP');
    assert.equal(result.basis,'RECORDED_DISPOSITION');assert.equal(result.replayed,false);assert.match(result.resolution_id,/^[a-f0-9-]{36}$/u);
    const handled2=await read<SupplementFollowUpPage>(followPath);assert.equal(handled2.has_pending_supplements,false);
    assert.equal(handled2.items.length,1);assert.equal(handled2.items[0]?.follow_up_state,'FOLLOWED_UP');
    assert.equal(handled2.items[0]?.resolution?.resolution_id,result.resolution_id);
    assert.deepEqual(await independentFacts(),before2);

    const r3Text='刚收到新的错误提示，需继续核对';assert.equal(await supplement('2',r3Text),'3');
    const r3=await exactMaterial(r3Text,'3');assert.notEqual(r3.source_ref,r2.source_ref);
    const beforeReplay=await independentFacts(),pending3=await read<SupplementFollowUpPage>(followPath);
    assert.equal(pending3.has_pending_supplements,true);
    assert.deepEqual(pending3.items.map(item=>[item.source_ref,item.revision,item.follow_up_state]),[[r2.source_ref,'2','FOLLOWED_UP'],[r3.source_ref,'3','PENDING']]);
    assert.equal(pending3.items[1]?.resolution,null);
    const replay=await post(followPath,command);assert.equal(replay.status,200);
    assert.deepEqual(await replay.json(),{...result,replayed:true});
    assert.deepEqual(await read<SupplementFollowUpPage>(followPath),pending3);
    assert.deepEqual(await independentFacts(),beforeReplay);
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
}));
