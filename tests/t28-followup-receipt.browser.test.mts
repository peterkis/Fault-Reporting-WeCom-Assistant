import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {prepareFollowup,rows,personalSnapshots} from './helpers/t28-followup-source-fixture.mjs';

test('T28 Incident receipt reads the original ledger and requires current action purpose before exposing its outcome',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28receipt',reporters:3},async context=>{
    const {http,id,path}=await prepareFollowup(context),before=await personalSnapshots(http,context.f.reports),missing=randomUUID();
    assert.deepEqual(await http.get(path+'/commands/'+missing),{incident_id:id,client_command_id:missing,state:'UNKNOWN'});
    const command={client_command_id:randomUUID(),expected_row_version:'1',reason_code:'SCOPE_CORRECTION',confirmed_scope:'BUILDING'},result=await http.post(path+'/correct-scope',command);
    const receipt=await http.get(path+'/commands/'+command.client_command_id);
    assert.deepEqual(receipt,{incident_id:id,client_command_id:command.client_command_id,state:'COMMITTED',result:{...result.body,replayed:true}});
    assert.equal((await http.read(path+'/commands/'+command.client_command_id+'?state=COMMITTED')).status,400);
    const failed={...command,client_command_id:randomUUID()};await http.post(path+'/correct-scope',failed,409);
    assert.deepEqual(await http.get(path+'/commands/'+failed.client_command_id),{incident_id:id,client_command_id:failed.client_command_id,state:'FAILED',error:{code:'P2_012_VERSION_CONFLICT',retryable:false}});
    const events=rows((await http.get(path+'/events?limit=200')).items),access=createPilotAccessService({pool:context.pool});
    await access.upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
    assert.equal((await http.read(path+'/commands/'+command.client_command_id)).status,403,'reading the parent as dispatcher cannot recover an ADMIN-only action');
    assert.equal((await http.read(path+'/commands/'+failed.client_command_id)).status,403);
    await access.upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['ADMIN','DISPATCHER','HANDLER'],resolverTeamIds:['PILOT_IT']});
    assert.deepEqual(rows((await http.get(path+'/events?limit=200')).items),events);
    assert.deepEqual(await personalSnapshots(http,context.f.reports),before);
    assert.doesNotMatch(JSON.stringify(receipt),/command_hash|reporter_identity_hash|source_chat_id|raw_target|reason_code|confirmed_scope/u);
  });
});

test('T28 default-disabled workspace keeps old Incident READ while follow-up receipt, child consumption and recovery remain off',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28off',reporters:3,workspace:false,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context),cookie=record(context.started.cookie),headers={cookie:text(cookie.name)+'='+text(cookie.value)};
    assert.equal((await fetch(context.origin+path,{headers})).status,200);
    assert.equal((await fetch(context.origin+path+'/commands/'+randomUUID(),{headers})).status,404);
    await context.browser.command('Page.navigate',{url:context.origin+'/workbench/app/incidents/'+id});
    await context.browser.waitFor('document.body.innerText.includes("候选工作区尚未启用")');
    assert.deepEqual(await context.browser.evaluate('globalThis.__t27DomainReads'),[]);assert.deepEqual(await context.browser.evaluate('globalThis.__t27Posts'),[]);
    assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-action=submit-incident]"))'),false);
    assert.equal(await context.browser.evaluate('(async()=>!(await indexedDB.databases()).some(db=>db.name==="wecom-workbench-drafts-v1"))()'),true);
  });
});
