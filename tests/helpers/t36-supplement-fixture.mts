import {request as requestHttp} from 'node:http';
// The fixture deliberately restarts its App on the same port. Each test-owned
// request uses its own connection instead of retaining the stopped App's socket.
function ownedHttp(url:string,options:{method?:string;headers:Record<string,string>;body?:string}):Promise<Response>{
  return new Promise((resolve,reject)=>{
    const request=requestHttp(url,{method:options.method??'GET',headers:options.headers,agent:false},response=>{
      const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.once('error',reject);
      response.once('end',()=>resolve(new Response(Buffer.concat(chunks).toString('utf8'),{status:response.statusCode??500})));
    });
    request.once('error',reject);request.end(options.body);
  });
}


import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {withT35Fixture} from './t35-read-fixture.mjs';
import type {T35Fixture} from './t35-read-fixture.mjs';
import {closeBrowserTestResources,launchSystemBrowser} from './p2-006-browser-harness.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createYxxSelfServiceAuthorization} from '../../src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceStore} from '../../src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../../src/yxx-self-service-orchestrator.mjs';
import type {SupplementFollowUpCommand,SupplementFollowUpPage,SupplementFollowUpTarget} from '../../contracts/workbench_supplement_follow_up_contracts.js';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../../scripts/workbench-supplement-follow-up-migrate.mjs';
import type {PersonalReadPage} from '../../contracts/workbench_personal_read_contracts.js';
type Reader='admin'|'staff'|'outsider';
type BrowserCookie=NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>[number];
interface MaterialDetail {records:{audience:string;text:string;read_material?:SupplementFollowUpTarget}[];responsibility:unknown}
interface Ticket {id:string;ticket_no:string;status:string;version:number;resolver_team_id:string;assignee_id:string|null;updated_at:string}
export interface T36WebFixture {
 pool:PostgresPool;databaseUrl:string;adminId:string;origin:string;ticketId:string;ticketPath:string;itemPath:string;followPath:string;staffId:string;browserCookie:BrowserCookie;
 get(path:string,reader?:Reader):Promise<Response>;
 read<T>(path:string,reader?:Reader):Promise<T>;
 post(command:SupplementFollowUpCommand,reader?:Reader):Promise<Response>;
 page(reader?:Reader):Promise<SupplementFollowUpPage>;
 supplement(expectedRevision:string,text:string):Promise<SupplementFollowUpTarget>;
 facts(reader?:Reader):Promise<{ticket:Ticket;responsibility:unknown;events:unknown;personalRead:PersonalReadPage;materialResponsibility:unknown}>;
 setStaffRead(enabled:boolean):Promise<void>;
 deactivateStaff():Promise<void>;
}
export function withT36WebFixture(run:(f:T36WebFixture)=>Promise<void>,
 {prepareSchema}:{prepareSchema?:(f:Pick<T35Fixture,'pool'|'databaseUrl'>)=>Promise<void>}={}){
 return withT35Fixture(async base=>{
  await base.runtime.stop();
  // The owned test schema is prepared after the original public-seam RED.
  await migrateWorkbenchSupplementFollowUp({databaseUrl:base.databaseUrl,mode:'apply'});
  await prepareSchema?.(base);
  const admin=base.principals[0],staff=base.principals[2];assert.ok(admin&&staff);
  const options={pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:base.origin,
   listenPort:Number(new URL(base.origin).port),principalIds:[admin.id,staff.id,base.outsider.id],externalSendEnabled:false,
   workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchConversationsEnabled:true,
   workbenchPersonalReadEnabled:true,workbenchSupplementFollowUpEnabled:true};
  const runtime=createP2016Runtime(options);if('disabled' in runtime)throw Error('T36_REAL_WORKBENCH_REQUIRED');
  let primaryError:unknown;
  try{
   const started=await runtime.start(),cookies=started.cookies;assert.ok(cookies);
   const a=cookies[0],s=cookies[1],o=cookies[2];assert.ok(a&&s&&o);
   const cookieFor=(reader:Reader)=>reader==='admin'?a:reader==='staff'?s:o;
   const get=(path:string,reader:Reader='staff')=>{const c=cookieFor(reader);return ownedHttp(base.origin+path,{headers:{cookie:c.name+'='+c.value}});};
   const read=async<T,>(path:string,reader:Reader='staff'):Promise<T>=>{const response=await get(path,reader);assert.equal(response.status,200,path);return await response.json() as T;};
   const csrf:Record<Reader,string>={admin:(await read<{csrf_token:string}>('/api/lifecycle/bootstrap','admin')).csrf_token,
    staff:(await read<{csrf_token:string}>('/api/lifecycle/bootstrap')).csrf_token,
    outsider:(await read<{csrf_token:string}>('/api/lifecycle/bootstrap','outsider')).csrf_token};
   const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
   const member={profile:'MEMBER_SELF_SERVICE',write_flag:true,flags,csrf_token:'t36-synthetic-member-csrf',
    canonical_reporter_binding:createHash('sha256').update(randomUUID()).digest('hex'),source_corp_scope:'t36-synthetic-corp',
    source_app_scope:'t36-synthetic-app',proof_ref:'tests/t36-synthetic-web'};
   const authorization=createYxxSelfServiceAuthorization<null>({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async()=>member,
    recheck:Object.assign(async()=>member,{localOnly:true as const})});
   const store=createYxxSelfServiceStore({pool:base.pool,scopeSecret:'t36-synthetic-web-source-secret'});
   const orchestrator=createYxxSelfServiceOrchestrator({pool:base.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags});
   const initial=await authorization.read({request:null,operation:'WEB_COMMAND',source:'WEB',run:context=>store.accept({scope:context.scope,
    input:{schema_version:1,client_command_id:randomUUID(),description:'处方提交不了',location:{text:'本部8层',unknown:false},
     service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null}})});
   assert.equal(initial.receipt.accepted_revision,'1');
   const created=await orchestrator.processOne({requestRef:initial.receipt.request_ref});assert.equal(created.processed,true);
   assert.ok('ticket_id' in created);assert.ok(created.ticket_id);assert.equal(created.result_code,'TICKET_ELIGIBLE');
   const ticketId=created.ticket_id,ticketPath='/api/tickets/'+ticketId,itemPath='/api/workbench/items/ticket/'+ticketId;
   const followPath=ticketPath+'/supplement-follow-up';
   const initialTicket=await read<Ticket>(ticketPath,'admin');assert.ok(initialTicket.resolver_team_id);
   const access=createPilotAccessService({pool:base.pool});
   const setStaffRead=async(enabled:boolean)=>{
    const current=await access.upsertPrincipal({wecomUserId:'web01-synthetic-2',displayName:'T36合成非负责人同事',roles:['HANDLER'],
     resolverTeamIds:enabled?[initialTicket.resolver_team_id]:[]});assert.equal(current.id,staff.id);
   };
   await setStaffRead(true);
   assert.equal((await get(itemPath)).status,200,'active actual HANDLER has current material READ without owning this Ticket');
   const supplement=async(expectedRevision:string,text:string):Promise<SupplementFollowUpTarget>=>{
    const accepted=await authorization.read({request:null,operation:'WEB_COMMAND',source:'WEB',run:context=>store.accept({scope:context.scope,
     kind:'SUPPLEMENT',requestRef:initial.receipt.request_ref,input:{schema_version:1,client_command_id:randomUUID(),expected_input_revision:expectedRevision,text}})});
    const processed=await orchestrator.processOne({requestRef:initial.receipt.request_ref});assert.equal(processed.processed,true);
    assert.ok('ticket_id' in processed);assert.equal(processed.ticket_id,ticketId);
    const detail=await read<MaterialDetail>(itemPath,'admin'),target=detail.records.find(record=>record.audience==='REPORT'&&record.text===text)?.read_material;
    assert.ok(target);assert.equal(target.revision,accepted.receipt.accepted_revision);assert.match(target.source_ref,/^web:[a-f0-9-]{36}$/u);return target;
   };
   const post=(command:SupplementFollowUpCommand,reader:Reader='staff')=>{const c=cookieFor(reader);return ownedHttp(base.origin+followPath,
    {method:'POST',headers:{cookie:c.name+'='+c.value,origin:base.origin,'content-type':'application/json',
     'idempotency-key':command.client_command_id,'x-csrf-token':csrf[reader]},body:JSON.stringify(command)});};
   const facts=async(reader:Reader='admin')=>({ticket:await read<Ticket>(ticketPath,reader),responsibility:await read<unknown>(ticketPath+'/responsibility',reader),
    events:await read<unknown>(ticketPath+'/events',reader),personalRead:await read<PersonalReadPage>(itemPath+'/read-position',reader),
    materialResponsibility:(await read<MaterialDetail>(itemPath,reader)).responsibility});
   const browserCookie:BrowserCookie={name:s.name,value:s.value,url:base.origin+'/',httpOnly:true,secure:base.origin.startsWith('https:'),sameSite:'Strict'};
   await run({pool:base.pool,databaseUrl:base.databaseUrl,adminId:admin.id,origin:base.origin,ticketId,ticketPath,itemPath,followPath,staffId:staff.id,browserCookie,get,read,post,
    page:(reader:Reader='staff')=>read<SupplementFollowUpPage>(followPath,reader),supplement,facts,setStaffRead,
    deactivateStaff:async()=>{
     // Existing synthetic authentication boundary only: no business source, Ticket or follow-up seed.
     const changed=await base.pool.query<{id:string}>(`UPDATE pilot_ticket.pilot_principal SET is_active=FALSE
       WHERE id=$1::uuid AND wecom_user_id=$2 RETURNING id::text`,[staff.id,'web01-synthetic-2']);
     assert.equal(changed.rowCount,1);assert.equal(changed.rows[0]?.id,staff.id);
    }});
  }catch(error){primaryError=error;}
  finally{await closeBrowserTestResources([async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],primaryError);}
 });
}
