import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {WeComOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function shot(browser:Browser){const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-600.png');await writeFile(file,pixels);return {file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};}

test('the actual H5 App card opens the original safe report through independent member OAuth and the formal read-only browser refuses another member',{timeout:240000},async()=>{
 const diagnostic=join(tmpdir(),'t25-h5-member-'+randomUUID());await mkdir(diagnostic);
 const memberA='T25_SYNTHETIC_INTERNAL_MEMBER_A',memberB='T25_SYNTHETIC_INTERNAL_MEMBER_B';
 const config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:[memberA,memberB]};
 const identityMapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'T25_H5_MAPPING_SYNTHETIC_TOKEN',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:memberA,open_userid:'T25_H5_BROWSER_OPEN_A'},{userid:memberB,open_userid:'T25_H5_BROWSER_OPEN_B'}]}))});
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context,{memberId:memberA,mappingHash:identityMapping.configHash});await source.round.runOnce();await context.runtime.stop();let app:ReturnType<typeof createYxxProfile>|undefined,fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,tab:Browser|undefined,error:unknown,cardUrl:string|null=null,sends=0;
  try{
   fixture=await createYxxBrowserFixture({pool:context.pool,createApp:({oauth,origin:publicOrigin}:{oauth:WeComOAuth;origin:string})=>{
    const actual=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:context.pool,publicOrigin,oauth,reporterMemberEntry:config,identityMapping,reporterHmacSecret:entryKey,appNotifications:{...source.appNotifications,enabled:false},yxxSelfService:{featureFlags:{YIXIAOXIU_MY_REPORTS_ENABLED:true,YIXIAOXIU_SELF_SERVICE_ENABLED:false}}});app=actual;return actual.server;
   },startApp:async server=>{assert.ok(app);await app.start();const address=server.address();assert.ok(address&&typeof address!=='string');return 'http://127.0.0.1:'+address.port;},stopApp:async()=>{await app?.stop();}});assert.ok(fixture);
   const fetchImpl:typeof fetch=async(input,init)=>{
    assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname;
    if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_H5_BROWSER_OPEN_A'}]}));
    assert.equal(path,'/cgi-bin/message/send');sends++;const body=t25Object(JSON.parse(init.body)),action=t25Object(t25Object(body.template_card).card_action);assert.ok(typeof action.url==='string');cardUrl=action.url;return new Response('{"errcode":0,"msgid":"T25_H5_BROWSER_SYNTHETIC_ACK"}');
   };
   const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:fixture.origin,allowedHosts:['127.0.0.1'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=> 'T25_H5_BROWSER_SYNTHETIC_TOKEN',fetchImpl}});
   await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.equal(sends,1);assert.ok(cardUrl);const url=new URL(cardUrl);assert.equal(url.origin,fixture.origin);assert.equal(url.pathname,'/wecom/yixiaoxiu/reports/'+source.requestRef);
   fixture.setMember('T25_H5_BROWSER_OPEN_A');tab=await fixture.launch({path:'/synthetic-start',width:600,height:900});assert.ok(tab);await tab.evaluate("location.assign('/wecom/yixiaoxiu/')",{awaitPromise:false});await tab.waitFor("document.querySelector('#home-view')?.hidden===false");
   const bootstrap=await tab.evaluate("fetch('/api/yixiaoxiu/bootstrap').then(async response=>({status:response.status,body:await response.json()}))") as {status:number;body:Record<string,unknown>};assert.equal(bootstrap.status,200);assert.equal(bootstrap.body.read_only,true);assert.equal(bootstrap.body.can_submit,false);
   await tab.evaluate('location.assign('+JSON.stringify(url.pathname)+')',{awaitPromise:false});await tab.waitFor("document.querySelector('#detail-view')?.hidden===false&&document.querySelector('#detail-status')?.textContent.includes('处理')");assert.equal(await tab.evaluate("document.querySelector('#detail-source').textContent.startsWith('网页报修')"),true);assert.equal(await tab.evaluate("document.querySelector('#detail-description').textContent.includes('T25_PRIVATE_REPORT')"),true);assert.equal(await tab.evaluate("document.querySelector('#supplement-form').hidden"),true);
   const owner=await tab.evaluate(`fetch(${JSON.stringify('/api/yixiaoxiu/requests/'+source.requestRef)}).then(async response=>({status:response.status,body:await response.json()}))`) as {status:number;body:Record<string,unknown>};assert.equal(owner.status,200);assert.equal(owner.body.request_ref,source.requestRef);assert.equal(owner.body.source_kind,'WEB_REQUEST');assert.equal(owner.body.can_supplement,false);
   for(const privateValue of [source.memberId,source.scope.scopeHash,source.authority.mappingProofRef,source.authority.channelAccountId,'INTERNAL_T11_CANARY','T25_H5_BROWSER_OPEN_A'])assert.equal(JSON.stringify(owner.body).includes(privateValue),false);assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);const positive=await shot(tab);
   await tab.evaluate("document.querySelector('#logout').click()");await tab.waitFor("document.querySelector('#logged-out-view')?.hidden===false");assert.equal(await tab.evaluate(`fetch(${JSON.stringify('/api/yixiaoxiu/requests/'+source.requestRef)}).then(response=>response.status)`),401);assert.equal(await tab.evaluate("document.querySelector('#detail-description').textContent"),'');await tab.close();assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});tab=undefined;
   fixture.setMember('T25_H5_BROWSER_OPEN_B');tab=await fixture.launch({path:'/synthetic-start',width:600,height:900});assert.ok(tab);await tab.evaluate("location.assign('/wecom/yixiaoxiu/')",{awaitPromise:false});await tab.waitFor("document.querySelector('#home-view')?.hidden===false");assert.equal(await tab.evaluate(`fetch(${JSON.stringify('/api/yixiaoxiu/requests/'+source.requestRef)}).then(response=>response.status)`),404);
   await tab.evaluate('location.assign('+JSON.stringify(url.pathname)+')',{awaitPromise:false});await tab.waitFor("document.readyState==='complete'&&!document.querySelector('#detail-view')");assert.equal(await tab.evaluate("document.body.innerText.includes('T25_PRIVATE_REPORT')"),false);const negative=await shot(tab);assert.equal(sends,1);console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_TLS_HTTP_PG',scope:'T25_ORIGINAL_H5_MEMBER_CARD',screenshots:[positive,negative]}));
  }catch(failure){error=failure;try{if(tab){await writeFile(join(diagnostic,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(diagnostic,'failure.json'),JSON.stringify(await tab.evaluate('({path:location.pathname,text:document.body.innerText})')));}}catch(observation){error=new AggregateError([failure,observation],'T25_H5_MEMBER_DIAGNOSTIC');}console.log('T25_H5_MEMBER_FAILURE '+JSON.stringify({diagnostic}));}
  await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},async()=>{await app?.stop();}],error);
 },{manualRoundConsumption:true});
});
