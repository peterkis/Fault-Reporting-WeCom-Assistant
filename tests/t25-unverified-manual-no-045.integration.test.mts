import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {migrateTicketStaffCompletion} from '../scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../scripts/ticket-round-notifications-migrate.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';

test('a genuine hand-entered T17 report without045 stays manual-contact-only and does not block an eligible H5 notification',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture)=>{
  await f.runtime.stop();await migrateTicketStaffCompletion({databaseUrl:f.databaseUrl,mode:'apply'});await migrateTicketRoundNotifications({databaseUrl:f.databaseUrl,mode:'apply'});
  assert.equal((await f.pool.query<{absent:boolean}>("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='intake' AND table_name='service_intake' AND column_name='manual_reporter_verification') AS absent")).rows[0]?.absent,true);
  const runtime=createP2016Runtime({pool:f.pool,publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},externalSendEnabled:false,
   ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketRoundNotificationsEnabled:true,workbenchManualReportsEnabled:true,reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:entryConfig,wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>{throw Error('NO_REAL_OAUTH');}}});
  try{
   await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(f.origin).port)});const cookies=runtime.authenticate.browserCookies?.();assert.ok(cookies);const context={...f,runtime,cookies:cookies.map(cookie=>cookie.name+'='+cookie.value),browserCookies:cookies};const http=await t11Http(context,0,{closeConnections:true}),cookie=context.cookies[0];assert.ok(cookie);
   const bootstrap=t25Object(await (await http.get('/api/lifecycle/bootstrap')).json()),csrf=bootstrap.csrf_token;assert.ok(typeof csrf==='string');
   const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成电话报修：打印机无法打印，设备故障，请协助处理。',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'内线1234',department:'合成科室'}};
   const admitted=await fetch(f.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,connection:'close',origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)}),report=t25Object(await admitted.json());assert.equal(admitted.status,202,JSON.stringify(report));assert.equal(report.manual_contact_required,true);assert.equal(report.external_notification,false);assert.equal(report.reporter_verification,'UNVERIFIED');const ticketId=t25Object(report.ticket).id;assert.ok(typeof ticketId==='string');const started=await http.start(ticketId);
   const retained=await t25WebOrigin(context,{memberId:'T25_UNVERIFIED_NEIGHBOUR_H5_MEMBER'});await retained.round.runOnce();assert.deepEqual(await t25Deliveries(http,ticketId),[]);const other=await t25Deliveries(retained.http,retained.ticketId);assert.deepEqual(other.map(row=>({type:row.destination_type,route:row.route_kind,node:row.node,status:row.status})),[{type:'PERSON',route:'YIXIAOXIU_APP',node:'FIRST_RESPONSIBILITY',status:'PENDING'}]);
   await retained.round.runOnce();assert.deepEqual(await t25Deliveries(http,ticketId),[]);assert.deepEqual(await t25Deliveries(retained.http,retained.ticketId),other);assert.deepEqual(await http.detail(ticketId),started);assert.deepEqual(await retained.http.detail(retained.ticketId),retained.started);
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true});
});
