// Issue 179: HTTP successor of the retired V1-fixture browser case. The actual card
// URL, independent member OAuth, read-only App profile, safe owner projection, logout
// and refusal of another member are asserted on the real HTTP/PG host; the shell is a
// test stub that carries no member data, exactly like the compiled H5 shell.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig,entryKey,entryOrigin,httpBrowser,loginYxx} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createH5ShellStub,H5_SHELL_MARKER} from './helpers/h5-shell-stub.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {createYxxDelegatedIdentityMapping} from '../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createP2016WeComSender} from '../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';

test('the original App card opens the original safe report through independent member OAuth on the formal read-only profile and refuses another member',{timeout:240000},async()=>{
 const memberA='T25_SYNTHETIC_INTERNAL_MEMBER_A',memberB='T25_SYNTHETIC_INTERNAL_MEMBER_B',openA='T25_H5_HTTP_OPEN_A',openB='T25_H5_HTTP_OPEN_B';
 const config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:[memberA,memberB]};
 const identityMapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'T25_H5_MAPPING_SYNTHETIC_TOKEN',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:memberA,open_userid:openA},{userid:memberB,open_userid:openB}]}))});
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context,{memberId:memberA,mappingHash:identityMapping.configHash});await source.round.runOnce();await context.runtime.stop();
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:config.corpId,agentId:config.agentId,resolveCode:async code=>({userid:code.startsWith('b-')?openB:openA})});
  const app=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:context.pool,publicOrigin:entryOrigin,oauth,h5Presentation:createH5ShellStub(),reporterMemberEntry:config,identityMapping,reporterHmacSecret:entryKey,appNotifications:{...source.appNotifications,enabled:false},yxxSelfService:{featureFlags:{YIXIAOXIU_MY_REPORTS_ENABLED:true,YIXIAOXIU_SELF_SERVICE_ENABLED:false}}});
  const {port}=await app.start();
  try{
   const base='http://127.0.0.1:'+port;let cardUrl:string|null=null,sends=0;
   const fetchImpl:typeof fetch=async(input,init)=>{
    assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname;
    if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:openA}]}));
    assert.equal(path,'/cgi-bin/message/send');sends++;const body=t25Object(JSON.parse(init.body)),action=t25Object(t25Object(body.template_card).card_action);assert.ok(typeof action.url==='string');cardUrl=action.url;return new Response('{"errcode":0,"msgid":"T25_H5_HTTP_SYNTHETIC_ACK"}');
   };
   const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:entryOrigin,allowedHosts:[new URL(entryOrigin).host],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=> 'T25_H5_HTTP_SYNTHETIC_TOKEN',fetchImpl}});
   const delivery=await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.equal(sends,1,JSON.stringify(delivery));assert.ok(cardUrl);
   const url=new URL(cardUrl);assert.equal(url.origin,entryOrigin);assert.equal(url.pathname,'/wecom/yixiaoxiu/reports/'+source.requestRef);
   const detailPath='/api/yixiaoxiu/requests/'+source.requestRef;

   const anonymous=httpBrowser(base);assert.equal((await anonymous.request(detailPath)).status,401);
   const owner=httpBrowser(base);await loginYxx(owner,{path:url.pathname,code:'a-first'});
   const bootstrapResponse=await owner.request('/api/yixiaoxiu/bootstrap'),bootstrap=t25Object(await bootstrapResponse.json());assert.equal(bootstrapResponse.status,200);assert.equal(bootstrap.read_only,true);assert.equal(bootstrap.can_submit,false);
   const page=await owner.request(url.pathname);assert.equal(page.status,200,'the card page passes the actual ownership gate before the shell');assert.match(await page.text(),new RegExp(H5_SHELL_MARKER,'u'));
   const ownerResponse=await owner.request(detailPath),ownerText=await ownerResponse.text(),detail=t25Object(JSON.parse(ownerText));
   assert.equal(ownerResponse.status,200);assert.equal(detail.request_ref,source.requestRef);assert.equal(detail.source_kind,'WEB_REQUEST');assert.equal(detail.can_supplement,false);assert.ok(ownerText.includes('T25_PRIVATE_REPORT'),'the original member reads its own report');
   for(const privateValue of [source.memberId,source.scope.scopeHash,source.authority.mappingProofRef,source.authority.channelAccountId,'INTERNAL_T11_CANARY',openA])assert.equal(ownerText.includes(privateValue),false);
   assert.equal((await owner.request('/wecom/yixiaoxiu/logout',{method:'POST',headers:{origin:entryOrigin,'content-type':'application/json'},body:'{}'})).status,200);
   assert.equal((await owner.request(detailPath)).status,401,'logout revokes the actual member session');

   const other=httpBrowser(base);await loginYxx(other,{path:url.pathname,code:'b-first'});
   assert.equal((await other.request(detailPath)).status,404);
   const refused=await other.request(url.pathname),refusedText=await refused.text();assert.equal(refused.status,404,'another member is refused before any shell is rendered');
   assert.doesNotMatch(refusedText,new RegExp(H5_SHELL_MARKER+'|T25_PRIVATE_REPORT','u'));
   assert.equal(sends,1);
  }finally{await app.stop();assert.equal(app.server.listening,false);}
 },{manualRoundConsumption:true});
});
