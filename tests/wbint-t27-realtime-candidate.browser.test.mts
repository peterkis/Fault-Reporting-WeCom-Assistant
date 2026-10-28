import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createP2012Runtime} from '../app/server/src/p2-012-workbench-assembly.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {migrateP2012} from '../app/server/scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

interface Browser {
  evaluate(expression:string):Promise<unknown>;waitFor(expression:string):Promise<unknown>;
  command(method:string,params?:Record<string,unknown>):Promise<unknown>;screenshot():Promise<unknown>;
  close():Promise<void>;ownedResourceState():{processes:number;profiles:number;commandTimers:number;sockets:number};
}
function record(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');if(typeof value!=='string')throw Error('T27_STRING_REQUIRED');return value;}

test('T27 one production stream refreshes candidate list/detail/result without retargeting input and fences a late authorized GET after scope loss',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t27rtui',run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
    const migrationInput={databaseUrl,mode:'apply'};await applyThrough031({pool,databaseUrl});await migrateP2012(migrationInput);
    const f=await fixtureP2012(pool,{reporters:3}),candidateId=text(record(await f.newCandidate()).id),otherId=text(record(await f.newCandidate(1)).id);
    const admin=record(f.admin),handlerId=text(record(f.handler).id),report=record(f.reports[0]);
    const personal=(await pool.query('SELECT id::text,status,version FROM pilot_ticket.ticket ORDER BY id')).rows;
    const ticketEvents=(await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows[0]?.count;
    const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;
    await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalId:text(admin.id),publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,
      incidentCandidateWorkspaceEnabled:true,workbenchRealtimeEnabled:true,externalSendEnabled:false});
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    let browser:Browser|undefined,error:unknown,stage='real fixture/bootstrap',holdNext=false,release:(()=>void)|undefined;
    const reads=new Map<string,number>();let posts=0,heldStatus:number|undefined;
    const observe=(request:IncomingMessage,response:ServerResponse)=>{
      const path=request.url??'';if(request.method==='POST')posts++;
      if(request.method!=='GET')return;reads.set(path,(reads.get(path)??0)+1);
      if(path!=='/api/incident-candidates/'+otherId)return;
      const end=response.end;response.end=(...args:unknown[])=>{
        if(holdNext&&response.statusCode===200){holdNext=false;heldStatus=response.statusCode;release=()=>{Reflect.apply(end,response,args);};return response;}
        Reflect.apply(end,response,args);return response;
      };
    };runtime.server.on('request',observe);
    const root=(id:string)=>`article[data-candidate-id="${id}"]`;
    const choose=async(id:string,label:string,value:string)=>{assert.ok(browser);await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(root(id))})?.querySelector(${JSON.stringify('.workbench-select[data-field-label="'+label+'"] select')});if(!input)throw Error('MISSING_SELECT');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
    const navigate=async(path:string)=>{assert.ok(browser);await browser.command('Page.navigate',{url:origin+'/workbench/app/'+path});};
    try{
      const started=await runtime.start(),cookie=started.cookie;assert.ok(cookie);assert.ok(typeof cookie.url==='string');
      const cookieHeader=cookie.name+'='+cookie.value;
      const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie:cookieHeader}});const body:unknown=await response.json();return {status:response.status,body};};
      const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(record(bootstrap.body).csrf_token);
      const post=async(path:string,body:Record<string,unknown>)=>{
        const version=text(body.expected_candidate_version??body.expected_row_version),id=text(body.client_command_id);
        const response=await fetch(origin+path,{method:'POST',headers:{cookie:cookieHeader,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id,'if-match':'"'+version+'"'},body:JSON.stringify(body)});
        const result=record(await response.json());assert.equal(response.status,200);assert.equal(result.ok,true);return result;
      };
      browser=await launchSystemBrowser({url:origin+'/workbench/app/incidents/candidates',width:900,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await browser.waitFor(`Boolean(document.querySelector('[data-candidate-id="${candidateId}"]'))&&Boolean(document.querySelector('[data-candidate-id="${otherId}"]'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'`);
      assert.equal((await runtime.observability.metrics()).sse_clients,1);

      stage='candidate list receives a committed real SSE hint';const listReads=reads.get('/api/incident-candidates?state=CANDIDATE&limit=30')??0;
      await post('/api/incident-candidates/'+otherId+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
      await browser.waitFor(`!document.querySelector('[data-candidate-id="${otherId}"]')&&Boolean(document.querySelector('[data-candidate-id="${candidateId}"]'))`);
      assert.ok((reads.get('/api/incident-candidates?state=CANDIDATE&limit=30')??0)>listReads,'the candidate list must GET current facts instead of injecting an SSE payload');

      stage='candidate detail refresh preserves the explicit captured input';await navigate('incidents/candidates/'+candidateId);
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root(candidateId))})?.querySelector('.workbench-select[data-field-label="人工决定"] select'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'`);
      await choose(candidateId,'人工决定','START_REVIEW');await choose(candidateId,'决定原因','OPERATOR_REVIEWED');
      const captured=await browser.evaluate(`document.querySelector(${JSON.stringify(root(candidateId))}).querySelector('[data-captured-basis]').textContent`);
      assert.match(text(captured),/已捕获候选版本 1；当前候选版本 1/u);const detailReads=reads.get('/api/incident-candidates/'+candidateId)??0;
      await post('/api/incident-candidates/'+candidateId+'/start-review',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
      await browser.waitFor(`document.querySelector(${JSON.stringify(root(candidateId))})?.querySelector('[data-captured-basis]')?.textContent.includes('已捕获候选版本 1；当前候选版本 2')`);
      assert.ok((reads.get('/api/incident-candidates/'+candidateId)??0)>detailReads);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root(candidateId))}).querySelector('.workbench-select[data-field-label="人工决定"] select').value`),'START_REVIEW');
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root(candidateId))}).querySelector('.workbench-select[data-field-label="决定原因"] select').value`),'OPERATOR_REVIEWED');
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root(candidateId))}).querySelector('[data-action=submit-candidate]').disabled`),true);
      assert.equal(posts,2,'a refresh cannot submit the preserved human input');
      await browser.evaluate(`document.querySelector(${JSON.stringify(root(candidateId))}).querySelector('[data-action=clear-candidate-input]').click()`);
      const current=await get('/api/incident-candidates/'+candidateId);assert.equal(current.status,200);
      const confirmation=await post('/api/incident-candidates/'+candidateId+'/confirm',{client_command_id:randomUUID(),expected_candidate_version:'2',expected_material_basis:text(record(current.body).material_basis),reason_code:'CONFIRMED_SHARED_FAULT',confirmed_scope:'LOCAL',owner_principal_id:handlerId,owner_team_id:'PILOT_IT',selected_report_refs:[text(report.decisionId)],primary_ticket_id:null});
      const incidentId=text(confirmation.result_ref_id);assert.equal(confirmation.result_ref_type,'INCIDENT');

      stage='independent Incident result refreshes from its current GET';await navigate('incidents/'+incidentId);
      await browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'`);
      const resultReads=reads.get('/api/incidents/'+incidentId)??0;
      await post('/api/incidents/'+incidentId+'/start-investigating',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
      await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"]')?.textContent.includes('INVESTIGATING')`);
      assert.ok((reads.get('/api/incidents/'+incidentId)??0)>resultReads);assert.equal((await runtime.observability.metrics()).sse_clients,1);

      stage='late genuine authorized GET cannot restore protected candidate facts after the current epoch loses scope';await navigate('incidents/candidates/'+otherId);
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root(otherId))})?.querySelector('.workbench-select[data-field-label="人工决定"] select'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'`);
      await choose(otherId,'人工决定','REJECT_CANDIDATE');await choose(otherId,'决定原因','INCORRECT_ASSOCIATION');
      await browser.evaluate("(()=>{const send=globalThis.fetch;globalThis.__t27BootstrapFacts=[];globalThis.fetch=async(path,options)=>{const response=await send(path,options);if(String(path)==='/api/lifecycle/bootstrap'&&response.ok){const body=await response.clone().json();globalThis.__t27BootstrapFacts.push({roles:body.roles,revision:body.authorization_revision});}return response;};})()");
      assert.equal(await browser.evaluate("fetch('/api/lifecycle/bootstrap').then(response=>response.ok)"),true);
      holdNext=true;await browser.evaluate(`document.querySelector(${JSON.stringify(root(otherId))}).querySelector('[data-action=refresh-candidate]').click()`);
      for(let i=0;i<100&&!release;i++)await new Promise<void>(resolve=>setTimeout(resolve,50));assert.ok(release,'a real authorized Candidate GET body must be held in flight');assert.equal(heldStatus,200);
      await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:text(admin.wecom_user_id),displayName:text(admin.display_name),roles:['HANDLER'],resolverTeamIds:[]});
      await browser.waitFor("globalThis.__t27BootstrapFacts.some(fact=>fact.roles.includes('HANDLER')&&!fact.roles.includes('ADMIN'))");
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const denied=await get('/api/incident-candidates/'+otherId);assert.equal(denied.status,404,'current public resource authority must genuinely reject the old actor scope');
      release();release=undefined;await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await browser.waitFor(`!document.querySelector(${JSON.stringify(root(otherId))})?.querySelector('.detail-body')`);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root(otherId))})?.querySelectorAll('.workbench-select[data-field-label="人工决定"] select').length??0`),0);
      await browser.command('Page.reload');await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root(otherId))})?.querySelector('[role=alert]'))`);
      assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(root(otherId))})?.querySelector('.detail-body'))`),false);
      assert.equal(posts,4,'only the four explicit fixture commands may POST; authority changes never replay input');
      assert.deepEqual((await pool.query('SELECT id::text,status,version FROM pilot_ticket.ticket ORDER BY id')).rows,personal);
      assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows[0]?.count,ticketEvents);
      for(const table of ['communication.message','communication.outbox','communication.delivery'])assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM '+table)).rows[0]?.count,0);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      const shot=await browser.screenshot(),bytes=Buffer.from(text(shot),'base64'),file=join(directory,'new-detail-'+bytes.readUInt32BE(16)+'.png');await writeFile(file,bytes);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_SSE',candidate_list_detail_result:true,captured_input_preserved:true,late_get_after_scope_loss:true,single_product_stream:true,screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
    }catch(failure){error=failure;if(browser){try{await writeFile(join(directory,'failure.png'),Buffer.from(text(await browser.screenshot()),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({stage,view:await browser.evaluate('({text:document.body.innerText,url:location.href})')}));console.log('T27_FAILURE_DIRECTORY '+directory);}catch(captureFailure){error=new AggregateError([failure,captureFailure],'T27_REALTIME_EVIDENCE_FAILURE');}}}
    await closeBrowserTestResources([async()=>{try{release?.();}finally{runtime.server.off('request',observe);}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);}],error);
  }});await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});
