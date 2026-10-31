import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedNavigation,allowedAttachmentDownload,businessDocument,embeddedLoginDocument,recoveryTarget,connectionFailure,EMBEDDED_LOGIN_PATH,navigationFailure,loginRefreshDelay,readConfig,readContext,readReminder,readChromeAction,motionPreference} from './policy.mjs';
const origin='https://workbench.test',epoch='11111111-1111-4111-8111-111111111111';
test('full motion is the default and reduced motion requires the explicit emergency option',()=>{
 assert.equal(motionPreference([]),'no-preference');assert.equal(motionPreference(['--wecom-login=official']),'no-preference');
 assert.equal(motionPreference(['--wecom-reduced-motion']),'reduce');assert.equal(motionPreference(['--wecom-reduced-motion=false']),'no-preference');
});

test('connection recovery reconstructs only safe GET documents and excludes certificates and writes',()=>{
  const entry=origin+EMBEDDED_LOGIN_PATH;
  for(const code of [-106,-21,-105,-101,-7,-118])assert.equal(connectionFailure(code),true);
  for(const code of [-3,-200,-202,-30,403,503])assert.equal(connectionFailure(code),false);
  assert.equal(recoveryTarget(entry,origin,'GET',EMBEDDED_LOGIN_PATH),entry);
  assert.equal(recoveryTarget(origin+'/workbench/app/items/ticket/'+epoch+'?secret=x#dialog',origin,'GET',EMBEDDED_LOGIN_PATH),origin+'/workbench/app/items/ticket/'+epoch);
  assert.equal(recoveryTarget(origin+'/workbench/callback?code=synthetic&state=synthetic',origin,'GET',EMBEDDED_LOGIN_PATH),entry,'a failed callback starts a fresh login, never replaying OAuth credentials');
  assert.equal(recoveryTarget(origin+'/workbench/app/assets/private.js',origin,'GET',EMBEDDED_LOGIN_PATH),entry);
  for(const url of [origin+'/api/tickets/x','https://outside.test/workbench/desktop/embedded'])assert.equal(recoveryTarget(url,origin,'GET',EMBEDDED_LOGIN_PATH),null);
  assert.equal(recoveryTarget(entry,origin,'POST',EMBEDDED_LOGIN_PATH),null);
});
test('only a trusted desktop redirect can schedule bounded QR renewal',()=>{
  const headers={'Set-Cookie':['__Host-wecom_workbench_intent=synthetic; Secure; Max-Age=300']};
  assert.equal(loginRefreshDelay(origin+'/workbench/desktop',origin,302,headers),240000);
  assert.equal(loginRefreshDelay(origin+'/workbench/desktop/embedded',origin,200,headers),240000);
  assert.equal(loginRefreshDelay(origin+'/workbench/desktop/embedded',origin,302,headers),null);
  assert.equal(loginRefreshDelay(origin+'/workbench/desktop/embedded?mode=x',origin,200,headers),null);
  assert.equal(loginRefreshDelay('https://outside.test/workbench/desktop/embedded',origin,200,headers),null);
  assert.equal(embeddedLoginDocument(origin+'/workbench/desktop/embedded',origin),true);
  assert.equal(businessDocument(origin+'/workbench/desktop/embedded',origin),false,'anonymous login never receives the business bridge');
  for(const url of ['https://outside.test/workbench/desktop',origin+'/workbench/app/',origin+'/workbench/desktop?return_to=x'])assert.equal(loginRefreshDelay(url,origin,302,headers),null);
  for(const status of [200,303,400,403,503])assert.equal(loginRefreshDelay(origin+'/workbench/desktop',origin,status,headers),null);
  for(const value of ['', '0','301','Infinity','-1','1.5'])assert.equal(loginRefreshDelay(origin+'/workbench/desktop',origin,302,{'set-cookie':['__Host-wecom_workbench_intent=synthetic; Max-Age='+value]}),null);
  assert.equal(loginRefreshDelay(origin+'/workbench/desktop',origin,302,{'set-cookie':['__Host-wecom_workbench_intent=x; Max-Age=300','__Host-wecom_workbench_intent=y; Max-Age=300']}),null);
  assert.equal(loginRefreshDelay(origin+'/workbench/desktop',origin,302,{'set-cookie':['__Host-wecom_workbench_intent=x; Max-Age=300; Max-Age=300']}),null);
});

test('only bounded same-origin attachment Blobs can open a native save dialog',()=>{
 const file={url:'blob:'+origin+'/'+epoch,filename:'report-attachment.png',mime:'image/png',bytes:1024};assert.equal(allowedAttachmentDownload(file,origin),true);
 assert.equal(allowedAttachmentDownload({...file,filename:'report-material.mp4',mime:'video/mp4',bytes:20*1024*1024},origin),true);
 for(const change of [{url:origin+'/api/attachments/'+epoch},{url:'blob:https://other.test/'+epoch},{url:'blob:null/'+epoch},{url:file.url+'?x=1'},{filename:'../report-attachment.png'},{filename:'arbitrary.exe'},{mime:'text/html'},{bytes:0},{bytes:10*1024*1024+1}])assert.equal(allowedAttachmentDownload({...file,...change},origin),false);
});
test('trusted titlebar exposes only fixed window and connection actions',()=>{
  for(const action of ['menu','minimize','maximize','close','reconnect'])assert.equal(readChromeAction(action),action);
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
  assert.equal(allowedNavigation('https://login.work.weixin.qq.com/wwlogin/sso/login/',origin),true,'the vendor canonical trailing slash remains eligible for scheduled QR renewal');
  assert.equal(allowedNavigation('https://login.work.weixin.qq.com/wwlogin/sso/login/other',origin),false);
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
