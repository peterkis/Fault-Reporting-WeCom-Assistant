import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Server,IncomingMessage,ServerResponse} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Fixture={pool:PostgresPool;origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string;title:string}}[];principals:{id:string;display_name:string}[];runtime:{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>}}};
type RequestFact={order:number;method:string;path:string;status:number|null;body:unknown;idempotency_key:unknown;if_match:unknown;csrf_present:boolean;origin_same:boolean};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function failureDetails(value:unknown):Record<string,unknown>{return value instanceof AggregateError?{name:value.name,message:value.message,errors:Array.from(value.errors,(nested:unknown)=>failureDetails(nested))}:value instanceof Error?{name:value.name,message:value.message,stack:value.stack}:{value:String(value)};}
function selectExpression(label:string){return `Array.from(document.querySelectorAll('.detail-dialog select')).find(input=>Array.from(input.labels??[]).some(label=>label.textContent?.includes(${JSON.stringify(label)})))`;}
async function choose(browser:Browser,label:string,text:string){
  const select=selectExpression(label);
  await browser.waitFor(`Boolean((${select})&&Array.from((${select}).options).some(option=>option.textContent?.trim()===${JSON.stringify(text)}))`);
  await browser.evaluate(`(()=>{const input=${select},option=Array.from(input.options).find(option=>option.textContent?.trim()===${JSON.stringify(text)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,option.value);input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}

// Execute only after the original targets HTTP RED has an actual minimal GREEN on a current artifact.
test('production staff explicitly transfer an assigned queued Ticket with real group/person choices and clear its facts after losing scope',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const first=context.tickets[0],originalOwner=context.principals[2],actor=context.principals[1],adminCookie=context.cookies[0],actorCookie=context.cookies[2],browserCookie=context.browserCookies[2];
    assert.ok(first&&originalOwner&&actor&&adminCookie&&actorCookie&&browserCookie);
    const path='/api/tickets/'+first.ticket.id,team='T06_NETWORK',teamName='T06 合成网络组';
    // Only directory configuration is seeded; the already-assigned scenario is established by real HTTP.
    await context.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[team,teamName]);
    const target=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'t06-browser-target-'+randomUUID(),displayName:'T06 浏览器承接同事',roles:['HANDLER'],resolverTeamIds:[team]});
    assert.equal((await context.pool.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actor.id,team])).rowCount,0);
    const get=async(url:string,cookie=adminCookie)=>{const response=await fetch(context.origin+url,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
    const assign={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:originalOwner.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
    const assigned=await fetch(context.origin+path+'/assign',{method:'POST',headers:{cookie:adminCookie,origin:context.origin,'content-type':'application/json','x-csrf-token':string(bootstrap.value.csrf_token),'idempotency-key':assign.client_command_id,'if-match':'"2"'},body:JSON.stringify(assign)});
    assert.equal(assigned.status,200);
    const before=(await get(path)).value,cycle=object(before.handling_cycle);
    assert.equal(before.status,'QUEUED');assert.equal(before.assignee_id,originalOwner.id);assert.equal(before.version,3);assert.equal(cycle.cycle_no,1);
    assert.equal((await get(path,actorCookie)).status,200);
    assert.deepEqual(rows((await get(path+'/responsibility',actorCookie)).value.conversations),[],'this actual Web Ticket has no canonical communication to guess');
    const candidates=await get(path+'/assignment-targets?resolver_team_id='+team,actorCookie);
    assert.equal(candidates.status,200,'the original target-query behavior must have reached real GREEN before this browser tracer');
    await assertP2016Schema('p2_016_assignment_targets',candidates.value);
    assert.deepEqual(rows(candidates.value.items),[{principal_id:target.id,display_name:target.display_name}]);

    const requests:RequestFact[]=[];
    const observe=(request:IncomingMessage,response:ServerResponse)=>{
      if(!request.headers.cookie?.includes(browserCookie.name+'='+browserCookie.value))return;
      const url=new URL(request.url??'/',context.origin);if(!url.pathname.startsWith('/api/'))return;
      const fact:RequestFact={order:requests.length,method:request.method??'',path:url.pathname,status:null,body:null,idempotency_key:request.headers['idempotency-key'],if_match:request.headers['if-match'],csrf_present:typeof request.headers['x-csrf-token']==='string'&&request.headers['x-csrf-token'].length>0,origin_same:request.headers.origin===context.origin};requests.push(fact);
      response.once('finish',()=>{fact.status=response.statusCode;});
      // Keep the server's delayed async iterator as the reader; a flowing observer would drain the body before authentication finishes.
      if(fact.method==='POST'){request.pause();const chunks:Buffer[]=[];request.on('data',(chunk:unknown)=>{if(Buffer.isBuffer(chunk))chunks.push(chunk);else if(typeof chunk==='string')chunks.push(Buffer.from(chunk));});request.once('end',()=>{try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}});}
    };
    context.runtime.server.on('request',observe);
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+first.ticket.id,width:1280,height:900,cookies:[browserCookie]});assert.ok(browser);
      const active=browser,capture=async(name:string)=>{const bytes=Buffer.from(string(await active.screenshot()),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
      await browser.waitFor(`Boolean(document.querySelector('#detail-title'))&&document.querySelector('.properties')?.innerText.includes(${JSON.stringify(originalOwner.display_name)})&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'`);
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),600);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog [data-action=transfer-assignment]'))"),true,'the real production transfer form must exist');
      assert.equal(await browser.evaluate("document.querySelector('.detail-dialog [data-action=transfer-assignment]').textContent.trim()"),'确认转派');
      assert.equal(await browser.evaluate(`(${selectExpression('处理组')})?.value`),'','multiple effective groups must not be silently selected');
      assert.equal(await browser.evaluate("document.querySelector('.detail-dialog [data-action=transfer-assignment]').disabled"),true);
      await choose(browser,'处理组',teamName);await choose(browser,'处理人',target.display_name);
      await browser.evaluate("(()=>{const input=Array.from(document.querySelectorAll('.detail-dialog input[type=radio]')).find(input=>input.value==='RETAIN_CURRENT'&&Array.from(input.labels??[]).some(label=>label.textContent?.includes('保留当前沟通')));if(!input)throw Error('EXPLICIT_RETAIN_CHOICE_REQUIRED');input.click();})()");
      await browser.waitFor("document.querySelector('.detail-dialog [data-action=transfer-assignment]')?.disabled===false");
      assert.equal(requests.filter(request=>request.method==='POST').length,0,'choosing group/person/communication must not submit a command');
      await capture('new-detail-1280.png');await browser.evaluate("document.querySelector('.detail-dialog [data-action=transfer-assignment]').click()");
      await browser.waitFor(`!document.querySelector('.activity-list')&&!document.body.innerText.includes(${JSON.stringify(first.ticket.title)})`);
      const posts=requests.filter(request=>request.method==='POST');assert.equal(posts.length,1);const post=posts[0];assert.ok(post);
      assert.equal(post.path,path+'/transfer-assignment');assert.equal(post.status,200);assert.equal(post.csrf_present,true);assert.equal(post.origin_same,true);assert.equal(post.if_match,'"3"');
      const command=object(post.body),commandId=string(command.client_command_id);assert.match(commandId,/^[0-9a-f-]{36}$/u);assert.equal(post.idempotency_key,commandId);
      assert.deepEqual(command,{client_command_id:commandId,expected_version:3,reason_code:'WORKBENCH_TRANSFER',target_principal_id:target.id,resolver_team_id:team,communication_choice:'RETAIN_CURRENT',sessions:[]});
      for(let step=0;step<100&&!requests.some(request=>request.method==='GET'&&request.order>post.order&&[path,'/api/workbench/items/ticket/'+first.ticket.id].includes(request.path)&&request.status===404);step++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.ok(requests.some(request=>request.method==='GET'&&request.order>post.order&&[path,'/api/workbench/items/ticket/'+first.ticket.id].includes(request.path)&&request.status===404),'the production client must really refetch current object authority after the committed transfer');
      assert.equal((await get(path,actorCookie)).status,404);
      // The submitting worker legitimately lost scope; an independently authorized public reader verifies the new facts.
      const after=(await get(path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,target.id);assert.equal(after.resolver_team_id,team);assert.equal(after.version,4);assert.equal(after.intake_id,before.intake_id);assert.deepEqual(after.handling_cycle,cycle);
      const persisted=(await context.pool.query('SELECT assignee_id::text,resolver_team_id,status,version,current_handling_cycle_id::text FROM pilot_ticket.ticket WHERE id=$1::uuid',[first.ticket.id])).rows[0];assert.deepEqual(persisted,{assignee_id:target.id,resolver_team_id:team,status:'QUEUED',version:4,current_handling_cycle_id:cycle.id});
      const events=rows((await get(path+'/events')).value.items),last=events.at(-1);assert.ok(last);assert.equal(last.event_type,'ticket.assignment_transferred');assert.equal(events.some(event=>['ticket.accepted','ticket.started'].includes(String(event.event_type))),false);
      const event=(await context.pool.query('SELECT assignment_metadata,operator_type,operator_id FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid',[string(last.event_id)])).rows[0];assert.deepEqual(event,{assignment_metadata:{old_assignee_id:originalOwner.id,new_assignee_id:target.id,old_team_id:'PILOT_IT',new_team_id:team},operator_type:'PILOT_USER',operator_id:actor.id});
      assert.deepEqual((await context.pool.query('SELECT cycle_id::text FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_event_id=$1::uuid',[string(last.event_id)])).rows,[{cycle_id:cycle.id}]);
      assert.deepEqual(rows((await get(path+'/responsibility')).value.conversations),[]);await capture('new-detail-page-1280.png');
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',assignment_transfer:true,production_staff_role:'HANDLER',communication_choice:'RETAIN_CURRENT',one_command:true,persisted_person_and_team:true,same_cycle:true,current_scope_read_404:true,requests,screenshots}));
    }catch(failure){error=failure;console.error('T06_BROWSER_PRIMARY '+JSON.stringify(failureDetails(failure)));}
    const cleanup=async(name:string,close:()=>Promise<unknown>)=>{try{await close();console.error('T06_BROWSER_CLEANUP '+JSON.stringify({name,status:'PASS'}));}catch(failure){console.error('T06_BROWSER_CLEANUP '+JSON.stringify({name,status:'FAIL',error:failureDetails(failure)}));throw failure;}};
    try{await closeBrowserTestResources([
      ()=>cleanup('failure-capture',async()=>{if(error&&browser){await writeFile(join(directory,'failure.png'),Buffer.from(string(await browser.screenshot()),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({primary:failureDetails(error),page:await browser.evaluate('({text:document.body.innerText,url:location.pathname})'),requests}));}}),
      ()=>cleanup('owned-browser',async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}),
      ()=>cleanup('observer-and-sse',async()=>{context.runtime.server.removeListener('request',observe);assert.equal((await context.runtime.observability.metrics()).sse_clients,0);}),
    ],error);}catch(failure){console.error('T06_BROWSER_TERMINAL '+JSON.stringify(failureDetails(failure)));throw failure;}
  },{ticketSelfHandlingEnabled:true,...{ticketAssignmentEnabled:true},workbenchRealtimeEnabled:true});
});
