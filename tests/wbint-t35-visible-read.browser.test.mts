import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IncomingMessage} from 'node:http';
import type {OAuthState} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxSelfServiceNativeHttp} from '../src/yxx-self-service-native-http.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxMemberCommandContext} from '../src/yxx-self-service-command.mjs';
import {createYxxSelfServiceSupplement} from '../src/yxx-self-service-supplement.mjs';
import {createYxxSelfServiceAuthorization} from '../src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceQuery} from '../src/yxx-self-service-query.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../scripts/yxx-self-service-migrate.mjs';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {launchSystemBrowser, closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

// SOURCE_ONLY tracer: the new read endpoint/option are PLANNED. Do not treat this
// file, its static absence, or an unexecuted assertion as an observed product RED.
interface SourcePosition {
  source_key:string; source_kind:'BOT'|'WEB'|'MANUAL'; last_read_position:string;
  latest_position:string; row_version:string; has_unread_material:boolean;
}
interface PositionPage {canonical_item:{kind:string;id:string}; sources:SourcePosition[]; next_cursor:string|null}
interface Material {source_ref:string; revision:string; text:string|null}
interface ReviewView {materials:Material[]}
interface ReadCommand {client_command_id:string; source_ref:string; revision:string}
interface ReadTrace {path:string; body:ReadCommand}
function object(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
async function json(response:Response):Promise<Record<string,unknown>>{
  assert.equal(response.status,200,await response.clone().text());
  return object(await response.json());
}
function text(value:unknown):string{assert.ok(typeof value==='string');return value;}
function positionPage(value:Record<string,unknown>):PositionPage{
  assert.ok(Array.isArray(value.sources));const canonical=object(value.canonical_item);
  const sources=value.sources.map(raw=>{const row=object(raw),kind=row.source_kind;
    assert.ok(kind==='BOT'||kind==='WEB'||kind==='MANUAL');assert.ok(typeof row.has_unread_material==='boolean');
    return {source_key:text(row.source_key),source_kind:kind,last_read_position:text(row.last_read_position),latest_position:text(row.latest_position),
      row_version:text(row.row_version),has_unread_material:row.has_unread_material};
  });
  assert.ok(value.next_cursor===null||typeof value.next_cursor==='string');
  return {canonical_item:{kind:text(canonical.kind),id:text(canonical.id)},sources,next_cursor:value.next_cursor};
}
function reviewView(value:Record<string,unknown>):ReviewView{
  assert.ok(Array.isArray(value.materials));return {materials:value.materials.map(raw=>{const row=object(raw);
    assert.ok(row.text===null||typeof row.text==='string');return {source_ref:text(row.source_ref),revision:text(row.revision),text:row.text};
  })};
}
function webPosition(value:PositionPage){
  const source=value.sources.find(item=>item.source_kind==='WEB');assert.ok(source);
  assert.match(source.source_key,/^[a-f0-9]{64}$/u);return source;
}
const visibilityAndTrace = `(()=>{
  globalThis.__t35Visibility='hidden'; globalThis.__t35ReadPosts=[];
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__t35Visibility});
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>globalThis.__t35Visibility!=='visible'});
  const original=globalThis.fetch;
  globalThis.fetch=(path,options)=>{
    if(options?.method==='POST'&&/\\/(read-position|read-cursor)$/.test(String(path)))
      globalThis.__t35ReadPosts.push({path:String(path),body:JSON.parse(options.body)});
    return original(path,options);
  };
})()`;

test('T35 actual foreground material advances only its own source and reader, never hidden prefetch or another Session', {timeout:240_000}, async()=>{
  await withT22Fixture(async f=>{
    await f.runtime.stop(); // A single App owns this port, including the real member HTTP seam below.
    await migrateP2012({databaseUrl:f.databaseUrl,mode:'apply'});
    await migrateYxxSelfService({databaseUrl:f.databaseUrl,mode:'apply'});
    const second=f.principals[1],session=f.sessions[0];assert.ok(second);assert.ok(session);
    await createPilotAccessService({pool:f.pool}).upsertPrincipal({
      wecomUserId:'web01-synthetic-1',displayName:'T35第二合成阅读者',roles:['ADMIN'],resolverTeamIds:['PILOT_IT'],
    });
    const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    const secret='t35-only-synthetic-member-secret-at-least-32';
    // Only the OAuth identity boundary is simulated; no real OAuth/Provider request.
    const oauth=createWeComWebOAuth({enabled:true,corpId:'t35-synthetic-corp',agentId:'1000035',
      publicOrigin:'https://t35-synthetic.invalid',resolveCode:async()=>({userid:'t35-synthetic-member'})});
    assert.equal(oauth.enabled,true);if(!oauth.enabled)throw Error('T35_SYNTHETIC_AUTH_REQUIRED');
    const login=oauth.begin(),state=new URL(login.location).searchParams.get('state');assert.ok(state);
    const member=await oauth.complete({state:state as OAuthState,browserToken:login.browserToken,code:'t35-synthetic-code'});
    const memberCookie='__Host-wecom_session='+member.sessionToken;
    const memberContext={profile:'FULL_SERVICE_LOOP' as const,flags,write_flag:true,csrf_token:'t35-synthetic-csrf-at-least-32-characters',
      session_generation:'t35-synthetic-generation-1',canonical_reporter_binding:createHash('sha256').update('t35-synthetic-member-binding').digest('hex'),
      source_corp_scope:'t35-synthetic-corp',source_app_scope:'1000035',proof_ref:'tests/t35-synthetic-only'};
    const authenticate=(request:IncomingMessage)=>{
      assert.equal(request.headers.cookie,memberCookie);
      assert.equal(oauth.authenticate(member.sessionToken).userid,'t35-synthetic-member');return memberContext;
    };
    const store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:secret});
    const command=createYxxMemberCommandContext({store,profile:'FULL_SERVICE_LOOP',flags,authenticate,
      recheck:Object.assign(({request}:{request:IncomingMessage})=>authenticate(request),{localOnly:true as const}),
      quota:Object.assign(async()=>true,{localOnly:true as const})});
    const authorization=createYxxSelfServiceAuthorization<IncomingMessage>({profile:'FULL_SERVICE_LOOP',flags,authenticate,
      recheck:Object.assign(authenticate,{localOnly:true as const})});
    const native=createYxxSelfServiceNativeHttp({publicOrigin:f.origin,oauth,oauthHttp:async()=>false,profile:'FULL_SERVICE_LOOP',featureFlags:flags,
      command,supplement:createYxxSelfServiceSupplement({command}),query:createYxxSelfServiceQuery({pool:f.pool,store,authorization,scopeSecret:secret}),
      authenticateMember:({request})=>authenticate(request),recoveryBindingSecret:secret});
    const options={pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),
      principalIds:[f.principals[0]?.id??'',f.outsider.id,second.id],externalSendEnabled:false,
      workbenchConversationsEnabled:true,workbenchManualReviewEnabled:true,
      // Frozen planned option; current runtime deliberately ignores it until a real RED is observed.
      workbenchPersonalReadEnabled:true,limitedRequestGuard:native.handler};
    const runtime=createP2016Runtime(options);
    const directory=join(tmpdir(),'wbint-t35-visible-read-'+randomUUID());await mkdir(directory);
    let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown;
    try{
      const started=await runtime.start(),cookies=started.cookies;assert.ok(cookies);
      const firstCookie=cookies[0],secondCookie=cookies[2];assert.ok(firstCookie);assert.ok(secondCookie);
      const get=(path:string,index=0)=>fetch(f.origin+path,{headers:{cookie:index===0?firstCookie.name+'='+firstCookie.value:secondCookie.name+'='+secondCookie.value}});
      const memberPost=(path:string,body:Record<string,unknown>)=>fetch(f.origin+path,{method:'POST',headers:{cookie:memberCookie,origin:f.origin,
        'content-type':'application/json','idempotency-key':String(body.client_command_id),'x-csrf-token':memberContext.csrf_token},body:JSON.stringify(body)});
      const initial=await memberPost('/api/yixiaoxiu/requests',{schema_version:1,client_command_id:randomUUID(),description:'T35新的网页咨询材料，需人工核对。',
        location:{text:'T35合成区域',unknown:false},service_code:null,impact_scope:'SELF',reported_department_text:null,extension:null});
      assert.equal(initial.status,202,await initial.clone().text());
      const accepted=object(await initial.json()),receipt=object(accepted.receipt);assert.equal(receipt.accepted_revision,'1');
      const requestRef=text(receipt.request_ref);
      const orchestrator=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags,
        ruleEngine:{catalog_version:'T35_SYNTHETIC_RULE_FAILURE',rule_set_version:'T35_SYNTHETIC_RULE_FAILURE',evaluate(){throw Error('T35_SYNTHETIC_UNCERTAIN_REVIEW');}}});
      await orchestrator.processOne({requestRef});
      const text='T35最新网页补充：请核对合成工作站的打印设置。';
      const supplemented=await memberPost('/api/yixiaoxiu/requests/'+requestRef+'/supplements',{schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text});
      assert.equal(supplemented.status,202,await supplemented.clone().text());assert.equal(object(object(await supplemented.json()).receipt).accepted_revision,'2');
      await orchestrator.processOne({requestRef});
      const root=(await f.pool.query<{intake_id:string}>('SELECT intake_id::text FROM intake.web_request_binding WHERE request_ref=$1',[requestRef])).rows[0];assert.ok(root);
      // Fixture discovery only; all read outcomes below are verified through public HTTP/UI.
      const page=await json(await get('/api/manual-reviews'));
      assert.ok(Array.isArray(page.items));const selected=page.items.map(object).find(item=>item.service_intake_id===root.intake_id);assert.ok(selected);
      const reviewId=text(selected.id),review=reviewView(await json(await get('/api/manual-reviews/'+reviewId)));
      // Avoid force-fitting a Session/Ticket version into the genuine Web revision.
      const latest=review.materials.find(item=>item.revision==='2'&&item.text===text),original=review.materials.find(item=>item.revision==='1');assert.ok(latest);assert.ok(original);
      const readPath='/api/workbench/items/review/'+reviewId+'/read-position';
      const itemPath='/api/workbench/items/review/'+reviewId;
      const beforeItem=await json(await get(itemPath)),beforeSession=await json(await get('/api/conversations/'+session.id));
      const beforeMember=await json(await fetch(f.origin+'/api/yixiaoxiu/requests/'+requestRef,{headers:{cookie:memberCookie}}));
      assert.equal(object(beforeSession.read_cursor).last_read_sequence,'0');
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:1000,cookies:[{...firstCookie,url:f.origin+'/'}]});assert.ok(browser);
      await browser.waitFor("document.querySelectorAll('.ticket-card').length>0");
      await browser.command('Emulation.setFocusEmulationEnabled',{enabled:true});
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:visibilityAndTrace});
      await browser.evaluate(visibilityAndTrace);
      assert.equal(await browser.evaluate(`fetch('/api/manual-reviews/${reviewId}').then(r=>r.json()).then(v=>v.materials.some(m=>m.revision==='2'&&m.text===${JSON.stringify(text)}))`),true);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-review-materials]'))"),false,'a genuine prefetch has not rendered source material');
      assert.deepEqual(await browser.evaluate('globalThis.__t35ReadPosts'),[],'GET/prefetch must never write a personal position');
      // The first expected product RED is this actual mounted HTTP contract, not a fake method or static scan.
      const a0=webPosition(positionPage(await json(await get(readPath)))),b0=webPosition(positionPage(await json(await get(readPath,1))));
      assert.equal(a0.last_read_position,'0');assert.equal(b0.last_read_position,'0');assert.equal(a0.latest_position,'2');assert.equal(a0.has_unread_material,true);
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/items/review/'+reviewId+'?detail=page'});
      await browser.waitFor(`document.querySelector('[data-review-materials]')?.textContent.includes(${JSON.stringify(text)})`);
      assert.equal(await browser.evaluate('document.visibilityState'),'hidden');
      assert.deepEqual(await browser.evaluate('globalThis.__t35ReadPosts'),[],'even opened and loaded material in a background document is unread');
      assert.equal(webPosition(positionPage(await json(await get(readPath)))).last_read_position,'0');
      // Visibility/focus are simulated only at the browser platform boundary; rendering, fetch and response remain actual.
      await browser.evaluate(`(()=>{const paragraphs=[...document.querySelectorAll('[data-review-materials] li p')],target=paragraphs.find(p=>p.textContent===${JSON.stringify(text)});if(!target)throw Error('T35_ACTUAL_BODY_REQUIRED');target.scrollIntoView({block:'center'});globalThis.__t35Visibility='visible';document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));})()`);
      await browser.waitFor(`globalThis.__t35ReadPosts.some(row=>row.path.endsWith('/read-position')&&row.body.source_ref===${JSON.stringify(latest.source_ref)}&&row.body.revision==='2')`);
      const posts=await browser.evaluate('globalThis.__t35ReadPosts') as ReadTrace[];
      assert.equal(posts.filter(row=>row.body.source_ref===latest.source_ref&&row.body.revision==='2').length,1);
      assert.equal(posts.some(row=>row.path.endsWith('/read-cursor')),false,'Web material must not advance an unrelated Conversation cursor');
      const a1=webPosition(positionPage(await json(await get(readPath)))),b1=webPosition(positionPage(await json(await get(readPath,1))));
      assert.equal(a1.last_read_position,'2');assert.equal(a1.has_unread_material,false);assert.equal(a1.source_key,a0.source_key);
      assert.deepEqual(b1,b0,'another authorized person still has their independent unread position');
      const bootstrap=await json(await get('/api/lifecycle/bootstrap'));
      const latestCommand=posts.find(row=>row.body.source_ref===latest.source_ref&&row.body.revision==='2')?.body;assert.ok(latestCommand);
      const postRead=(body:ReadCommand)=>fetch(f.origin+readPath,{method:'POST',headers:{cookie:firstCookie.name+'='+firstCookie.value,origin:f.origin,
        'content-type':'application/json','idempotency-key':body.client_command_id,'x-csrf-token':String(bootstrap.csrf_token)},body:JSON.stringify(body)});
      assert.equal((await json(await postRead(latestCommand))).replayed,true,'the actual visible command replays its original committed intent');
      const older=await json(await postRead({client_command_id:randomUUID(),source_ref:original.source_ref,revision:'1'}));
      assert.equal(older.last_read_position,'2','an older genuine loaded coordinate must not regress the newer read position');
      assert.equal(webPosition(positionPage(await json(await get(readPath)))).last_read_position,'2');
      const afterItem=await json(await get(itemPath)),afterSession=await json(await get('/api/conversations/'+session.id));
      const afterMember=await json(await fetch(f.origin+'/api/yixiaoxiu/requests/'+requestRef,{headers:{cookie:memberCookie}}));
      assert.deepEqual(afterItem.records,beforeItem.records,'reading adds no response/disposition or Ticket event');
      assert.deepEqual(afterItem.responsibility,beforeItem.responsibility,'reading does not assign either responsibility');
      assert.deepEqual(afterSession.read_cursor,beforeSession.read_cursor,'Session and Web revision axes remain independent');
      for(const field of ['input_revision','processed_revision','display_status','needs_action','supplements'])assert.deepEqual(afterMember[field],beforeMember[field],'personal read does not dispose the existing source obligation: '+field);
      const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'actual-visible-material-1280.png');await writeFile(file,bytes);
      console.log('WBINT_T35_VISIBLE_READ '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_PRODUCTION_BUNDLE',single_app:true,member_submit:true,member_supplement:true,
        read_posts:posts.length,own_position:a1.last_read_position,other_position:b1.last_read_position,session_cursor:object(afterSession.read_cursor).last_read_sequence,
        screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
    }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href,posts:globalThis.__t35ReadPosts??[]})')));}}
    await closeBrowserTestResources([
      async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
      async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);},
      async()=>oauth.close(),
    ],failure);
  });
});
