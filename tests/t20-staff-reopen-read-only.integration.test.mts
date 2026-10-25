import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {t20Object} from './helpers/t20-feedback-fixture.mjs';
import {browser} from './helpers/yxx-ss-009-http-fixture.mjs';

function errorFacts(value:unknown,depth=0):unknown{
 if(!(value instanceof Error))return value===null?null:String(value).slice(0,2048);
 return {name:value.name,message:value.message.slice(0,2048),...('code' in value&&typeof value.code==='string'?{code:value.code}:{}),...(depth<3&&value.cause!==undefined?{cause:errorFacts(value.cause,depth+1)}:{}),...(value instanceof AggregateError&&depth<3?{errors:Array.from(value.errors).slice(0,8).map(error=>errorFacts(error,depth+1))}:{})};
}

test('original HANDLER STAFF_REOPEN ACK remains read-only with new write/raw capabilities off and still denies lost Ticket READ',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();const options={pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,workbenchDraftRecoveryEnabled:false};
  const writer=createP2016Runtime({...options,ticketReopenRoundsEnabled:true});if('disabled' in writer)throw Error('T20_ACK_WRITER_DISABLED');
  let reader:ReturnType<typeof createP2016Runtime>|undefined,stage='writer-start',failure:unknown;
  const directory=join(tmpdir(),'t20-staff-ack-read-only-'+randomUUID());await mkdir(directory);const requests:{stage:string;path:string;status:unknown}[]=[];
  const read=async(client:ReturnType<typeof browser>,path:string,label:string)=>{stage=label;const response=await client.request(path);requests.push({stage:label,path,status:response.status});return response;};
  try{
   const started=await writer.start();assert.ok(started.cookies);const current={...context,runtime:writer,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)};
   stage='writer-handler-bootstrap';const handler=await t11Http(current,2);stage='writer-ticket-seed';const ticketId=await t11NewTicket(current);stage='writer-take-and-start';const active=await handler.start(ticketId);stage='writer-complete';const completion=await handler.post(ticketId,'complete',handler.command(active));requests.push({stage,path:'/api/tickets/'+ticketId+'/complete',status:completion.status});assert.equal(completion.status,200);
   stage='writer-closed-detail';const completed=await handler.detail(ticketId),id=randomUUID(),path='/api/tickets/'+ticketId+'/reopen/commands/'+id;
   stage='writer-reopen-post';const posted=await handler.post(ticketId,'reopen',{client_command_id:id,expected_version:completed.version,reason_code:'STAFF_REOPEN',note:'本人确认需要重新承接'});requests.push({stage,path:'/api/tickets/'+ticketId+'/reopen',status:posted.status});assert.equal(posted.status,200);stage='writer-reopen-body';const result=t20Object(await posted.json());stage='writer-reopen-observation';await writeFile(join(directory,'original-post-observation.json'),JSON.stringify({path:'/api/tickets/'+ticketId+'/reopen',status:posted.status,body:result}));stage='writer-stop';await writer.stop();assert.equal(writer.server.listening,false);
   reader=createP2016Runtime({...options,ticketReopenRoundsEnabled:false});if('disabled' in reader)throw Error('T20_ACK_READER_DISABLED');
   stage='reader-start';const readStarted=await reader.start();assert.ok(readStarted.cookies);stage='reader-listener';assert.equal(reader.server.listening,true);const address=reader.server.address();assert.ok(address&&typeof address==='object');assert.equal(address.port,Number(new URL(context.origin).port));
   // Fresh native HTTP clients do not reuse the stopped writer's global-fetch keepalive connection.
   const currentHandler=browser(reader.server),administrator=browser(reader.server),handlerCookie=readStarted.cookies[2],adminCookie=readStarted.cookies[0];assert.ok(handlerCookie);assert.ok(adminCookie);currentHandler.cookies.set(handlerCookie.name,handlerCookie.value);administrator.cookies.set(adminCookie.name,adminCookie.value);
   const bootstrapResponse=await read(currentHandler,'/api/lifecycle/bootstrap','reader-handler-bootstrap');assert.equal(bootstrapResponse.status,200);const bootstrap=t20Object(bootstrapResponse.json());assert.deepEqual(bootstrap.roles,['HANDLER']);assert.equal(bootstrap.ticket_reopen_rounds_enabled,false);assert.equal(bootstrap.draft_recovery_enabled,false);
   const receipt=await read(currentHandler,path,'reader-original-reopen-ack');assert.equal(receipt.status,200);assert.deepEqual(receipt.json(),{client_command_id:id,ticket_id:ticketId,state:'COMMITTED',result:{...result,replayed:true}});
   const beforeResponse=await read(administrator,'/api/tickets/'+ticketId,'reader-admin-before');assert.equal(beforeResponse.status,200);const before=t20Object(beforeResponse.json());assert.equal(before.version,completed.version+1);assert.equal(before.assignee_id,null);
   stage='reader-admin-start-capability';assert.ok(Array.isArray(before.allowed_actions));assert.equal(before.allowed_actions.includes('start'),false,'a genuine unassigned reopened round must not advertise START when new write/raw capabilities are off');
   assert.equal((await read(currentHandler,path+'?purpose=internal-notes','reader-purpose-fence')).status,400);
   stage='remove-handler-ticket-read';
   const principal=context.principals[1];assert.ok(principal);await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[principal.id,before.resolver_team_id]);
   const denied=await read(currentHandler,path,'reader-lost-ticket-read-ack');assert.equal(denied.status,404);assert.deepEqual(denied.json(),{error:{code:'P2_016_NOT_FOUND',retryable:false}});
   const afterResponse=await read(administrator,'/api/tickets/'+ticketId,'reader-admin-after');assert.equal(afterResponse.status,200);const after=t20Object(afterResponse.json());assert.equal(after.version,before.version);assert.equal(after.assignee_id,null);assert.equal(after.handling_cycle===null||after.handling_cycle===undefined?undefined:t20Object(after.handling_cycle).id,before.handling_cycle===null||before.handling_cycle===undefined?undefined:t20Object(before.handling_cycle).id);assert.equal(after.resolver_team_id,before.resolver_team_id);stage='business-assertions-complete';
  }catch(error){failure=error;await writeFile(join(directory,'primary-error.json'),JSON.stringify({stage,error:errorFacts(error),requests}));console.error('T20_STAFF_ACK_READ_ONLY_FAILURE_POINTER '+directory);throw error;}
  finally{try{if(reader&&!('disabled' in reader)){await reader.stop();assert.equal(reader.server.listening,false);}await writer.stop();assert.equal(writer.server.listening,false);await writeFile(join(directory,'terminal-observation.json'),JSON.stringify({stage,requests,primary:failure===undefined?null:errorFacts(failure),writer_listening:writer.server.listening,reader_listening:reader&&!('disabled' in reader)?reader.server.listening:null}));}
   catch(error){await writeFile(join(directory,'cleanup-error.json'),JSON.stringify({stage,primary:failure===undefined?null:errorFacts(failure),cleanup:errorFacts(error),requests}));throw failure===undefined?error:new AggregateError([failure,error],'T20_READ_ONLY_ACK_AND_CLEANUP_FAILED');}}
 });
});
