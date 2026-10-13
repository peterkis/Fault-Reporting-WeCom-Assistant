import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {acceptedSetup,rows,version} from './helpers/t07-public-fixture.mjs';

test('a currently authorized non-owner explicitly chooses an actual SELF group from completion targets without changing either responsibility',async()=>{
  await withT12Fixture(async f=>{
    const s=await acceptedSetup(f);
    const started=await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_TARGETS_START'});
    assert.equal(started.status,200);
    const before=await s.b.get(s.path);assert.equal(before.status,200);assert.equal(before.value.status,'IN_PROGRESS');
    const responsibility=await s.a.get(s.path+'/responsibility');assert.equal(responsibility.status,200);
    const target=await s.b.get(s.path+'/takeover-completion-targets?resolver_team_id=T07_NETWORK');
    assert.equal(target.status,200,JSON.stringify(target.value));
    assert.deepEqual(Object.keys(target.value).sort(),['allowed_actions','resolver_team_id','resolver_teams']);
    assert.equal(target.value.resolver_team_id,'T07_NETWORK');
    assert.deepEqual(target.value.allowed_actions,['takeover-and-complete']);
    assert.ok(rows(target.value.resolver_teams).some(team=>team.team_id==='T07_NETWORK'));
    assert.deepEqual((await s.b.get(s.path)).value,before.value);
    assert.deepEqual((await s.a.get(s.path+'/responsibility')).value,responsibility.value);
  });
});
