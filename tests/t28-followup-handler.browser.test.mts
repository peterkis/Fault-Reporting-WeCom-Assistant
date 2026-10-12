import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createP2016TicketCommandFacade} from '../src/p2-016-ticket-command-facade.mjs';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,navigateFollowup,chooseFollowup,personalSnapshots,rows,observeFollowupPosts} from './helpers/t28-followup-source-fixture.mjs';

test('T28 current-assignee HANDLER records only one recovery through the formal form; transfer revokes its original receipt and replay',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28handler',reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context),actorId=text(record(context.f.admin).id),ownerId=text(record(context.f.handler).id),ticketId=text(record(context.f.reports[0]).ticketId);
    assert.notEqual(actorId,ownerId);
    const tickets=createP2016TicketCommandFacade({pool:context.pool,enabled:true});
    const assign=async(target:string)=>{const ticket=await http.get('/api/tickets/'+ticketId);return tickets.perform({authContext:{principal_id:text(record(context.f.dispatcher).id)},command:{action:'transfer-assignment',ticket_id:ticketId,client_command_id:randomUUID(),expected_version:ticket.version,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target,resolver_team_id:'PILOT_IT'}});};
    assert.equal((await assign(actorId)).ok,true);
    const beforeReports=rows((await http.get(path+'/reports?limit=100')).items),target=beforeReports.find(row=>row.ticket_id===ticketId);assert.ok(target);
    const beforeSubs=rows((await http.get(path+'/subscriptions?limit=100')).items);
    await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    const personal=await personalSnapshots(http,context.f.reports);
    await navigateFollowup(context,id);await observeFollowupPosts(context.browser);
    assert.equal((await http.get(path)).owner_principal_id,undefined,'owner fields remain cropped for HANDLER');
    assert.equal(await context.browser.evaluate('Boolean(document.querySelector("section[aria-label=通知订阅窗口]"))'),false);
    await chooseFollowup(context.browser,'公共故障操作','MARK_REPORTER_RECOVERED');await chooseFollowup(context.browser,'决定原因','RECOVERY_CONFIRMED');await chooseFollowup(context.browser,'关联报修',text(target.id));
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已提交")');
    const posts=rows(await context.browser.evaluate('globalThis.__t28Posts'));assert.equal(posts.length,1);const post=posts[0];assert.ok(post);assert.equal(post.path,path+'/reports/'+text(target.id)+'/mark-recovered');const body=record(JSON.parse(text(post.body)));
    assert.equal(body.expected_row_version,'1');assert.equal(body.expected_report_version,target.row_version);assert.equal(post.if_match,'"1"');assert.equal(post.idempotency_key,body.client_command_id);
    const afterReports=rows((await http.get(path+'/reports?limit=100')).items);assert.equal(afterReports.find(row=>row.id===target.id)?.impact_state,'RECOVERED');assert.deepEqual(afterReports.filter(row=>row.id!==target.id),beforeReports.filter(row=>row.id!==target.id));
    assert.deepEqual(await personalSnapshots(http,context.f.reports),personal);assert.equal((await http.get(path+'/commands/'+text(body.client_command_id))).state,'COMMITTED');
    assert.equal((await assign(ownerId)).ok,true);assert.equal((await http.read(path+'/commands/'+text(body.client_command_id))).status,403);await http.post(text(post.path),body,403);
    assert.equal((await http.get(path)).row_version,'2');assert.deepEqual(rows((await http.get(path+'/reports?limit=100')).items),afterReports);
    // A separate current ADMIN projection checks only this reporter's subscription changed.
    await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const afterSubs=rows((await http.get(path+'/subscriptions?limit=100')).items),ownSub=beforeSubs.find(row=>row.representative_report_id===target.id);assert.ok(ownSub);assert.equal(afterSubs.find(row=>row.id===ownSub.id)?.impact_state,'RECOVERED');assert.deepEqual(afterSubs.filter(row=>row.id!==ownSub.id),beforeSubs.filter(row=>row.id!==ownSub.id));
  });
});
