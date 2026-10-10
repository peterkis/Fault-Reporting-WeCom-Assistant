import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createP2012IncidentQuery} from '../src/p2-012-incident-query.mjs';
import {createP2012IncidentCommandService} from '../src/p2-012-incident-command-service.mjs';
import {withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';

test('T27 current decision context separates exact parent version, retained material basis and lawful owner choices',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'t27context',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate(),query=createP2012IncidentQuery({pool,enabled:true}),service=createP2012IncidentCommandService({pool,enabled:true});
    const authContext={principal_id:f.dispatcher.id},initial=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.deepEqual(initial.allowed_actions,['START_REVIEW','REJECT_CANDIDATE']);
    assert.deepEqual(initial.allowed_scopes,['LOCAL','BUILDING']);
    assert.match(initial.material_basis,/^[a-f0-9]{64}$/u);
    assert.equal(initial.materials.length,4);assert.ok(initial.materials.every(m=>m.status==='CURRENT'&&m.original_revision==='1'&&m.current_revision==='1'&&m.original_source_hash===m.current_source_hash));
    const owner=initial.eligible_owners.find(p=>p.id===f.handler.id);assert.deepEqual(owner.teams,[{team_id:'PILOT_IT',display_name:'Pilot 信息保障组'}]);
    assert.equal(initial.eligible_owners_truncated,false);assert.equal(owner.teams_truncated,false);
    const start=await service.perform({authContext,command:{action:'START_REVIEW',candidate_review_id:candidate.id,client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'}});assert.equal(start.ok,true);
    const current=await query.detail({authContext,id:candidate.id,kind:'candidate'});
    assert.equal(current.row_version,'2');assert.equal(current.material_basis,initial.material_basis);assert.deepEqual(current.allowed_actions,['REJECT_CANDIDATE','CONFIRM_INCIDENT']);
    const narrow=await query.detail({authContext:{principal_id:f.handler.id},id:candidate.id,kind:'candidate'});
    assert.deepEqual(narrow.allowed_actions,[]);assert.deepEqual(narrow.allowed_scopes,[]);assert.deepEqual(narrow.eligible_owners,[]);assert.equal(narrow.material_basis,null);
    await pool.query("UPDATE pilot_ticket.resolver_team SET is_active=false WHERE team_id='PILOT_IT'");
    const fresh=await query.detail({authContext,id:candidate.id,kind:'candidate'});assert.deepEqual(fresh.eligible_owners.find(p=>p.id===f.handler.id).teams,[]);
  }});await assertNoP2012Residual({databaseUrl});
});
