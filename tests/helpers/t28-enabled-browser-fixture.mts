import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createP2012Runtime} from '../../src/p2-012-workbench-assembly.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './p2-012-postgres-harness.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {record,text} from './wbint-t27-browser-fixture.mjs';
import type {Browser,Context} from './wbint-t27-browser-fixture.mjs';

// Explicit synthetic variation for the existing runtime. The original T27 fixture stays byte-frozen.
export async function enabledIncidentBrowser(options:{purpose:string;reporters?:number;sameReporter?:boolean;recovery?:boolean;realtime?:boolean;notifications?:boolean},run:(context:Context&{runtime:P2016EnabledRuntime})=>Promise<void>){
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:options.purpose,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl,mode:'apply'});const f=await fixtureP2012(pool,{reporters:options.reporters??3,sameReporter:options.sameReporter??false}),candidateId=text(record(await f.newCandidate()).id);
    const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id),text(record(f.handler).id)],publicOrigin:origin,listenPort:port,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:options.notifications??false,INCIDENT_PRIVATE_NOTICE_ENABLED:options.notifications??false},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentTestLabel:true,workbenchDraftRecoveryEnabled:options.recovery??false,workbenchRealtimeEnabled:options.realtime??false,externalSendEnabled:false});
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown;const screenshots:{file:string;width:number;height:number;sha256:string}[]=[],root=`article[data-candidate-id="${candidateId}"]`;
    const capture=async()=>{assert.ok(browser);const shot=await browser.screenshot();assert.equal(typeof shot,'string');if(typeof shot!=='string')throw Error('SCREENSHOT_REQUIRED');const bytes=Buffer.from(shot,'base64'),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),file=join(directory,'new-detail-'+width+'.png');await writeFile(file,bytes);screenshots.push({file,width,height,sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{const started=record(await runtime.start()),cookie=record(started.cookie);browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:1080,cookies:[{...cookie,name:text(cookie.name),value:text(cookie.value),url:text(cookie.url)}]});assert.ok(browser);await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const send=fetch;globalThis.__t27DomainReads=[];globalThis.__t27Posts=[];globalThis.fetch=(path,options)=>{if(/^\\/api\\/(incident-candidates|incidents)(?:[/?]|$)/.test(String(path)))globalThis.__t27DomainReads.push(String(path));if(options?.method==='POST')globalThis.__t27Posts.push({path:String(path),body:options.body});return send(path,options);};})()"});const active=browser,choose=async(label:string,value:string)=>{await active.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(root)}).querySelector(${JSON.stringify('select[aria-label="'+label+'"]')});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);};await run({pool,f,candidateId,browser,root,origin,server:runtime.server,started,choose,capture,runtime});assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture();console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:options.purpose,synthetic_external_only:true,screenshots}));}
    catch(failure){error=failure;if(browser)try{await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));console.log('T28_FAILURE_DIRECTORY '+directory);}catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure]);}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
  }});await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
}
