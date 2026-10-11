import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,confirmIncident,followupHttp,personalSnapshots,rows} from './helpers/t28-followup-source-fixture.mjs';

// SOURCE_ONLY / NOT_BUILT_NOT_RUN. Future counter faults retain real SQL/Core/ledger and public HTTP.
test('T28 exact parent/child versions, foreign targets and same-parent competition remain atomic',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28-exact-parent-child',reporters:6},async context=>{
    const {http,id,path}=await prepareFollowup(context,3);
    const otherCandidate=text(record(await context.f.newCandidate(3)).id);
    const otherId=await confirmIncident(http,otherCandidate,text(record(context.f.handler).id),context.f.reports.slice(3).map(value=>text(record(value).decisionId)));
    const otherPath='/api/incidents/'+otherId;
    const firstTicket=text(record(context.f.reports[0]).ticketId),report=rows((await http.get(path+'/reports?limit=100')).items).find(value=>value.ticket_id===firstTicket);assert.ok(report);
    const sub=rows((await http.get(path+'/subscriptions?limit=100')).items).find(value=>value.status==='ACTIVE'&&value.representative_report_id!==report.id);assert.ok(sub);
    assert.notEqual(sub.representative_report_id,report.id,'competition uses a different Reporter subscription target');
    const foreignReport=rows((await http.get(otherPath+'/reports?limit=100')).items)[0],foreignSub=rows((await http.get(otherPath+'/subscriptions?limit=100')).items)[0];assert.ok(foreignReport&&foreignSub);
    const parentVersion='9007199254740993',reportVersion='9007199254740995',subVersion='9007199254740997';
    // Only exact version counters are fault-injected; no business state/event or schema is fabricated.
    await context.pool.query('UPDATE incident.incident SET row_version=$2::bigint WHERE id=$1::uuid',[id,parentVersion]);
    await context.pool.query('UPDATE incident.incident_report SET row_version=$2::bigint WHERE id=$1::uuid',[report.id,reportVersion]);
    await context.pool.query('UPDATE incident.reporter_subscription SET row_version=$2::bigint WHERE id=$1::uuid',[sub.id,subVersion]);
    assert.equal((await http.get(path)).row_version,parentVersion);
    const snapshot=async()=>({detail:await http.get(path),reports:await http.get(path+'/reports?limit=100'),subscriptions:await http.get(path+'/subscriptions?limit=100'),events:await http.get(path+'/events?limit=200'),other:await http.get(otherPath),personal:await personalSnapshots(http,context.f.reports)}),before=await snapshot();
    const intent=(fields:Record<string,unknown>={})=>({client_command_id:randomUUID(),expected_row_version:parentVersion,reason_code:'WORKBENCH_CONFIRMED',...fields});
    await http.post(path+'/primary-ticket',intent({expected_row_version:9007199254740992,primary_ticket_id:null}),400);
    await http.post(path+'/primary-ticket',intent({expected_row_version:'9007199254740992',primary_ticket_id:null}),409);
    await http.post(path+'/reports/'+text(report.id)+'/mark-recovered',intent({reason_code:'RECOVERY_CONFIRMED',expected_report_version:'9007199254740994'}),409);
    await http.post(path+'/subscriptions/'+text(sub.id)+'/pause',intent({reason_code:'SUBSCRIPTION_REQUEST',expected_subscription_version:'9007199254740996'}),409);
    await http.post(path+'/reports/'+text(foreignReport.id)+'/mark-recovered',intent({reason_code:'RECOVERY_CONFIRMED',expected_report_version:text(foreignReport.row_version)}),403);
    await http.post(path+'/subscriptions/'+text(foreignSub.id)+'/pause',intent({reason_code:'SUBSCRIPTION_REQUEST',expected_subscription_version:text(foreignSub.row_version)}),404);
    await http.post(path+'/primary-ticket',intent({primary_ticket_id:text(record(context.f.reports[3]).ticketId)}),409);
    await http.post(path+'/reports/link',intent({reason_code:'CONFIRMED_SHARED_FAULT',source_decision_id:text(record(context.f.reports[3]).decisionId)}),409);
    assert.deepEqual(await snapshot(),before);
    const commands=[{path:path+'/reports/'+text(report.id)+'/mark-recovered',body:intent({reason_code:'RECOVERY_CONFIRMED',expected_report_version:reportVersion})},{path:path+'/subscriptions/'+text(sub.id)+'/pause',body:intent({reason_code:'SUBSCRIPTION_REQUEST',expected_subscription_version:subVersion})}];
    const results=await Promise.all(commands.map(command=>http.post(command.path,command.body,null)));
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const winner=results.findIndex(result=>result.status===200),winning=commands[winner];assert.ok(winning);
    assert.equal((await http.get(path)).row_version,'9007199254740994');
    const replay=await http.post(winning.path,winning.body);assert.equal(replay.body.replayed,true);assert.equal(replay.body.result_event_id,results[winner]?.body.result_event_id);
    await http.post(winning.path,{...winning.body,reason_code:'OPERATOR_REVIEWED'},409);
    const afterReports=rows((await http.get(path+'/reports?limit=100')).items),afterSubs=rows((await http.get(path+'/subscriptions?limit=100')).items);
    if(winner===0){assert.equal(afterReports.find(value=>value.id===report.id)?.row_version,'9007199254740996');assert.deepEqual(afterSubs.find(value=>value.id===sub.id),rows(before.subscriptions.items).find(value=>value.id===sub.id));}
    else{assert.equal(afterSubs.find(value=>value.id===sub.id)?.row_version,'9007199254740998');assert.deepEqual(afterReports.find(value=>value.id===report.id),rows(before.reports.items).find(value=>value.id===report.id));}
    assert.deepEqual(await personalSnapshots(http,context.f.reports),before.personal);assert.deepEqual(await http.get(otherPath),before.other);
  });
});

test('T28 current Incident purpose and scope authority do not follow owner identity or stale ADMIN Cookie',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28-current-purpose',reporters:3},async context=>{
    const http=await followupHttp(context.browser),access=createPilotAccessService({pool:context.pool});
    const roles=async(value:Array<'ADMIN'|'DISPATCHER'|'HANDLER'>)=>access.upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:value,resolverTeamIds:['PILOT_IT']});
    await roles(['DISPATCHER']);
    const candidatePath='/api/incident-candidates/'+context.candidateId;
    await http.post(candidatePath+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
    const candidate=await http.get(candidatePath),confirm=(scope:string)=>({client_command_id:randomUUID(),reason_code:'CONFIRMED_SHARED_FAULT',expected_candidate_version:text(candidate.row_version),expected_material_basis:text(candidate.material_basis),confirmed_scope:scope,owner_principal_id:text(record(context.f.admin).id),owner_team_id:null,primary_ticket_id:null,selected_report_refs:context.f.reports.map(value=>text(record(value).decisionId))});
    for(const scope of ['CAMPUS','HOSPITAL_WIDE'])await http.post(candidatePath+'/confirm',confirm(scope),403);
    assert.equal((await http.get(candidatePath)).row_version,candidate.row_version);
    const confirmed=await http.post(candidatePath+'/confirm',confirm('LOCAL')),path='/api/incidents/'+text(confirmed.body.result_ref_id);
    const personal=await personalSnapshots(http,context.f.reports),before=await http.get(path),events=await http.get(path+'/events?limit=200'),reports=await http.get(path+'/reports?limit=100'),subscriptions=await http.get(path+'/subscriptions?limit=100');
    const report=rows(reports.items)[0],sub=rows(subscriptions.items)[0];assert.ok(report&&sub);
    const intent=(extra:Record<string,unknown>={})=>({client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_CONFIRMED',...extra});
    await http.post(path+'/correct-scope',intent({reason_code:'SCOPE_CORRECTION',confirmed_scope:'BUILDING'}),403);
    await http.post(path+'/subscriptions/'+text(sub.id)+'/pause',intent({reason_code:'SUBSCRIPTION_REQUEST',expected_subscription_version:text(sub.row_version)}),403);
    await http.post(path+'/close',intent({reason_code:'RECOVERY_CONFIRMED'}),403);
    await roles(['HANDLER']);
    const narrow=await http.get(path);assert.equal(Object.hasOwn(narrow,'owner_principal_id'),false);assert.equal(Object.hasOwn(narrow,'primary_ticket_id'),false);
    await http.post(path+'/start-investigating',intent({reason_code:'OPERATOR_REVIEWED'}),403);
    await http.post(path+'/primary-ticket',intent({primary_ticket_id:null}),403);
    await http.post(path+'/reports/'+text(report.id)+'/mark-recovered',intent({reason_code:'RECOVERY_CONFIRMED',expected_report_version:text(report.row_version)}),403);
    assert.equal((await http.read(path+'/subscriptions?limit=100')).status,403);
    await roles(['DISPATCHER']);
    assert.deepEqual(await http.get(path),before); // Restore the role used for the baseline projection reads.
    assert.deepEqual(await http.get(path+'/events?limit=200'),events);assert.deepEqual(await http.get(path+'/reports?limit=100'),reports);assert.deepEqual(await http.get(path+'/subscriptions?limit=100'),subscriptions);assert.deepEqual(await personalSnapshots(http,context.f.reports),personal);
  });
});
