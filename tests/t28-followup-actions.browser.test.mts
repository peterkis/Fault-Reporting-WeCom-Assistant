import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,personalSnapshots,navigateFollowup,observeFollowupPosts,submitFollowup,assertClosedUiCommand,rows} from './helpers/t28-followup-source-fixture.mjs';

// Nine independent future tracers at the existing public POST/production-bundle seam.
// SOURCE_ONLY / NOT_BUILT_NOT_RUN; no missing selector is labelled a current RED.
const actions=['CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT'] as const;
for(const action of actions)test('T28 production follow-up '+action+' uses its original closed command and preserves individual Tickets',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28-followup-'+String(actions.indexOf(action)),reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context,action==='LINK_REPORT'?2:3);
    let reports=rows((await http.get(path+'/reports?limit=100')).items),subscriptions=rows((await http.get(path+'/subscriptions?limit=100')).items);
    const firstTicket=text(record(context.f.reports[0]).ticketId),report=reports.find(item=>item.ticket_id===firstTicket);assert.ok(report);
    const active=subscriptions.find(item=>item.status==='ACTIVE');assert.ok(active);
    if(action==='RESUME_SUBSCRIPTION')await http.post(path+'/subscriptions/'+text(active.id)+'/pause',{client_command_id:randomUUID(),expected_row_version:'1',expected_subscription_version:text(active.row_version),reason_code:'SUBSCRIPTION_REQUEST'});
    if(action==='RESOLVE_INCIDENT'||action==='CLOSE_INCIDENT')await http.post(path+'/start-investigating',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
    if(action==='CLOSE_INCIDENT')await http.post(path+'/resolve',{client_command_id:randomUUID(),expected_row_version:'2',reason_code:'RECOVERY_CONFIRMED'});
    const before=await http.get(path),personal=await personalSnapshots(http,context.f.reports),notifications=await http.get(path+'/notifications?limit=100');
    reports=rows((await http.get(path+'/reports?limit=100')).items);subscriptions=rows((await http.get(path+'/subscriptions?limit=100')).items);
    const currentReport=reports.find(item=>item.id===report.id),currentSub=subscriptions.find(item=>item.id===active.id);assert.ok(currentReport&&currentSub);
    let suffix='',reason='',extra:Record<string,unknown>={},controls:ReadonlyArray<readonly[string,string]>=[];
    if(action==='CORRECT_SCOPE'){suffix='/correct-scope';reason='SCOPE_CORRECTION';extra={confirmed_scope:'BUILDING'};controls=[['确认范围','BUILDING']];}
    if(action==='SET_PRIMARY_TICKET'){suffix='/primary-ticket';reason='WORKBENCH_CONFIRMED';extra={primary_ticket_id:firstTicket};controls=[['主工单',firstTicket]];}
    if(action==='LINK_REPORT'){const source=text(record(context.f.reports[2]).decisionId);suffix='/reports/link';reason='CONFIRMED_SHARED_FAULT';extra={source_decision_id:source};controls=[['报修来源',source]];}
    if(action==='UNLINK_REPORT'||action==='MARK_REPORTER_RECOVERED'){suffix='/reports/'+text(currentReport.id)+(action==='UNLINK_REPORT'?'/unlink':'/mark-recovered');reason=action==='UNLINK_REPORT'?'INCORRECT_ASSOCIATION':'RECOVERY_CONFIRMED';extra={expected_report_version:text(currentReport.row_version)};controls=[['关联报修',text(currentReport.id)]];}
    if(action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'){suffix='/subscriptions/'+text(currentSub.id)+(action==='PAUSE_SUBSCRIPTION'?'/pause':'/resume');reason='SUBSCRIPTION_REQUEST';extra={expected_subscription_version:text(currentSub.row_version)};controls=[['通知订阅',text(currentSub.id)]];}
    if(action==='RESOLVE_INCIDENT'||action==='CLOSE_INCIDENT'){suffix=action==='RESOLVE_INCIDENT'?'/resolve':'/close';reason='RECOVERY_CONFIRMED';}
    await navigateFollowup(context,id);await observeFollowupPosts(context.browser);
    const expectedVersion=action==='CLOSE_INCIDENT'?'4':action==='RESUME_SUBSCRIPTION'||action==='RESOLVE_INCIDENT'?'3':'2';
    await submitFollowup(context,id,action,reason,controls,expectedVersion);
    const command=await assertClosedUiCommand(context.browser,path+suffix,{expected_row_version:text(before.row_version),reason_code:reason,...extra});
    const after=await http.get(path);assert.equal(after.row_version,expectedVersion);
    if(action==='CORRECT_SCOPE')assert.equal(after.confirmed_scope,'BUILDING');
    if(action==='SET_PRIMARY_TICKET'){
      assert.equal(after.primary_ticket_id,firstTicket);
      await navigateFollowup(context,id);await observeFollowupPosts(context.browser);
      await submitFollowup(context,id,action,reason,[['主工单','NONE']],'3');
      const clear=await assertClosedUiCommand(context.browser,path+suffix,{expected_row_version:'2',reason_code:reason,primary_ticket_id:null});assert.notEqual(clear.client_command_id,command.client_command_id);assert.equal((await http.get(path)).primary_ticket_id,null);
    }
    const nextReports=rows((await http.get(path+'/reports?limit=100')).items),nextSubscriptions=rows((await http.get(path+'/subscriptions?limit=100')).items);
    if(action==='LINK_REPORT')assert.equal(nextReports.filter(item=>item.link_state==='LINKED').length,3);
    if(action==='UNLINK_REPORT'){
      assert.equal(nextReports.find(item=>item.id===currentReport.id)?.link_state,'UNLINKED');
      const ended=subscriptions.find(item=>item.representative_report_id===currentReport.id);assert.ok(ended);assert.equal(nextSubscriptions.find(item=>item.id===ended.id)?.status,'ENDED');
      assert.deepEqual(nextSubscriptions.filter(item=>item.id!==ended.id),subscriptions.filter(item=>item.id!==ended.id));
    }
    if(action==='MARK_REPORTER_RECOVERED'){
      assert.equal(nextReports.find(item=>item.id===currentReport.id)?.impact_state,'RECOVERED');
      const recovered=subscriptions.find(item=>item.representative_report_id===currentReport.id);assert.ok(recovered);assert.equal(nextSubscriptions.find(item=>item.id===recovered.id)?.impact_state,'RECOVERED');
      assert.deepEqual(nextReports.filter(item=>item.id!==currentReport.id),reports.filter(item=>item.id!==currentReport.id));assert.deepEqual(nextSubscriptions.filter(item=>item.id!==recovered.id),subscriptions.filter(item=>item.id!==recovered.id));
    }
    if(action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'){
      assert.equal(nextSubscriptions.find(item=>item.id===currentSub.id)?.status,action==='PAUSE_SUBSCRIPTION'?'PAUSED':'ACTIVE');assert.deepEqual(nextSubscriptions.filter(item=>item.id!==currentSub.id),subscriptions.filter(item=>item.id!==currentSub.id));assert.deepEqual(nextReports,reports);
    }
    if(action==='RESOLVE_INCIDENT'||action==='CLOSE_INCIDENT'){assert.equal(after.status,action==='RESOLVE_INCIDENT'?'RESOLVED':'CLOSED');assert.deepEqual(nextReports,reports);assert.deepEqual(nextSubscriptions,subscriptions);}
    assert.deepEqual(await personalSnapshots(http,context.f.reports),personal);
    if(!['RESOLVE_INCIDENT','CLOSE_INCIDENT'].includes(action))assert.deepEqual(await http.get(path+'/notifications?limit=100'),notifications);
    const eventTypes=rows((await http.get(path+'/events?limit=200')).items).map(item=>item.event_type);
    const expectedEvent={CORRECT_SCOPE:'incident.scope.corrected',SET_PRIMARY_TICKET:'incident.primary_ticket_changed',LINK_REPORT:'incident.report.linked',UNLINK_REPORT:'incident.report.unlinked',MARK_REPORTER_RECOVERED:'incident.report.recovered',PAUSE_SUBSCRIPTION:'incident.subscription.paused',RESUME_SUBSCRIPTION:'incident.subscription.activated',RESOLVE_INCIDENT:'incident.resolved',CLOSE_INCIDENT:'incident.closed'}[action];assert.ok(eventTypes.includes(expectedEvent));
  });
});
