import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';

type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}

test('an authorized internal colleague reads only effective assignment groups and actual members through the public minimal-field query',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const ticket=context.tickets[0],actor=context.principals[1];assert.ok(ticket&&actor);
    const cookie=context.cookies[2],outsiderCookie=context.cookies[1];assert.ok(cookie&&outsiderCookie);
    // Synthetic directory configuration only; the candidate query must not write any Ticket fact.
    const group='T06_NETWORK',disabledGroup='T06_DISABLED',emptyGroup='T06_EMPTY';
    for(const [id,name,active] of [[group,'T06 合成网络组',true],[disabledGroup,'T06 停用组',false],[emptyGroup,'T06 无承接者组',true]] as const)await context.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name,is_active) VALUES($1,$2,$3)',[id,name,active]);
    const access=createPilotAccessService({pool:context.pool});
    const target=await access.upsertPrincipal({wecomUserId:'t06-query-target-'+randomUUID(),displayName:'T06 合成处理同事',roles:['HANDLER'],resolverTeamIds:[group]});
    const inactive=await access.upsertPrincipal({wecomUserId:'t06-query-inactive-'+randomUUID(),displayName:'T06 停用同事',roles:['HANDLER'],resolverTeamIds:[group]});
    await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[inactive.id]);
    await access.upsertPrincipal({wecomUserId:'t06-query-reporter-'+randomUUID(),displayName:'T06 合成报修者',roles:['REPORTER'],resolverTeamIds:[group,emptyGroup]});
    await access.upsertPrincipal({wecomUserId:'t06-query-disabled-team-'+randomUUID(),displayName:'T06 停用组同事',roles:['HANDLER'],resolverTeamIds:[disabledGroup]});
    assert.equal((await context.pool.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actor.id,group])).rowCount,0);
    const get=async(path:string,currentCookie=cookie)=>{const response=await fetch(context.origin+path,{headers:{cookie:currentCookie}});return {status:response.status,value:object(await response.json())};};
    const path='/api/tickets/'+ticket.ticket.id,before=await get(path);
    assert.equal(before.status,200);assert.equal(before.value.status,'QUEUED');assert.equal(before.value.assignee_id,null);assert.equal(before.value.resolver_team_id,'PILOT_IT');assert.equal(before.value.version,2);
    assert.equal((await get(path,outsiderCookie)).status,404);
    const eventsBefore=rows((await get(path+'/events')).value.items).map(event=>event.event_id);
    const selected=await get(path+'/assignment-targets?resolver_team_id='+group);
    assert.equal(selected.status,200,JSON.stringify(selected.value));
    await assertP2016Schema('p2_016_assignment_targets',selected.value);
    assert.equal(selected.value.resolver_team_id,group);
    const groups=rows(selected.value.resolver_teams);
    assert.deepEqual(groups.map(row=>row.team_id),['PILOT_IT',group]);
    assert.deepEqual(rows(selected.value.items),[{principal_id:target.id,display_name:target.display_name}]);
    const unselected=await get(path+'/assignment-targets');
    assert.equal(unselected.status,200);await assertP2016Schema('p2_016_assignment_targets',unselected.value);
    assert.deepEqual(unselected.value.resolver_teams,groups);assert.equal(unselected.value.resolver_team_id,null);assert.deepEqual(unselected.value.items,[],'multiple effective groups require an explicit selection');
    assert.equal((await get(path+'/assignment-targets?resolver_team_id='+group,outsiderCookie)).status,404);
    const after=await get(path);assert.equal(after.status,200);
    for(const key of ['id','status','assignee_id','resolver_team_id','version','intake_id','handling_cycle'])assert.deepEqual(after.value[key],before.value[key]);
    assert.deepEqual(rows((await get(path+'/events')).value.items).map(event=>event.event_id),eventsBefore);
  },{ticketSelfHandlingEnabled:true,...{ticketAssignmentEnabled:true}});
});
