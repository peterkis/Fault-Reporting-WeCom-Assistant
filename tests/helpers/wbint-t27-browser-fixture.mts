import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import type {Server} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createP2012Runtime} from '../../src/p2-012-workbench-assembly.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './p2-012-postgres-harness.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';

export interface Browser {evaluate(expression:string):Promise<unknown>;waitFor(expression:string):Promise<unknown>;command(method:string,params?:Record<string,unknown>):Promise<unknown>;screenshot():Promise<unknown>;close():Promise<void>;ownedResourceState():{processes:number;profiles:number;commandTimers:number;sockets:number}}
export function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function text(value:unknown):string{assert.equal(typeof value,'string');if(typeof value!=='string')throw Error('T27_STRING_REQUIRED');return value;}
type Fixture=Awaited<ReturnType<typeof fixtureP2012>>;
export interface Setup {pool:PostgresPool;f:Fixture;candidateId:string}
export interface Context extends Setup {browser:Browser;root:string;origin:string;server:Server;started:Record<string,unknown>;choose:(label:string,value:string)=>Promise<void>;capture:()=>Promise<void>}
export async function candidateBrowser(options:{purpose:string;recovery?:boolean;workspace?:boolean;reporters?:number;setup?:(context:Setup)=>Promise<void>},run:(context:Context)=>Promise<void>){
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:options.purpose,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    const migrationInput={databaseUrl,mode:'apply'};await applyThrough031({pool,databaseUrl});await migrateP2012(migrationInput);
    const reporters=options.reporters??3;assert.ok(Number.isInteger(reporters)&&reporters>=3&&reporters<=100);const f=await fixtureP2012(pool,{reporters}),candidateId=text(record(await f.newCandidate()).id);await options.setup?.({pool,f,candidateId});
    const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;
    await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id),text(record(f.handler).id)],publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,
      incidentCandidateWorkspaceEnabled:options.workspace??true,workbenchDraftRecoveryEnabled:options.recovery??false,workbenchInternalNotesEnabled:false,externalSendEnabled:false});
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown;
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[],root=`article[data-candidate-id="${candidateId}"]`;
    const capture=async()=>{assert.ok(browser);const shot=await browser.screenshot();assert.equal(typeof shot,'string');if(typeof shot!=='string')throw Error('SCREENSHOT_REQUIRED');const bytes=Buffer.from(shot,'base64'),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),file=join(directory,'new-detail-'+width+'.png');await writeFile(file,bytes);screenshots.push({file,width,height,sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{
      const started=record(await runtime.start()),cookie=record(started.cookie),browserCookie={...cookie,name:text(cookie.name),value:text(cookie.value),url:text(cookie.url)};browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:1080,cookies:[browserCookie]});assert.ok(browser);
      await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');
      const bootstrap=record(await browser.evaluate('fetch("/api/lifecycle/bootstrap").then(r=>r.json())'));assert.equal(bootstrap.internal_notes_enabled,false);assert.equal(bootstrap.draft_recovery_enabled,false);assert.equal(bootstrap.logout_enabled,false);assert.equal(bootstrap.incident_candidate_draft_recovery_enabled,(options.workspace??true)&&(options.recovery??false));
      await browser.command('Page.enable');
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const send=globalThis.fetch;globalThis.__t27DomainReads=[];globalThis.__t27Posts=[];globalThis.fetch=async(path,options)=>{if(/^\\/api\\/(incident-candidates|incidents)(?:[/?]|$)/.test(String(path)))globalThis.__t27DomainReads.push(String(path));if(options?.method==='POST')globalThis.__t27Posts.push({path:String(path),body:options.body});return send(path,options);};})()"});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/incidents/candidates/'+candidateId});
      await browser.waitFor(options.workspace===false?'document.body.innerText.includes("候选工作区尚未启用")':`Boolean(document.querySelector(${JSON.stringify(root)})?.querySelector('select[aria-label="人工决定"]'))`);
      await browser.waitFor('Array.isArray(globalThis.__t27DomainReads)&&Array.isArray(globalThis.__t27Posts)');
      const activeBrowser=browser,choose=async(label:string,value:string)=>{await activeBrowser.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(root)}).querySelector(${JSON.stringify('select[aria-label="'+label+'"]')});if(!select)throw Error('MISSING_SELECT');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
      await run({pool,f,candidateId,browser,root,origin,server:runtime.server,started,choose,capture});assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture();console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:options.purpose,screenshots}));
    }catch(failure){error=failure;if(browser)try{await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));console.log('T27_FAILURE_DIRECTORY '+directory);}catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T27_EVIDENCE_FAILURE');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
  }});await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
}
