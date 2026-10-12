import assert from 'node:assert/strict';
import {test} from 'node:test';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,navigateFollowup,chooseFollowup,observeFollowupPosts,personalSnapshots,rows} from './helpers/t28-followup-source-fixture.mjs';

test('T28 the real form preserves parent and child BIGINT versions above Number precision through exact HTTP and committed facts',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28bigui',reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context),target=rows((await http.get(path+'/reports?limit=30')).items).find(row=>row.ticket_id===record(context.f.reports[0]).ticketId);assert.ok(target);const parent='9007199254740993',child='9007199254740995';
    // Only version counters are fault-injected in the owned database; Core facts/events stay real.
    await context.pool.query('UPDATE incident.incident SET row_version=$2::bigint WHERE id=$1::uuid',[id,parent]);await context.pool.query('UPDATE incident.incident_report SET row_version=$2::bigint WHERE id=$1::uuid',[target.id,child]);const personal=await personalSnapshots(http,context.f.reports);await navigateFollowup(context,id);await observeFollowupPosts(context.browser);await chooseFollowup(context.browser,'公共故障操作','MARK_REPORTER_RECOVERED');await chooseFollowup(context.browser,'决定原因','RECOVERY_CONFIRMED');await chooseFollowup(context.browser,'关联报修',text(target.id));await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已提交")');
    const posts=rows(await context.browser.evaluate('globalThis.__t28Posts')),post=posts[0];assert.equal(posts.length,1);assert.ok(post);const body=record(JSON.parse(text(post.body)));assert.equal(body.expected_row_version,parent);assert.equal(body.expected_report_version,child);assert.equal(post.if_match,'"'+parent+'"');assert.equal(post.idempotency_key,body.client_command_id);assert.equal((await http.get(path)).row_version,'9007199254740994');assert.equal(rows((await http.get(path+'/reports?limit=30')).items).find(row=>row.id===target.id)?.row_version,'9007199254740996');assert.deepEqual(await personalSnapshots(http,context.f.reports),personal);
  });
});
