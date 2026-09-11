import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeComMemberDirectory} from '../src/p2-015-wecom-member-directory.mjs';
import {configurationFixture} from './helpers/p2-g2-configuration-fixture.mjs';
import {readG2Configuration} from '../src/p2-g2-validation-config.mjs';
import {installG2NetworkBoundary} from '../src/p2-g2-network-boundary.mjs';

const input={source:'WECOM_DIRECTORY',bot_id:'synthetic-bot',reporter_external_id:'synthetic-member'};
function setup(user={}) {
  const calls=[];
  const port=createWeComMemberDirectory({enabled:true,botId:input.bot_id,memberIdsConfirmed:true,
    accessTokenProvider:async()=> 'synthetic-token',now:()=> '2026-09-09 12:00:00',
    fetchImpl:async(url,options)=>{
      calls.push({url:new URL(url),options});
      return new Response(JSON.stringify(url.pathname.endsWith('/user/get')
        ?{errcode:0,userid:input.reporter_external_id,name:'模拟成员',department:[7,8],main_department:8,status:1,...user}
        :{errcode:0,department:{id:Number(url.searchParams.get('id')),name:'模拟部门'}}));
    }});
  return {port,calls};
}
test('member directory preserves visible primary membership and missing contact permissions',async()=>{
  const {port,calls}=setup();const result=await port.resolve(input);
  assert.equal(result.status,'RESOLVED');assert.equal(result.snapshot.contact.name,'模拟成员');
  assert.equal(result.snapshot.contact.mobile,null);assert.equal(result.snapshot.contact.telephone,null);
  assert.deepEqual(result.snapshot.memberships.map(m=>m.role),['SECONDARY','PRIMARY']);
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.options.redirect==='error'&&c.options.signal));
});
test('member directory refuses disabled, unconfirmed identifiers, foreign bot, and mismatched identity',async()=>{
  assert.equal((await createWeComMemberDirectory().resolve(input)).status,'DEFERRED');
  const f=setup();assert.equal((await f.port.resolve({...input,bot_id:'foreign'})).status,'DEFERRED');assert.equal(f.calls.length,0);
  const mismatch=setup({userid:'someone-else'});assert.equal((await mismatch.port.resolve(input)).status,'DEFERRED');
  assert.equal(mismatch.calls.length,1);
  const unconfirmed=createWeComMemberDirectory({enabled:true,botId:input.bot_id,accessTokenProvider:()=>{throw new Error('must not run');}});
  assert.equal((await unconfirmed.resolve(input)).status,'DEFERRED');
});
test('member directory bounds memberships and returns supplied contact fields without inventing location',async()=>{
  const f=setup({mobile:'synthetic-mobile',telephone:'synthetic-phone',status:2});const result=await f.port.resolve(input);
  assert.equal(result.snapshot.contact.mobile,'synthetic-mobile');assert.equal(result.snapshot.account_status,'INACTIVE');
  assert.equal(Object.hasOwn(result.snapshot,'occurrence_location'),false);
  assert.equal((await setup({department:Array.from({length:21},(_,i)=>i+1)}).port.resolve(input)).status,'DEFERRED');
});
test('G2 directory configuration requires explicit internal ID confirmation and keeps missing credential optional',()=>{
  const f=configurationFixture();
  f.manifest.scope.member_directory={enabled:true,internal_member_ids_confirmed:false};
  assert.throws(()=>readG2Configuration(f));
  f.manifest.scope.member_directory.internal_member_ids_confirmed=true;
  const c=readG2Configuration(f);assert.equal(c.memberDirectoryEnabled,true);assert.equal(c.memberDirectoryAccessToken,null);
  f.env.P2_G2_DIRECTORY_ACCESS_TOKEN='synthetic-private-directory-token';
  assert.equal(readG2Configuration({...f,role:'WORKER'}).memberDirectoryAccessToken,'synthetic-private-directory-token');
  assert.equal(readG2Configuration({...f,role:'APP'}).memberDirectoryAccessToken,null);
  assert.equal(readG2Configuration({...f,role:'GATEWAY'}).memberDirectoryAccessToken,null);
});
test('G2 directory HTTP scope permits only GET for approved members and department lookup',async()=>{
  const f=configurationFixture('live');f.manifest.reporter_origin='https://synthetic.invalid';
  f.manifest.scope.member_directory={enabled:true,internal_member_ids_confirmed:true};
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response('{}');};
  const restore=installG2NetworkBoundary(f.manifest);
  try{
    const member='https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=synthetic&userid=reporter-a';
    await fetch(member);await fetch('https://qyapi.weixin.qq.com/cgi-bin/department/get?access_token=synthetic&id=7');
    await assert.rejects(fetch(member,{method:'POST'}));
    await assert.rejects(fetch(member.replace('reporter-a','foreign')));
    await assert.rejects(fetch(member.replace('/user/get','/user/delete')));
    await assert.rejects(fetch(member+'&extra=1'));assert.equal(requests,2);
  }finally{restore();globalThis.fetch=original;}
});
