// SOURCE_NOT_RUN. Copy into tests/ only in the next explicitly granted source batch.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {hashP2016} from '../src/p2-016-domain-contracts.mjs';
import {WorkbenchError} from '../src/p2-006-workbench-query.mjs';
import {formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PilotPrincipal} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool,PostgresPoolClient,PostgresQuery} from '../src/platform/postgres-pool.mjs';
import type {ManualReporterDirectoryOptions,VerifiedManualReportCommand,WorkbenchReporterCandidate} from '../contracts/workbench_reporter_candidates_contracts.js';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {applyT18ForwardCheck} from './helpers/t18-verified-fixture.mjs';
interface Fixture {origin:string;backendOrigin?:string;sessionId?:string;cookies:string[];principals:PilotPrincipal[];pool:PostgresPool}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
type Reachability=WorkbenchReporterCandidate['message_reachability'];
type ReadMode='ALLOW'|'DENY'|'WRONG_TARGET';
function directoryAuthority(){
  const application={sourceCorpScope:'t18-isolated-corp',sourceAppScope:'t18-isolated-app'},directoryScope='T18_ISOLATED_DIRECTORY';
  const mappingHash='c'.repeat(64),mappingProof='T18_SYNTHETIC_MAPPING_PROOF';
  const target={scopeHash:createHmac('sha256','T18_ISOLATED_SCOPE_SECRET').update(JSON.stringify(['member',application.sourceCorpScope,application.sourceAppScope,'T18_SYNTHETIC_MEMBER_A'])).digest('hex'),...application,proofRef:mappingProof};
  let principalId:string|null=null,reachability:Reachability='REACHABLE',readMode:ReadMode='ALLOW';
  const calls:{purpose:'ADMISSION'|'READ_COMMITTED';target:unknown}[]=[];
  const observation=()=>({scope:target,mapping_config_hash:mappingHash,verification_method:'VERIFIED_DELEGATED_MAPPING',profile_source:'THIRD_PARTY_STAFF_DIRECTORY',
    directory_source_scope:directoryScope,directory_snapshot_version:'T18_SYNTHETIC_V1',profile_at_report:{display_name:'合成核实成员',departments:['合成科室']},
    binding_proof_ref:'T18_SYNTHETIC_BINDING_PROOF',account_status:'ACTIVE',binding_state:'VERIFIED',proof_kind:'SYNTHETIC',reachability:{status:reachability,target_scope_hash:target.scopeHash}});
  const candidate=():WorkbenchReporterCandidate=>{const ref='t18_isolated_verified_candidate_01';return {candidate_ref:ref,candidate_version:hashP2016({candidate_ref:ref,...observation()}),
    display_name:'合成核实成员',departments:['合成科室'],profile_source:'THIRD_PARTY_STAFF_DIRECTORY',binding_verified:true,message_reachability:reachability};};
  const directory:ManualReporterDirectoryOptions={application,directorySourceScope:directoryScope,
    verificationAuthority:{mappingConfigHash:mappingHash,mappingProofRef:mappingProof,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},port:{
      async searchAuthorizedCandidates(){throw new Error('T18_ADMISSION_BOUNDARY_MUST_NOT_SEARCH');},
      async verifyAuthorizedCandidate(input){
        assert.ok(principalId);assert.equal(input.principal_id,principalId);assert.deepEqual(input.application,application);assert.equal(input.directory_source_scope,directoryScope);
        input.signal.throwIfAborted();calls.push({purpose:input.purpose,target:structuredClone(input.committed_target_scope)});
        const epoch=String(Date.now()),local=formatEpochMsToShanghaiLocal(epoch),until=String(BigInt(epoch)+300_000n);
        const base={schema_version:1,selection:input.selection,application,directory_source_scope:directoryScope,actor_principal_id:principalId,object_access:'ALLOWED',
          authorized_at:local,authorized_at_epoch_ms:epoch,valid_until:formatEpochMsToShanghaiLocal(until),valid_until_epoch_ms:until};
        if(input.purpose==='READ_COMMITTED'){
          assert.deepEqual(input.committed_target_scope,target,'replay must authorize the original persisted identity target');
          if(readMode==='DENY')throw new WorkbenchError('P2_016_FORBIDDEN',403);
          return {...base,purpose:'READ_COMMITTED',target_scope:readMode==='WRONG_TARGET'?{...target,scopeHash:'b'.repeat(64)}:target};
        }
        assert.equal(input.committed_target_scope,null);const selected=candidate();assert.deepEqual(input.selection,{verification:'VERIFIED_SELECTION',candidate_ref:selected.candidate_ref,candidate_version:selected.candidate_version});
        const stable=observation();return {...base,purpose:'ADMISSION',proof:{source:'VERIFIED_DIRECTORY_SELECTION',...stable,
          reachability:{...stable.reachability,checked_at:local,checked_at_epoch_ms:epoch,proof_ref:reachability==='REACHABLE'?'T18_SYNTHETIC_REACHABILITY_PROOF':null},
          verified_at:local,verified_at_epoch_ms:epoch,actor_principal_id:principalId}};
      },
    }};
  return {directory,target,calls,candidate,setPrincipal(id:string){principalId=id;},setReachability(value:Reachability){reachability=value;},setReadMode(value:ReadMode){readMode=value;},
    command():VerifiedManualReportCommand{const selected=candidate();return {schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成核实代录：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'VERIFIED_SELECTION',candidate_ref:selected.candidate_ref,candidate_version:selected.candidate_version}};}};
}
async function client(fixture:Fixture){
  const cookie=fixture.cookies[0];assert.ok(cookie);const transport=fixture.backendOrigin??fixture.origin,get=(path:string)=>fetch(transport+path,{headers:{cookie}});
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(object(await bootstrap.json()).csrf_token);
  return {get,csrf,post:(body:VerifiedManualReportCommand)=>fetch(transport+'/api/workbench/reports',{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':body.client_command_id},body:JSON.stringify(body)})};
}
async function facts(pool:PostgresPool){const row=(await pool.query(`SELECT
  (SELECT count(*)::integer FROM intake.service_intake WHERE source_channel='MANUAL') AS intakes,
  (SELECT count(*)::integer FROM intake.contact_journey WHERE entry_mode='STAFF_MANUAL_REPORT') AS journeys,
  (SELECT count(*)::integer FROM intake.channel_leg WHERE leg_type='MANUAL_REPORT') AS legs,
  (SELECT count(*)::integer FROM intake.deterministic_decision WHERE source_kind='MANUAL') AS decisions,
  (SELECT count(*)::integer FROM intake.safe_action_suggestion a JOIN intake.deterministic_decision d ON d.id=a.decision_id WHERE d.source_kind='MANUAL') AS actions,
  (SELECT count(*)::integer FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id WHERE i.source_channel='MANUAL') AS reviews,
  (SELECT count(*)::integer FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_channel='MANUAL') AS tickets,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_event e JOIN pilot_ticket.ticket t ON t.id=e.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.source_channel='MANUAL') AS ticket_events,
  (SELECT count(*)::integer FROM intake.service_intake_event e JOIN intake.service_intake i ON i.id=e.intake_id WHERE i.source_channel='MANUAL') AS intake_events,
  (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_MANUAL_REPORT') AS receipts`)).rows[0];assert.ok(row);return row;}
async function externalFacts(pool:PostgresPool){const row=(await pool.query(`SELECT
  (SELECT count(*)::integer FROM channel.message_inbox) AS messages,(SELECT count(*)::integer FROM conversation.session) AS conversations,
  (SELECT count(*)::integer FROM communication.message) AS communications,(SELECT count(*)::integer FROM communication.outbox) AS outbox,
  (SELECT count(*)::integer FROM communication.delivery) AS deliveries,(SELECT count(*)::integer FROM notification.outbox) AS notifications,
  (SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries`)).rows[0];assert.ok(row);return row;}
const enabled={workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,workbenchDraftRecoveryEnabled:true};

test('candidate search refuses official logout during the Directory wait without exposing the returned candidate page',async()=>{
  const source=directoryAuthority();let hold=false,reached=false,resume=()=>{};const gate=new Promise<void>(resolve=>{resume=resolve;});
  const directory:ManualReporterDirectoryOptions={...source.directory,port:{...source.directory.port,async searchAuthorizedCandidates(input){
    input.signal.throwIfAborted();if(hold){reached=true;await gate;}
    return {schema_version:1,candidates:[source.candidate()],next_cursor:null,manual_fallback_available:true};
  }}};
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);const http=await client(fixture),path='/api/workbench/reporter-candidates?q='+encodeURIComponent('合成')+'&limit=2';
    assert.equal((await http.get(path)).status,200);const graph=await facts(fixture.pool),external=await externalFacts(fixture.pool);let pending:Promise<Response>|undefined;
    try{
      hold=true;pending=http.get(path);for(let attempt=0;!reached&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(reached);
      const logout=await fetch((fixture.backendOrigin??fixture.origin)+'/workbench/logout',{method:'POST',headers:{cookie:text(fixture.cookies[0]),origin:fixture.origin,'x-csrf-token':http.csrf}});assert.equal(logout.status,200);
      assert.equal((await fixture.pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[text(fixture.sessionId)])).rows[0]?.state,'REVOKED');
      resume();const response=await pending;assert.equal(response.status,403);const denied=object(await response.json());assert.equal(object(denied.error).code,'P2_016_FORBIDDEN');assert.equal(Object.hasOwn(denied,'candidates'),false);
      assert.deepEqual(await facts(fixture.pool),graph);assert.deepEqual(await externalFacts(fixture.pool),external);
    }finally{resume();await pending?.catch(()=>{});}
  },{...enabled,manualReporterDirectory:directory,realWorkbenchAuthentication:true});
});

for(const seam of ['DIRECTORY_READ','RETAINED_TARGET'] as const)test(`verified lost-race replay refuses official logout during ${seam} without changing the original committed receipt`,async()=>{
  const source=directoryAuthority(),verify=source.directory.port.verifyAuthorizedCandidate;assert.ok(verify);
  let resumeAdmission=()=>{},resumeRead=()=>{},admissionHeld=false,readHeld=false,readReturned=false;
  const admissionGate=new Promise<void>(resolve=>{resumeAdmission=resolve;}),readGate=new Promise<void>(resolve=>{resumeRead=resolve;});
  const directory:ManualReporterDirectoryOptions={...source.directory,port:{...source.directory.port,async verifyAuthorizedCandidate(input){
    const envelope=await verify(input);
    if(input.purpose==='READ_COMMITTED'){if(seam==='DIRECTORY_READ'){readHeld=true;await readGate;}readReturned=true;}
    return envelope;
  }}};
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);const http=await client(fixture),input=source.command();
    const originals=new Map<PostgresPoolClient,PostgresQuery>();let pending:Promise<Response>|undefined;
    const observe=(client:PostgresPoolClient)=>{
      if(originals.has(client))return;const original=client.query;originals.set(client,original);
      client.query=new Proxy(original,{apply(target,thisArg,args:unknown[]){
        const sql=args[0];if(typeof sql==='string'&&!admissionHeld&&sql.includes('INSERT INTO pilot_ticket.ticket_command_receipt')){admissionHeld=true;return admissionGate.then(()=>Reflect.apply(target,thisArg,args));}
        const result:unknown=Reflect.apply(target,thisArg,args);if(!(result instanceof Promise)||typeof sql!=='string')return result;
        return result.then(async rows=>{if(seam==='RETAINED_TARGET'&&readReturned&&!readHeld&&sql.includes('i.manual_reporter_verification AS proof')){readHeld=true;await readGate;}return rows;});
      }});
    };
    fixture.pool.on('acquire',observe);
    try{
      pending=http.post(input);for(let attempt=0;!admissionHeld&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(admissionHeld);
      const winner=await http.post(input),committed=object(await winner.json());
      assert.equal(winner.status,202,JSON.stringify(committed.error));
      const graph=await facts(fixture.pool),external=await externalFacts(fixture.pool),retained=async()=>(await fixture.pool.query(`SELECT r.state,r.result_snapshot,i.manual_report_snapshot,i.manual_reporter_verification
        FROM pilot_ticket.ticket_command_receipt r JOIN intake.service_intake i ON i.manual_command_receipt_id=r.id WHERE r.client_command_id=$1::uuid`,[input.client_command_id])).rows;
      const original=await retained();assert.equal(original.length,1);assert.equal(original[0]?.state,'COMMITTED');resumeAdmission();
      for(let attempt=0;!readHeld&&attempt<200;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(readHeld,'the losing ADMISSION must reach a new READ_COMMITTED await after the real competing commit');
      const logout=await fetch((fixture.backendOrigin??fixture.origin)+'/workbench/logout',{method:'POST',headers:{cookie:text(fixture.cookies[0]),origin:fixture.origin,'x-csrf-token':http.csrf}});assert.equal(logout.status,200);
      assert.equal((await fixture.pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[text(fixture.sessionId)])).rows[0]?.state,'REVOKED');
      resumeRead();const response=await pending;assert.equal(response.status,403);const denied=object(await response.json());assert.equal(object(denied.error).code,'P2_016_FORBIDDEN');
      for(const key of ['intake_id','result','receipt'])assert.equal(Object.hasOwn(denied,key),false);assert.deepEqual(await facts(fixture.pool),graph);assert.deepEqual(await retained(),original);assert.deepEqual(await externalFacts(fixture.pool),external);
      assert.deepEqual(source.calls.map(call=>call.purpose),['ADMISSION','ADMISSION','READ_COMMITTED']);assert.equal(committed.replayed,false);
    }finally{resumeAdmission();resumeRead();await pending?.catch(()=>{});fixture.pool.removeListener('acquire',observe);for(const [client,original]of originals)client.query=original;}
  },{...enabled,manualReporterDirectory:directory,realWorkbenchAuthentication:true});
});

test('verified POST replay reauthorizes the retained target; changed intent, object loss, substituted target and staff creation loss never expose or replace the committed result',async()=>{
  const source=directoryAuthority();await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);const http=await client(fixture),input=source.command();
    const external=await externalFacts(fixture.pool),initial=await http.post(input);assert.equal(initial.status,202);const result=object(await initial.json());
    const graph=await facts(fixture.pool),retained=async()=>(await fixture.pool.query('SELECT manual_report_snapshot,manual_reporter_verification FROM intake.service_intake WHERE id=$1::uuid',[text(result.intake_id)])).rows;
    const original=await retained();assert.equal(original.length,1);assert.deepEqual(source.calls.map(call=>call.purpose),['ADMISSION']);
    const replay=await http.post(input);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{...result,replayed:true});
    assert.deepEqual(source.calls.map(call=>call.purpose),['ADMISSION','READ_COMMITTED']);assert.deepEqual(source.calls[1]?.target,source.target);
    assert.deepEqual(await facts(fixture.pool),graph);assert.deepEqual(await retained(),original);
    const count=source.calls.length,conflict=await http.post({...input,description:input.description+'，修改原意图'});
    assert.equal(conflict.status,409);assert.equal(object(object(await conflict.json()).error).code,'P2_016_COMMAND_CONFLICT');assert.equal(source.calls.length,count);
    for(const [mode,status,code] of [['DENY',403,'P2_016_FORBIDDEN'],['WRONG_TARGET',503,'P2_016_ACTION_FAILED']] as const){
      source.setReadMode(mode);const refused=await http.post(input);assert.equal(refused.status,status);const denied=object(await refused.json());assert.equal(object(denied.error).code,code);
      assert.equal(Object.hasOwn(denied,'intake_id'),false);assert.equal(Object.hasOwn(denied,'result'),false);assert.equal(source.calls.at(-1)?.purpose,'READ_COMMITTED');
      assert.deepEqual(await facts(fixture.pool),graph);assert.deepEqual(await retained(),original);
    }
    source.setReadMode('ALLOW');const priorCalls=source.calls.length;
    await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await http.post(input)).status,403);assert.equal(source.calls.length,priorCalls,'creation authority must reject before asking the Directory');
    assert.deepEqual(await facts(fixture.pool),graph);assert.deepEqual(await retained(),original);assert.deepEqual(await externalFacts(fixture.pool),external);
  },{...enabled,manualReporterDirectory:source.directory});
});

test('verified unreachable and unknown reachability are accepted with manual contact and immutable safe qualification without creating outbound work',async()=>{
  const source=directoryAuthority();await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);const http=await client(fixture),external=await externalFacts(fixture.pool);
    for(const status of ['UNREACHABLE','UNKNOWN'] as const){
      source.setReachability(status);const input=source.command(),admitted=await http.post(input);assert.equal(admitted.status,202);const result=object(await admitted.json());
      assert.equal(result.reporter_verification,'VERIFIED');assert.equal(result.notification_eligibility,'NOT_REACHABLE');assert.equal(result.manual_contact_required,true);assert.equal(result.external_notification,false);
      const stored=(await fixture.pool.query<{snapshot:unknown;proof:unknown}>('SELECT manual_report_snapshot AS snapshot,manual_reporter_verification AS proof FROM intake.service_intake WHERE id=$1::uuid',[text(result.intake_id)])).rows[0];assert.ok(stored);
      const snapshot=object(stored.snapshot),proof=object(object(stored.proof).proof);assert.equal(snapshot.identity_source,'VERIFIED_DIRECTORY_SELECTION');assert.equal(object(snapshot.reporter).verification,'VERIFIED');
      assert.equal(snapshot.notification_eligibility,'NOT_REACHABLE');assert.equal(snapshot.manual_contact_required,true);assert.equal(snapshot.external_notification,false);assert.equal(object(proof.reachability).status,status);
      const ack=await http.get('/api/workbench/reports/commands/'+input.client_command_id);assert.equal(ack.status,200);assert.deepEqual(await ack.json(),{client_command_id:input.client_command_id,state:'COMMITTED',result:{...result,replayed:true}});
      assert.deepEqual(await externalFacts(fixture.pool),external);
    }
    assert.deepEqual(source.calls.map(call=>call.purpose),['ADMISSION','ADMISSION']);assert.equal((await facts(fixture.pool)).intakes,2);
  },{...enabled,manualReporterDirectory:source.directory});
});

test('a real verified Ticket Event failure rolls back the complete admission graph and private proof, leaving only the original failed command receipt',async()=>{
  const source=directoryAuthority();await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);const http=await client(fixture),input=source.command();
    const before=await facts(fixture.pool),external=await externalFacts(fixture.pool);
    // Disposable fault hook only. A nontransactional sequence proves the real transaction reached the populated verified graph before failing.
    await fixture.pool.query('CREATE SEQUENCE pilot_ticket.t18_verified_failure_reached');
    await fixture.pool.query(`CREATE FUNCTION pilot_ticket.t18_fail_verified_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.event_type='ticket.created' AND EXISTS(SELECT 1 FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id
        JOIN intake.contact_journey j ON j.origin_intake_id=i.id JOIN intake.channel_leg l ON l.journey_id=j.id AND l.source_intake_id=i.id
        JOIN intake.deterministic_decision d ON d.service_intake_id=i.id WHERE t.id=NEW.ticket_id AND i.source_channel='MANUAL' AND i.manual_reporter_verification IS NOT NULL)
      THEN PERFORM nextval('pilot_ticket.t18_verified_failure_reached');RAISE EXCEPTION 'T18_SYNTHETIC_VERIFIED_EVENT_FAILURE';END IF;RETURN NEW;END$$`);
    await fixture.pool.query('CREATE TRIGGER t18_verified_event_failure BEFORE INSERT ON pilot_ticket.ticket_event FOR EACH ROW EXECUTE FUNCTION pilot_ticket.t18_fail_verified_event()');
    try{
      const failed=await http.post(input);assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{ok:false,error:{code:'P2_016_ACTION_FAILED',retryable:false},replayed:false});
      assert.equal((await fixture.pool.query('SELECT is_called FROM pilot_ticket.t18_verified_failure_reached')).rows[0]?.is_called,true);
      const after=await facts(fixture.pool);assert.deepEqual({...after,receipts:before.receipts},before);assert.equal(before.receipts,0);assert.equal(after.receipts,1);
      const receipt=await http.get('/api/workbench/reports/commands/'+input.client_command_id);assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),{client_command_id:input.client_command_id,state:'FAILED',error:{code:'P2_016_ACTION_FAILED',retryable:false}});
      assert.equal((await fixture.pool.query("SELECT 1 FROM intake.service_intake WHERE source_channel='MANUAL' AND manual_reporter_verification IS NOT NULL")).rowCount,0);assert.deepEqual(await externalFacts(fixture.pool),external);
    }finally{
      await fixture.pool.query('DROP TRIGGER t18_verified_event_failure ON pilot_ticket.ticket_event');await fixture.pool.query('DROP FUNCTION pilot_ticket.t18_fail_verified_event()');await fixture.pool.query('DROP SEQUENCE pilot_ticket.t18_verified_failure_reached');
    }
    const replay=await http.post(input);assert.equal(replay.status,503);assert.deepEqual(await replay.json(),{ok:false,error:{code:'P2_016_ACTION_FAILED',retryable:false},replayed:true});
    assert.deepEqual(await facts(fixture.pool),{...before,receipts:1});assert.deepEqual(await externalFacts(fixture.pool),external);
  },{...enabled,manualReporterDirectory:source.directory});
});

test('missing the 051 ledger rejects verified HTTP admission before Directory verification without any source, receipt or outbound writes',async()=>{
  const source=directoryAuthority();await withWeb01Fixture(async(fixture:Fixture)=>{
    const actor=fixture.principals[0];assert.ok(actor);source.setPrincipal(actor.id);await applyT18ForwardCheck(fixture.pool);
    const http=await client(fixture),input=source.command(),before=await facts(fixture.pool),external=await externalFacts(fixture.pool);
    const removed=(await fixture.pool.query<{migration_id:string;checksum_sha256:string;applied_at:string;applied_epoch_ms:string}>(
      "DELETE FROM platform.schema_migration WHERE migration_id='051_workbench_verified_manual_report_candidate_ref_check' RETURNING migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text")).rows[0];assert.ok(removed);
    try{
      assert.equal((await fixture.pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='045_workbench_verified_manual_reports'")).rowCount,1);
      const response=await http.post(input);assert.equal(response.status,503,'T18_MISSING_051_MUST_REFUSE_BEFORE_DIRECTORY_OR_ADMISSION');
      assert.equal(object(object(await response.json()).error).code,'P2_016_ACTION_FAILED');assert.equal(source.calls.length,0);
      assert.deepEqual(await facts(fixture.pool),before);assert.deepEqual(await externalFacts(fixture.pool),external);
    }finally{
      await fixture.pool.query('INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) VALUES($1,$2,$3::timestamp without time zone,$4::bigint)',
        [removed.migration_id,removed.checksum_sha256,removed.applied_at,removed.applied_epoch_ms]);
      const restored=(await fixture.pool.query('SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text FROM platform.schema_migration WHERE migration_id=$1',[removed.migration_id])).rows[0];
      assert.deepEqual(restored,removed);
    }
  },{...enabled,manualReporterDirectory:source.directory});
});
