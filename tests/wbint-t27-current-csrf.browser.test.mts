import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

interface Browser {
  evaluate(expression:string):Promise<unknown>;
  waitFor(expression:string):Promise<unknown>;
  command(method:string,params?:Record<string,unknown>):Promise<unknown>;
  screenshot():Promise<unknown>;
  close():Promise<void>;
  ownedResourceState():{processes:number;profiles:number;commandTimers:number;sockets:number};
}
function record(value:unknown):Record<string,unknown> {
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),'expected a real returned object');
  return value as Record<string,unknown>;
}
function stringField(value:unknown,key:string):string {
  const field=record(value)[key];assert.equal(typeof field,'string');
  if(typeof field!=='string')throw Error('T27_STRING_FIELD_REQUIRED');
  return field;
}

test('T27 native START uses renewed same-principal Cookie CSRF and preserves the captured command',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t27csrf',run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:3}),candidateId=stringField(await f.newCandidate(),'id'),principalId=stringField(f.admin,'id');
    const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;
    await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port,runtimeOptions={pool,principalId,publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},
      incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,externalSendEnabled:false};
    let runtime=createP2012Runtime(runtimeOptions),browser:Browser|undefined,error:unknown;
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    const capture=async()=>{
      assert.ok(browser);const shot=await browser.screenshot();assert.equal(typeof shot,'string');
      if(typeof shot!=='string')throw Error('T27_SCREENSHOT_REQUIRED');
      const bytes=Buffer.from(shot,'base64'),file=join(directory,'csrf-current-'+bytes.readUInt32BE(16)+'.png');
      await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});
    };
    const root=`article[data-candidate-id="${candidateId}"]`;
    const choose=async(label:string,value:string)=>{
      assert.ok(browser);await browser.evaluate(`(()=>{const control=document.querySelector(${JSON.stringify(root)})?.querySelector(${JSON.stringify('select[aria-label="'+label+'"]')});if(!control)throw Error('MISSING_SELECT');control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    };
    try{
      const started=await runtime.start(),originalCookie=started.cookie;assert.ok(originalCookie);assert.ok(typeof originalCookie.url==='string');
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:1080,cookies:[{...originalCookie,url:originalCookie.url}]});assert.ok(browser);
      await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');
      const originalBootstrap=record(await browser.evaluate('fetch("/api/lifecycle/bootstrap").then(r=>r.json())'));
      assert.equal(originalBootstrap.principal_id,principalId);assert.equal(originalBootstrap.incident_candidate_workspace_enabled,true);
      const oldCsrf=stringField(originalBootstrap,'csrf_token');
      await browser.command('Page.navigate',{url:origin+'/workbench/app/incidents/candidates/'+candidateId});
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root)})?.querySelector('[data-action=refresh-candidate]'))`);
      await choose('人工决定','START_REVIEW');await choose('决定原因','OPERATOR_REVIEWED');
      const captured=await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-captured-basis]').textContent`);
      assert.equal(typeof captured,'string');assert.match(String(captured),/已捕获候选版本 1；当前候选版本 1/u);

      // Issue a real replacement session only after the first App/API has stopped.
      await runtime.stop();assert.equal(runtime.server.listening,false);runtime=createP2012Runtime(runtimeOptions);
      const renewed=await runtime.start(),currentCookie=renewed.cookie;assert.ok(currentCookie);assert.ok(typeof currentCookie.url==='string');
      assert.notEqual(currentCookie.value,originalCookie.value);await browser.command('Network.setCookies',{cookies:[currentCookie]});
      const fresh=record(await browser.evaluate('fetch("/api/lifecycle/bootstrap").then(r=>r.json())'));
      assert.equal(fresh.principal_id,principalId);const currentCsrf=stringField(fresh,'csrf_token');assert.notEqual(currentCsrf,oldCsrf);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-captured-basis]').textContent`),captured);
      await browser.evaluate(`(()=>{const send=globalThis.fetch;globalThis.__t27Posts=[];globalThis.fetch=async(path,options)=>{if(String(path)!=='/api/incident-candidates/${candidateId}/start-review'||options?.method!=='POST')return send(path,options);const row={body:JSON.parse(options.body),serializedBody:options.body,key:options.headers['idempotency-key'],match:options.headers['if-match'],freshCsrf:options.headers['x-csrf-token']===${JSON.stringify(currentCsrf)},status:null};globalThis.__t27Posts.push(row);const response=await send(path,options);row.status=response.status;return response;};})()`);
      await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-action=submit-candidate]').click()`);
      await browser.waitFor('globalThis.__t27Posts.length===1 && globalThis.__t27Posts[0].status!==null');
      const posts=await browser.evaluate('globalThis.__t27Posts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);
      const post=record(posts[0]);
      assert.equal(post.status,200,'the real replacement Cookie must submit with its current CSRF instead of the old rendered token');
      assert.equal(post.freshCsrf,true);const body=record(post.body),commandId=stringField(body,'client_command_id');
      assert.match(commandId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
      assert.deepEqual(Object.keys(body).sort(),['client_command_id','expected_row_version','reason_code']);
      assert.equal(body.expected_row_version,'1');assert.equal(body.reason_code,'OPERATOR_REVIEWED');
      assert.equal(post.match,'"1"');assert.equal(post.key,commandId);assert.equal(post.serializedBody,JSON.stringify(body));
      const cookie=currentCookie.name+'='+currentCookie.value,response=await fetch(origin+'/api/incident-candidates/'+candidateId,{headers:{cookie}});
      assert.equal(response.status,200);const current=record(await response.json());assert.equal(current.status,'UNDER_REVIEW');assert.equal(current.row_version,'2');
      assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM incident.incident')).rows[0]?.count,0);
      assert.equal(await browser.evaluate('globalThis.__t27Posts.length'),1);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await capture();console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',same_principal_renewed_csrf:true,native_start_posts:1,screenshots}));
    }catch(failure){error=failure;if(browser){try{await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));console.log('T27_FAILURE_DIRECTORY '+directory);}catch(captureFailure){error=new AggregateError([failure,captureFailure],'T27_BROWSER_EVIDENCE_FAILURE');}}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
  }});
  await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});
