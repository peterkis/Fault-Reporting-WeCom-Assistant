import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {fixtureP2012} from './helpers/p2-012-postgres-harness.mjs';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {followupHttp,confirmIncident,navigateFollowup,chooseFollowup,observeFollowupPosts,rows} from './helpers/t28-followup-source-fixture.mjs';

test('T28 resume chooses only the selected same-reporter live DIRECT destination; group and other-reporter legs remain rejected',{timeout:240000},async()=>{
  let shared:Awaited<ReturnType<typeof fixtureP2012>>|undefined;
  await candidateBrowser({purpose:'t28direct',reporters:3,setup:async({pool})=>{shared=await fixtureP2012(pool,{reporters:2,sameReporter:true});}},async context=>{
    assert.ok(shared);const http=await followupHttp(context.browser),candidateId=text(record(await shared.newCandidate()).id),group=record(shared.reports[0]),direct=record(shared.reports[1]);
    const id=await confirmIncident(http,candidateId,text(record(context.f.handler).id),[text(group.decisionId)]),path='/api/incidents/'+id,sub=rows((await http.get(path+'/subscriptions?limit=30')).items)[0];assert.ok(sub);assert.equal(sub.status,'PENDING_DESTINATION');
    const destinations=rows((await http.get(path+'/subscriptions/'+text(sub.id)+'/direct-destinations?limit=30')).items);assert.ok(destinations.some(row=>row.id===direct.legId));assert.equal(destinations.some(row=>row.id===group.legId||row.id===record(context.f.reports[1]).legId),false);assert.ok(destinations.every(row=>row.subscription_id===sub.id));assert.equal(/reporter_identity|source_chat_id|wecom_user|target_id/u.test(JSON.stringify(destinations)),false);
    const body={client_command_id:randomUUID(),reason_code:'SUBSCRIPTION_REQUEST',expected_row_version:'1',expected_subscription_version:text(sub.row_version)};
    await http.post(path+'/subscriptions/'+text(sub.id)+'/resume',{...body,direct_channel_leg_id:text(group.legId)},409);await http.post(path+'/subscriptions/'+text(sub.id)+'/resume',{...body,client_command_id:randomUUID(),direct_channel_leg_id:text(record(context.f.reports[1]).legId)},409);assert.equal((await http.get(path)).row_version,'1');
    await navigateFollowup(context,id);await observeFollowupPosts(context.browser);await chooseFollowup(context.browser,'公共故障操作','RESUME_SUBSCRIPTION');await chooseFollowup(context.browser,'决定原因','SUBSCRIPTION_REQUEST');await chooseFollowup(context.browser,'通知订阅',text(sub.id));
    await context.browser.waitFor('Boolean(document.querySelector("select[aria-label=本人通知渠道]"))');await chooseFollowup(context.browser,'本人通知渠道',text(direct.legId));await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已提交")');
    const posts=rows(await context.browser.evaluate('globalThis.__t28Posts'));assert.equal(posts.length,1);const post=posts[0];assert.ok(post);assert.equal(post.path,path+'/subscriptions/'+text(sub.id)+'/resume');const posted=record(JSON.parse(text(post.body)));assert.equal(posted.direct_channel_leg_id,direct.legId);assert.equal(posted.expected_subscription_version,sub.row_version);assert.equal(posted.expected_row_version,'1');assert.equal(post.if_match,'"1"');
    const current=rows((await http.get(path+'/subscriptions?limit=30')).items)[0];assert.ok(current);assert.equal(current.status,'ACTIVE');assert.equal(current.row_version,'2');assert.equal((await http.get(path)).row_version,'2');
    await http.post(path+'/subscriptions/'+text(sub.id)+'/pause',{client_command_id:randomUUID(),reason_code:'SUBSCRIPTION_REQUEST',expected_row_version:'2',expected_subscription_version:'2'});
    await http.post(path+'/subscriptions/'+text(sub.id)+'/resume',{client_command_id:randomUUID(),reason_code:'SUBSCRIPTION_REQUEST',expected_row_version:'3',expected_subscription_version:'3'});assert.equal(rows((await http.get(path+'/subscriptions?limit=30')).items)[0]?.status,'ACTIVE','omitting a destination retains the existing valid channel');
  });
});
