// SOURCE registered PC successor: NOT_COMPILED / NOT_RUN; frozen D draft preserved.
// Intended future path: tests/t21-bot-feedback-pc-happy.browser.test.mts.
// This successor cannot replace or change the original e971 HTTP first.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createP2016ReporterAccess} from '../src/p2-016-reporter-access.mjs';
import {textHashP2016,transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import type {WeComOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {config,secret} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Wire{path:string;method:string;status:number;body:unknown;response_keys:string[];body_error:boolean;command:unknown;headers:{idempotency_key:string|null;if_match:string|null;csrf_present:boolean}}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function records(value:unknown):Wire[]{
  assert.ok(Array.isArray(value));
  return value.map((item:unknown)=>{
    const row=object(item),path=row.path,method=row.method,status=row.status,keys=row.response_keys,bodyError=row.body_error,headers=object(row.headers);
    assert.ok(typeof path==='string'&&typeof method==='string'&&typeof status==='number'&&typeof bodyError==='boolean');
    assert.ok(Array.isArray(keys)&&keys.every((key:unknown)=>typeof key==='string'));
    const idempotency=headers.idempotency_key,ifMatch=headers.if_match,csrf=headers.csrf_present;
    assert.ok(idempotency===null||typeof idempotency==='string');assert.ok(ifMatch===null||typeof ifMatch==='string');assert.ok(typeof csrf==='boolean');
    return {path,method,status,body:row.body,response_keys:keys.map((key:unknown)=>String(key)),body_error:bodyError,command:row.command,headers:{idempotency_key:idempotency,if_match:ifMatch,csrf_present:csrf}};
  });
}
function errorFacts(value:unknown):unknown{return value instanceof Error?{name:value.name,message:value.message,stack:value.stack,...(value instanceof AggregateError?{errors:value.errors.map(errorFacts)}:{})}:value===null?null:String(value);}
const feedbackControl="[...document.querySelectorAll('button')].find(button=>!button.hidden&&button.getClientRects().length>0&&getComputedStyle(button).visibility!=='hidden'&&button.textContent?.includes('仍未解决'))";
// Observe only real same-origin responses. Never substitute a response, set a
// business value or synthesize a DOM control. CSRF/Cookie values are not stored.
const observe=`(()=>{const send=globalThis.fetch;globalThis.__t21Wire=[];globalThis.fetch=async(input,options)=>{
 const response=await send(input,options),path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
 if(path.startsWith('/api/reporter/')){let body=null,body_error=false,response_keys=[];
  try{body=await response.clone().json();response_keys=Object.keys(body);if(path==='/api/reporter/feedback/bootstrap')body={schema_version:body.schema_version,write_enabled:body.write_enabled,csrf_token_shape:typeof body.csrf_token==='string'&&/^[a-f0-9]{64}$/.test(body.csrf_token)};}catch{body_error=response.status!==304;}
  const headers=new Headers(options?.headers),method=options?.method??'GET';let command=null;
  if(method==='POST'&&path.endsWith('/feedback')){try{command=JSON.parse(options.body);}catch{body_error=true;}}
  globalThis.__t21Wire.push({path,method,status:response.status,body,response_keys,body_error,command,headers:{idempotency_key:headers.get('idempotency-key'),if_match:headers.get('if-match'),csrf_present:/^[a-f0-9]{64}$/.test(headers.get('x-csrf-token')??'')}});
 }return response;};})()`;

test('staged production Bot Reporter PC explicitly reopens its own completed Ticket and reloads the actual new round',async()=>{
  // Future registration must use the existing STAGED_RUNTIME route and an owned
  // D tmp/profile/evidence root. No source-module or source-asset fallback.
  assert.match(fileURLToPath(import.meta.url).replaceAll('\\','/'),/\/\.build\/runtime\/tests\/t21-bot-feedback-pc-happy\.browser\.test\.mjs$/u);
  assert.match(resolve(tmpdir()),/^D:[\\/]/iu);
  await withT11Fixture(async context=>{
    const source=await seedPersistedIntake({pool:context.pool,text:'合成门诊打印机无法打印处方。',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
    const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:source.intakeId,occurredAt:source.receivedAt,traceId:'t21-pc-bot-source'});
    assert.ok(created.ticket);
    const ticket=created.ticket;
    const access=createP2016ReporterAccess({pool:context.pool,enabled:true,hmacSecret:secret});
    const original=await transactionP2016(context.pool,transaction=>access.ensurePublicRefInTransaction({transaction,ticketId:ticket.id,reporterBindingHash:textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','user-test']))}));
    const staff=await t11Http(context),active=await staff.start(ticket.id),completion=await staff.post(ticket.id,'complete',staff.command(active));
    assert.equal(completion.status,200,await completion.text());
    const completed=await staff.detail(ticket.id);assert.equal(completed.status,'CLOSED');assert.ok(completed.handling_cycle?.staff_completion_event_id);
    const completedCycle=completed.handling_cycle;assert.ok(completedCycle);
    await context.runtime.stop();assert.equal(context.runtime.server.listening,false);
    const botConfig={...config,reporterUserIds:['user-test','other-user-test']};
    const identityMapping=await createYxxDelegatedIdentityMapping({config:botConfig,accessTokenProvider:async()=> 'synthetic-t21-pc-only',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'user-test',open_userid:'open-a'},{userid:'other-user-test',open_userid:'open-b'}]}))});
    const featureFlags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    const memberApp=(oauth:WeComOAuth,publicOrigin:string)=>createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:context.pool,oauth,publicOrigin,reporterMemberEntry:botConfig,identityMapping,reporterHmacSecret:secret,botReporterFeedbackEnabled:true,yxxSelfService:{featureFlags,pollMilliseconds:100}});
    const pagePath='/wecom/yixiaoxiu/tickets/'+original.public_ref,detailPath='/api/reporter/tickets/'+original.public_ref;
    const directory=join(tmpdir(),'t21-bot-feedback-pc-'+randomUUID());await mkdir(directory);
    let fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,tab:Browser|undefined,app:ReturnType<typeof memberApp>|undefined,error:unknown;
    const screenshots:{path:string;sha256:string}[]=[];
    try{
      fixture=await createYxxBrowserFixture({pool:context.pool,createApp:({oauth,origin:publicOrigin}:{oauth:WeComOAuth;origin:string})=>{
        const runtime=memberApp(oauth,publicOrigin);
        app=runtime;return runtime.server;
      }});
      assert.ok(fixture);
      fixture.setMember('open-a');tab=await fixture.launch({path:'/synthetic-start',width:1440,height:900});assert.ok(tab);
      await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:observe});
      // Real OAuth/state/Cookie middleware and official mapping Stub; no Cookie
      // insertion, Grant, fixed historical App ownership, fabricated Delivery.
      await tab.evaluate('location.assign('+JSON.stringify(pagePath)+')',{awaitPromise:false});
      await tab.waitFor("document.querySelector('#ticket')?.hidden===false&&document.querySelector('#state')?.textContent==='已关闭'");
      const firstWire=records(await tab.evaluate('globalThis.__t21Wire')),detail=firstWire.find(row=>row.path===detailPath&&row.method==='GET'&&row.status===200);
      assert.ok(detail,'the production page must obtain its own actual Bot detail');
      const detailBody=object(detail.body),eligibility=object(detailBody.feedback_context);
      assert.equal(detailBody.public_ref,original.public_ref);assert.equal(detailBody.ticket_no,completed.ticket_no);assert.equal(detailBody.version,completed.version);
      assert.equal(eligibility.can_feedback,true);assert.equal(eligibility.completed_round_no,completedCycle.cycle_no);assert.equal(eligibility.ticket_version,completed.version);
      assert.ok(fixture.providerCalls>0,'the actual browser must pass local OAuth code resolution');
      // Reporter.js is a legacy static resource staged by the real build, not a
      // Vite/TS-transformed frontend today. Test/server execute compiled runtime.
      assert.equal(await tab.evaluate("Boolean(document.querySelector('script[type=module][src=\"/reporter/reporter.js\"]'))"),true);
      const servedScript=await tab.evaluate("fetch('/reporter/reporter.js').then(async response=>({status:response.status,text:await response.text()}))");
      const asset=object(servedScript);assert.equal(asset.status,200);assert.equal(typeof asset.text,'string');
      const stagedAsset=await readFile(new URL('../web/p2-reporter/reporter.js',import.meta.url),'utf8');assert.equal(asset.text,stagedAsset,'browser executes the same staged production asset');
      const capture=async(name:string)=>{assert.ok(tab);const bytes=Buffer.from(await tab.screenshot(),'base64'),path=join(directory,name);await writeFile(path,bytes);screenshots.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});const receiptDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());await mkdir(receiptDirectory);const file=join(receiptDirectory,randomUUID()+'.png');await writeFile(file,bytes);console.log('SS010_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));};
      await capture('closed-own-ticket-1440.png');
      // Future actual RED: current 8cc production DOM has only refresh/more/logout,
      // never an unresolved-feedback control. Do not call POST from the test.
      assert.equal(await tab.evaluate('Boolean('+feedbackControl+')'),true,'the production Bot owner page must offer explicit same-fault unresolved feedback');
      await tab.waitFor('Boolean('+feedbackControl+')&&('+feedbackControl+').disabled===false');
      const bootstrap=records(await tab.evaluate('globalThis.__t21Wire')).find(row=>row.path==='/api/reporter/feedback/bootstrap'&&row.method==='GET'&&row.status===200);
      assert.ok(bootstrap,'the production control must obtain real Bot feedback bootstrap');assert.deepEqual(bootstrap.response_keys.sort(),['csrf_token','schema_version','write_enabled']);
      assert.deepEqual(bootstrap.body,{schema_version:1,write_enabled:true,csrf_token_shape:true});
      await tab.evaluate('('+feedbackControl+').click()');
      await tab.waitFor('globalThis.__t21Wire.some(row=>row.method==="POST"&&row.path==='+JSON.stringify(detailPath+'/feedback')+'&&row.status===200)');
      await tab.waitFor("document.querySelector('#state')?.textContent==='重新处理中'");
      const wire=records(await tab.evaluate('globalThis.__t21Wire')),posts=wire.filter(row=>row.method==='POST'&&row.path.endsWith('/feedback'));
      assert.equal(posts.length,1);assert.ok(posts[0]);const post=posts[0],command=object(post.command),result=object(post.body);
      assert.equal(post.path,detailPath+'/feedback');assert.deepEqual(Object.keys(command).sort(),['client_command_id','completed_round_ref','expected_ticket_version','feedback','schema_version']);
      assert.equal(command.schema_version,1);assert.equal(command.feedback,'STILL_UNRESOLVED');assert.equal(command.expected_ticket_version,completed.version);assert.equal(command.completed_round_ref,eligibility.completed_round_ref);
      assert.equal(typeof command.client_command_id,'string');assert.match(String(command.client_command_id),/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
      assert.equal(post.headers.idempotency_key,command.client_command_id);assert.equal(post.headers.if_match,'"'+completed.version+'"');assert.equal(post.headers.csrf_present,true);
      assert.deepEqual(result,{ok:true,replayed:false,public_ref:original.public_ref,completed_round_ref:command.completed_round_ref,reopened_round_no:completedCycle.cycle_no+1,ticket:{ticket_no:completed.ticket_no,status:'REOPENED',version:completed.version+1}});
      assert.doesNotMatch(JSON.stringify(result),/INTERNAL_T11_CANARY|user-test|bot-test|request_ref|source_intake_id|completed_by/u);
      // Independent public GET verification with the actual browser Cookie; this
      // does not require a success-200 UI to invent an automatic ACK operation.
      const ackPath=detailPath+'/feedback/commands/'+command.client_command_id;
      const ack=object(await tab.evaluate('fetch('+JSON.stringify(ackPath)+',{credentials:"same-origin",cache:"no-store"}).then(async response=>({status:response.status,body:await response.json()}))'));
      assert.equal(ack.status,200);assert.deepEqual(ack.body,{client_command_id:command.client_command_id,public_ref:original.public_ref,state:'COMMITTED',result:{...result,replayed:true}});
      await capture('same-ticket-reopened-1440.png');
      const previousTime=await tab.evaluate('performance.timeOrigin');await tab.command('Page.reload');await tab.waitFor('performance.timeOrigin!=='+String(previousTime)+'&&document.readyState==="complete"');
      await tab.waitFor("document.querySelector('#ticket')?.hidden===false&&document.querySelector('#state')?.textContent==='重新处理中'");
      const after=records(await tab.evaluate('globalThis.__t21Wire')),fresh=after.find(row=>row.method==='GET'&&row.path===detailPath&&row.status===200);assert.ok(fresh);
      const freshBody=object(fresh.body);assert.equal(freshBody.public_ref,original.public_ref);assert.equal(freshBody.ticket_no,completed.ticket_no);assert.equal(freshBody.version,completed.version+1);assert.equal(object(freshBody.feedback_context).can_feedback,false);
      assert.equal(after.some(row=>row.method==='POST'&&row.path.endsWith('/feedback')),false,'reload cannot manufacture another feedback command');
      assert.equal(await tab.evaluate('Boolean('+feedbackControl+')&&('+feedbackControl+').disabled===false'),false);
      assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture('reload-new-round-1440.png');
      await writeFile(join(directory,'public-wire.json'),JSON.stringify({beforeReload:wire,ack,afterReload:after}));
      console.log('T21_BOT_PC_HAPPY '+JSON.stringify({directory,staged_runtime:true,production_asset_sha256:createHash('sha256').update(stagedAsset).digest('hex'),real_http_pg:true,simulated_oauth:true,provider_stub_calls:fixture.providerCalls,external_calls:0,screenshots}));
    }catch(failure){
      error=failure;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(failure)));
      if(tab)try{await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure-dom-and-wire.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,path:location.pathname,wire:globalThis.__t21Wire??[]})')));}catch(observation){error=new AggregateError([failure,observation],'T21_PC_FAILURE_OBSERVATION_FAILED');await writeFile(join(directory,'observer-error.json'),JSON.stringify(errorFacts(observation)));}
    }catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    try{
      await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},async()=>{await app?.stop();}],error);
      await writeFile(join(directory,'terminal-resources.json'),JSON.stringify({browser:tab?.ownedResourceState()??null,fixture:fixture?.ownedResourceState()??null,member_listening:app?.server.listening??false,staff_listening:context.runtime.server.listening}));
    }catch(failure){await writeFile(join(directory,'terminal-error-and-cleanup.json'),JSON.stringify({primary:errorFacts(error??null),terminal:errorFacts(failure),browser:tab?.ownedResourceState()??null,fixture:fixture?.ownedResourceState()??null}));console.error('T21_BOT_PC_FAILURE_POINTER '+directory);throw failure;}
  });
});
