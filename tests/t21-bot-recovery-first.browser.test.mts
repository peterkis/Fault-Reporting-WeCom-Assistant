import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT21DraftFixture,t21Config,t21Mapping} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {secret} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import type {WeComOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
test('production Bot feedback keeps the original UUID after a committed response becomes 403 and restores only its current READ receipt after reload',async()=>{
 await withT21DraftFixture(async f=>{
  const mapping=await t21Mapping();let app:ReturnType<typeof createYxxProfile>|undefined,fixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,tab:Browser|undefined,error:unknown;
  const directory=join(tmpdir(),'t21-recovery-'+randomUUID());await mkdir(directory);
  try{
   fixture=await createYxxBrowserFixture({pool:f.context.pool,createApp:({oauth,origin:publicOrigin}:{oauth:WeComOAuth;origin:string})=>{
    const runtime=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,oauth,publicOrigin,reporterMemberEntry:t21Config,identityMapping:mapping,reporterHmacSecret:secret,botReporterFeedbackEnabled:true,botReporterFeedbackDraftRecoveryEnabled:true,yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},pollMilliseconds:100}});app=runtime;return runtime.server;
   }});assert.ok(fixture);fixture.setMember('open-a');tab=await fixture.launch({path:'/synthetic-start',width:390,height:844});assert.ok(tab);
   await tab.evaluate('location.assign('+JSON.stringify('/wecom/yixiaoxiu/tickets/'+f.publicRef)+')',{awaitPromise:false});
   await tab.waitFor("document.querySelector('[data-action=submit-bot-feedback]')?.disabled===false");
   await tab.evaluate(`(()=>{const send=fetch;globalThis.__t21Posts=[];globalThis.__t21Reads=[];globalThis.fetch=async(path,options)=>{const response=await send(path,options);if(options?.method==='POST'&&String(path).endsWith('/feedback')){globalThis.__t21Posts.push({path:String(path),command:JSON.parse(options.body),realStatus:response.status});return new Response(JSON.stringify({error:{code:'SYNTHETIC_POST_RESPONSE_FORBIDDEN',retryable:false}}),{status:403,headers:{'content-type':'application/json'}});}globalThis.__t21Reads.push(String(path));return response;};})()`);
   await tab.evaluate("document.querySelector('[data-action=submit-bot-feedback]').click()");
   await tab.waitFor("globalThis.__t21Posts.length===1&&!document.querySelector('[data-feedback-state]')?.textContent.includes('正在')");
   assert.equal(await tab.evaluate('globalThis.__t21Posts[0].realStatus'),200,'the original public command really committed before the response lost its authority');
   assert.equal(await tab.evaluate("Boolean(document.querySelector('[data-action=check-bot-feedback-command]'))"),true,'a later general 403 cannot erase the original operation or prove it never committed');
   const observed=await tab.evaluate('globalThis.__t21Posts[0]') as {path:string;command:{client_command_id:string}};
   assert.equal(observed.path,f.path+'/feedback');assert.match(observed.command.client_command_id,/^[a-f0-9-]{36}$/u);
   await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const send=fetch;globalThis.__t21Posts=[];globalThis.__t21Reads=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t21Posts.push(String(path));else globalThis.__t21Reads.push(String(path));return send(path,options);};})()"});
   const time=await tab.evaluate('performance.timeOrigin');await tab.command('Page.reload');await tab.waitFor('performance.timeOrigin!=='+String(time)+'&&document.readyState==="complete"');
   await tab.waitFor("document.querySelector('[data-action=check-bot-feedback-command]')?.disabled===false");
   await tab.evaluate("document.querySelector('[data-action=check-bot-feedback-command]').click()");await tab.waitFor("document.querySelector('[data-feedback-state]')?.textContent.includes('已核对')");
   assert.equal(await tab.evaluate('globalThis.__t21Posts.length'),0,'reload/receipt recovery must never post another command');
   assert.equal(await tab.evaluate('globalThis.__t21Reads.includes('+JSON.stringify(f.path+'/feedback/commands/'+observed.command.client_command_id)+')'),true);
   assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   const png=Buffer.from(await tab.screenshot(),'base64');await writeFile(join(directory,'recovered.png'),png);
   const receiptDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());await mkdir(receiptDirectory);const file=join(receiptDirectory,randomUUID()+'.png');await writeFile(file,png);
   console.log('SS010_BROWSER '+JSON.stringify({screenshots:[{file,width:png.readUInt32BE(16),height:png.readUInt32BE(20),sha256:createHash('sha256').update(png).digest('hex')}]}));
  }catch(failure){error=failure;try{await writeFile(join(directory,'error.json'),JSON.stringify({message:failure instanceof Error?failure.message:String(failure)}));if(tab)await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await fixture?.close();if(fixture)assert.deepEqual(fixture.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},async()=>{await app?.stop();}],error);
 });
});
