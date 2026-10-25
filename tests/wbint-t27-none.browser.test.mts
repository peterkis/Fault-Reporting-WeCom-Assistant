import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createP2012IncidentCommandService} from '../app/server/src/p2-012-incident-command-service.mjs';
test('T27 actual NONE resolver team differs from explicit no-team and confirmation reads its independent Incident',async()=>{
 await candidateBrowser({purpose:'t27noneteam',setup:async({pool,f,candidateId})=>{
  await pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES ('NONE','合成实际NONE责任组')");const handler=record(f.handler);
  await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:text(handler.wecom_user_id),displayName:text(handler.display_name),roles:['HANDLER'],resolverTeamIds:['PILOT_IT','NONE']});
  assert.equal((await createP2012IncidentCommandService({pool,enabled:true}).perform({authContext:{principal_id:text(record(f.admin).id)},command:{action:'START_REVIEW',candidate_review_id:candidateId,expected_row_version:'1',client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED'}})).ok,true);
 }},async({pool,f,candidateId,browser,root,choose})=>{
  await choose('人工决定','CONFIRM_INCIDENT');await choose('决定原因','CONFIRMED_SHARED_FAULT');await choose('确认范围','LOCAL');await choose('故障负责人',text(record(f.handler).id));
  const raw=await browser.evaluate(`Array.from(document.querySelector(${JSON.stringify(root)}).querySelector('select[aria-label="责任组"]').options).map(option=>({value:option.value,label:option.textContent}))`);assert.ok(Array.isArray(raw));const options=raw.map(record),actual=options.find(option=>option.label==='合成实际NONE责任组'),none=options.find(option=>option.label==='无责任组');assert.ok(actual&&none);assert.notEqual(actual.value,none.value,'a legitimate team code cannot be decoded as null');
  await choose('责任组',text(actual.value));const source=text(record(f.reports[0]).decisionId);await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('input[data-report-ref="${source}"]').click()`);await choose('主工单','NONE');await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-action=submit-candidate]').click()`);
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root)})?.querySelector('[data-result-ref] [data-incident-id]'))`);
  const row=(await pool.query<{owner_team_id:string;primary_ticket_id:string|null}>('SELECT i.owner_team_id,i.primary_ticket_id::text FROM incident.incident i JOIN incident.candidate_review c ON c.confirmed_incident_id=i.id WHERE c.id=$1::uuid',[candidateId])).rows[0];assert.equal(row?.owner_team_id,'NONE');assert.equal(row?.primary_ticket_id,null);
  const posts=await browser.evaluate('globalThis.__t27Posts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);assert.equal(record(JSON.parse(text(record(posts[0]).body))).owner_team_id,'NONE');assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM incident.incident_report')).rows[0]?.count,1);
 });
});
