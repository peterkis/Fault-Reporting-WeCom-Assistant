import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedNavigation,businessDocument,navigationFailure,readConfig,readContext,readReminder,readChromeAction} from './policy.mjs';
const origin='https://workbench.test',epoch='11111111-1111-4111-8111-111111111111';
test('trusted titlebar exposes only its four fixed window actions',()=>{
  for(const action of ['menu','minimize','maximize','close'])assert.equal(readChromeAction(action),action);
  for(const input of [['close'],{action:'close'},'quit','openExternal',null,0])assert.throws(()=>readChromeAction(input));
});
test('main-frame HTTP errors have fixed safe presentation and never include response bodies',()=>{
  assert.equal(navigationFailure(origin+'/workbench/desktop',origin,404),'server');
  assert.equal(navigationFailure(origin+'/workbench/callback?code=private&state=private',origin,403),'access');
  assert.equal(navigationFailure(origin+'/workbench/desktop',origin,503),'service');
  assert.equal(navigationFailure(origin+'/workbench/app/items/missing',origin,404),'page');
  for(const status of [200,302,-1])assert.equal(navigationFailure(origin+'/workbench/desktop',origin,status),null);
  assert.equal(navigationFailure('https://outside.invalid/workbench/desktop',origin,404),null);
});
test('desktop admits one HTTPS origin and only the QR login navigation',()=>{
  assert.equal(readConfig({schemaVersion:1,serverOrigin:origin}).serverOrigin,origin);
  for(const serverOrigin of ['http://workbench.test',origin+'/',origin+'?a=1','https://user@workbench.test','https://workbench.example.invalid'])assert.throws(()=>readConfig({schemaVersion:1,serverOrigin}));
  assert.throws(()=>readConfig({schemaVersion:1,serverOrigin:origin,token:'no'}));
  assert.equal(allowedNavigation(origin+'/workbench/desktop',origin),true);
  assert.equal(allowedNavigation('https://login.work.weixin.qq.com/wwlogin/sso/login?state=one',origin),true);
  for(const url of [origin+'.evil/workbench/app/','javascript:alert(1)','file:///C:/secret','https://login.work.weixin.qq.com/other',origin+'/wecom/yixiaoxiu/'])assert.equal(allowedNavigation(url,origin),false);
  assert.equal(businessDocument(origin+'/workbench/app/items/ticket/x',origin),true);
  assert.equal(businessDocument(origin+'/workbench/callback?code=x',origin),false);
});
test('IPC accepts opaque bounded reminders, never raw message contents or identities',()=>{
  assert.deepEqual(readContext({epoch,blocked:false,live:true,remindersAvailable:true}),{epoch,blocked:false,live:true,remindersAvailable:true});
  assert.throws(()=>readContext({epoch:null,blocked:false,live:true,remindersAvailable:true}));
  assert.throws(()=>readContext({epoch,blocked:false,live:true}));
  assert.throws(()=>readContext({epoch,blocked:false,live:true,remindersAvailable:true,principal:'someone'}));
  const reminder={epoch,id:'a'.repeat(64),kind:'ticket' as const,itemId:epoch};
  assert.deepEqual(readReminder(reminder),reminder);
  for(const invalid of [{...reminder,body:'private'},{...reminder,kind:'url'},{...reminder,kind:['ticket']},{...reminder,itemId:'https://evil.test'},{...reminder,id:'a'.repeat(65)}])assert.throws(()=>readReminder(invalid));
});
