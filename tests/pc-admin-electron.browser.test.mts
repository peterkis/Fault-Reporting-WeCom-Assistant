import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {copyFileSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {withT43Fixture,object,text,version} from './helpers/t43-full-service-fixture.mjs';
import {start,complete,get,post} from './helpers/t43-service-actions.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import {createWeComWorkbenchAuthentication} from '../app/server/src/p2-016-workbench-wecom-auth.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';

interface DesktopProcess {child:ChildProcess;command:(action:string,expression?:string)=>Promise<unknown>;evaluate:(expression:string)=>Promise<unknown>;wait:(expression:string)=>Promise<void>;close:()=>Promise<void>}
async function launchDesktop(root:string,stage:string,spki:string,name:string):Promise<DesktopProcess>{
 const data=path.join(root,'.local/electron/profiles',name);mkdirSync(data,{recursive:true});
 const env:NodeJS.ProcessEnv={...process.env,WECOM_DESKTOP_DATA_ROOT:data,WECOM_DESKTOP_TEST_STAGE:stage,WECOM_DESKTOP_TEST_SPKI:spki};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(stage,'process-driver.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let nextId=1,ready=false;const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
 const log:string[]=[];child.stderr?.on('data',(chunk:Buffer)=>{if(log.length<50)log.push(chunk.toString());});
 child.on('message',value=>{if(!value||typeof value!=='object')return;const r=object(value);if(r.ready===true){ready=true;return;}if(typeof r.id!=='number')return;const slot=pending.get(r.id);if(!slot)return;pending.delete(r.id);clearTimeout(slot.timer);if(r.ok===true)slot.resolve(r.result);else slot.reject(Error(String(r.error)));});
 child.on('exit',()=>{for(const slot of pending.values()){clearTimeout(slot.timer);slot.reject(Error('DESKTOP_PROCESS_EXITED'));}pending.clear();});
 const command=(action:string,expression?:string):Promise<unknown>=>new Promise((resolve,reject)=>{const id=nextId++,timer=setTimeout(()=>{pending.delete(id);reject(Error('DESKTOP_COMMAND_TIMEOUT:'+action));},20_000);pending.set(id,{resolve,reject,timer});child.send({id,action,...(expression===undefined?{}:{expression})});});
 const evaluate=(expression:string)=>command('evaluate',expression);
 const wait=async(expression:string)=>{const deadline=Date.now()+40_000;while(Date.now()<deadline){if(await evaluate(expression))return;await delay(100);}throw Error('DESKTOP_CONDITION_TIMEOUT:'+expression);};
 const close=async()=>{if(child.exitCode!==null)return;const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));if(child.connected)child.disconnect();await Promise.race([exited,delay(10_000).then(()=>{if(child.exitCode===null){child.kill();throw Error('DESKTOP_CLEANUP_TIMEOUT');}})]);};
 try{const deadline=Date.now()+20_000;while(!ready&&Date.now()<deadline){if(child.exitCode!==null)throw Error('DESKTOP_START_FAILED:'+log.join('').slice(-1200));await delay(100);}assert.ok(ready,'actual Electron process must start');return {child,command,evaluate,wait,close};}catch(error){writeFileSync(path.join(data,'startup-diagnostic.log'),log.join(''));try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'DESKTOP_START_AND_CLEANUP_FAILED');}throw error;}
}
const jsonPost=(route:string,body:Record<string,unknown>)=>`(async()=>{const bootstrap=await (await fetch('/api/lifecycle/bootstrap')).json();const body=${JSON.stringify(body)};const response=await fetch(${JSON.stringify(route)},{method:'POST',headers:{'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};})()`;

test('Windows Electron uses real staff sessions and formal bundle for three-person closure, hidden reminders and authority loss',{
 timeout:240_000,skip:process.platform!=='win32'||process.env.WECOM_DESKTOP_INTEGRATION!=='true'?'Explicit Windows Electron integration entry required':false,
},()=>withT43Fixture(async f=>{
 const root=path.resolve(process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd());
 assert.ok(existsSync(path.join(root,'.local/electron/stage/main.mjs')),'desktop Build must prepare an allowlisted stage');
 const authMigration={databaseUrl:f.databaseUrl,mode:'apply'};
 await migrateWorkbenchAuth(authMigration);
 const access=createPilotAccessService({pool:f.pool}),principals:string[]=[];
 for(let i=0;i<3;i++)principals.push((await access.upsertPrincipal({wecomUserId:'desktop-staff-'+i,displayName:'桌面合成人员'+i,roles:['DISPATCHER','HANDLER'],resolverTeamIds:['PILOT_IT']})).id);
 let actor=0,auth:ReturnType<typeof createWeComWorkbenchAuthentication>|undefined,runtime:P2016EnabledRuntime|undefined;
 let ready:Promise<unknown>=Promise.resolve();const codes=new Map<string,string>();let readWrites=0,activityWrites=0,holdQr=false,heldQrRequests=0;
 const tls=await createYxxBrowserFixture({pool:f.pool,createApp:({origin}:{origin:string})=>{
  auth=createWeComWorkbenchAuthentication({pool:f.pool,publicOrigin:origin,corpId:'desktop-test',agentId:'1000001',identityHashKey:'desktop-synthetic-identity-secret',accessTokenProvider:async()=> 'synthetic-only',fetchImpl:async(input,init)=>{
   const url=new URL(String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');
   if(url.pathname.endsWith('/batch/userid_to_openuserid')){const body=object(JSON.parse(String(init?.body)));assert.ok(Array.isArray(body.userid_list));return new Response(JSON.stringify({errcode:0,open_userid_list:body.userid_list.map(userid=>({userid,open_userid:'open-'+String(userid)}))}));}
   const code=url.searchParams.get('code')??'',userid=codes.get(code);codes.delete(code);return new Response(JSON.stringify(userid?{errcode:0,userid}:{errcode:40029}));
  },profileReader:async id=>({openUserId:id,displayName:'企业微信合成姓名'+id.slice(-1),departmentName:'合成信息科',checkedEpochMs:String(Date.now())})});ready=auth.initialize();
  const created=createP2016Runtime({pool:f.pool,publicOrigin:origin,listenPort:0,workbenchAuthentication:auth,
   flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,
   workbenchRealtimeEnabled:true,workbenchRemindersEnabled:true,workbenchPersonalReadEnabled:true,workbenchActivityEnabled:true,
   workbenchInternalNotesEnabled:true,ticketSelfHandlingEnabled:true,ticketAssignmentEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
  runtime=created;
  return createServer((request,response)=>{void ready.then(()=>{
   const url=new URL(request.url??'/',origin);
   if(url.pathname==='/workbench/synthetic-provider'){
    if(holdQr){heldQrRequests++;response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><h1>合成企业微信二维码登录</h1>');return;}
    const code=randomUUID();codes.set(code,'open-desktop-staff-'+actor);response.writeHead(303,{location:origin+'/workbench/callback?state='+url.searchParams.get('state')+'&code='+code});response.end();return;
   }
   if(request.method==='POST'&&/read-position|read-cursor/u.test(url.pathname))readWrites++;
   if(request.method==='POST'&&url.pathname==='/api/workbench/activity')activityWrites++;
   const original=response.writeHead.bind(response);
   response.writeHead=((status:number,...args:unknown[])=>{
    const headers=args[0];if(headers&&typeof headers==='object'&&!Array.isArray(headers)){
     const value=headers as Record<string,unknown>;
     if(typeof value.location==='string'&&value.location.startsWith('https://login.work.weixin.qq.com/'))value.location=origin+'/workbench/synthetic-provider?state='+new URL(value.location).searchParams.get('state');
    }
    return Reflect.apply(original,response,[status,...args]);
   }) as typeof response.writeHead;
   created.server.emit('request',request,response);
  }).catch(()=>{response.writeHead(503);response.end();});});
 }});
 assert.ok(tls,'owned TLS fixture must start');
 const processes:DesktopProcess[]=[],runId=randomUUID();
 try{
  const stage=path.join(root,'.local/electron/temp','process-stage-'+runId);mkdirSync(stage,{recursive:true});
  for(const file of ['main.mjs','policy.mjs','preload.cjs','unavailable.html','package.json','icon.ico','icon.png','chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs'])copyFileSync(path.join(root,'.local/electron/stage',file),path.join(stage,file));
  copyFileSync(path.join(root,'.local/electron/compiled/process-driver.mjs'),path.join(stage,'process-driver.mjs'));
  writeFileSync(path.join(stage,'desktop.config.json'),JSON.stringify({schemaVersion:1,serverOrigin:tls.origin}));
  for(actor=0;actor<3;actor++){
   const desktop=await launchDesktop(root,stage,tls.certificateSpki,'integration-'+runId+'-'+actor);processes.push(desktop);
   await desktop.wait('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
   assert.equal(await desktop.evaluate('(async()=> (await (await fetch("/api/lifecycle/bootstrap")).json()).principal_id)()'),principals[actor]);
   await desktop.wait('document.querySelector(".account")?.textContent.includes("企业微信合成姓名'+actor+'")&&document.querySelector(".account")?.textContent.includes("合成信息科")');
   assert.equal(await desktop.evaluate('Boolean(document.querySelector("aside .brand"))||document.querySelector(".topbar").innerText.includes("旧管理端")||document.querySelector(".topbar").innerText.includes("实时更新")'),false);
   assert.equal(await desktop.evaluate('typeof require+":"+typeof process'), 'undefined:undefined');
   assert.equal(await desktop.evaluate('window.workbenchDesktop.version'),1);
   const paths=object(object(await desktop.command('state')).paths);for(const value of Object.values(paths))assert.ok(String(value).startsWith(root+'\\.local\\electron\\profiles\\'));
  }
  const a=processes[0],b=processes[1],c=processes[2];assert.ok(a&&b&&c);
  await a.command('hide');assert.equal(await a.command('second-instance'),0);assert.equal(object(await a.command('state')).visible,true);
  await a.command('screenshot');
  const admin=f.staff[0];assert.ok(admin);
  const report=await f.manualReport('桌面合成打印故障，需要信息科检查。'),active=await start(f,report),closed=await complete(admin,active,'桌面合成内部过程');
  const route='/api/tickets/'+text(active.id);
  await post(admin,route+'/reopen',{client_command_id:randomUUID(),expected_version:version(closed.version),reason_code:'STAFF_REOPEN',note:'合成明确仍未解决'});
  const reopened=await get(admin,route),command={expected_version:version(reopened.version),reason_code:'DESKTOP_EXPLICIT_START',resolver_team_id:'PILOT_IT'};
  const competing=await Promise.all([a,b].map(desktop=>desktop.evaluate(jsonPost(route+'/take-and-start',{...command,client_command_id:randomUUID()}))));
  assert.deepEqual(competing.map(value=>object(value).status).sort(),[200,409]);
  const current=await get(admin,route),winner=current.assignee_id===principals[0]?a:b;
  const transfer=object(await winner.evaluate(jsonPost(route+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:principals[2],resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]})));
  assert.equal(transfer.status,200);const assigned=await get(admin,route);assert.equal(assigned.assignee_id,principals[2]);
  const finished=object(await c.evaluate(jsonPost(route+'/complete',{client_command_id:randomUUID(),expected_version:version(assigned.version),reason_code:'STAFF_COMPLETED',handling_cycle_id:text(object(assigned.handling_cycle).id),internal_process:'合成检查打印连接并修复',external_summary:'合成设备已恢复',external_summary_confirmed:true})));
  assert.equal(finished.status,200);assert.equal((await get(admin,route)).status,'CLOSED');
  await a.evaluate(`(()=>{const original=window.fetch;window.__desktopReminderReads=[];window.fetch=async function(input,init){const url=new URL(input instanceof Request?input.url:String(input),location.href);const response=await original.call(this,input,init);if(url.pathname==='/api/workbench/reminders'){await response.clone().json();window.__desktopReminderReads.push({after:url.searchParams.has('after_event_id'),status:response.status});}return response;};})()`);
  await a.evaluate('document.querySelector("[data-action=open-settings]").click()');
  await a.wait('document.querySelector(".workbench-settings input[aria-label=开启桌面通知]")?.disabled===false');
  await a.evaluate('document.querySelector(".workbench-settings input[aria-label=开启桌面通知]").click()');
  await a.wait('document.querySelector(".workbench-settings input[aria-label=开启桌面通知]")?.checked===true');
  await a.wait('window.__desktopReminderReads.some(read=>read.after===false&&read.status===200)');
  await a.evaluate('document.querySelector("[aria-label=关闭设置]").click()');
  await a.wait('document.querySelector("[data-reminders-ready]")?.dataset.remindersReady==="true"');
  await a.command('hide');await delay(300);const reads=readWrites,activity=activityWrites;
  await f.manualReport('桌面后台提醒合成新报修：打印机无法连接。');
  const until=Date.now()+35_000;while(Date.now()<until&&Number(object(await a.command('state')).notifications)===0)await delay(200);
  assert.ok(Number(object(await a.command('state')).notifications)>0,'actual Electron Notification.show must be called while hidden');
  assert.equal(object(await a.command('state')).visible,false);assert.equal(readWrites,reads);assert.equal(activityWrites,activity);
  await a.command('notification-click');await a.wait('document.querySelector("[data-reminder-located=true]")!==null||location.search.includes("locate=1")');
  assert.equal(object(await a.command('state')).visible,true);
  await a.command('lock');await a.wait('(async()=> (await window.workbenchDesktop.getState()).locked)()');await a.command('unlock');
  assert.equal(await b.evaluate('(async()=>{await window.workbenchDesktop.updateContext({epoch:crypto.randomUUID(),blocked:false,live:true,remindersAvailable:false});return window.workbenchDesktop.setReminders(true);})()'),false,'server-disabled capability cannot arm native notifications');
  await a.evaluate("(async()=>{const save=state=>sessionStorage.setItem('synthetic-expiry-native-state',JSON.stringify({remindersEnabled:state.remindersEnabled}));window.workbenchDesktop.onState(save);save(await window.workbenchDesktop.getState());})()");
  // A staff permission rejection may legitimately be 403. Exercise actual session
  // invalidation here; the separate desktop-session browser cases retain the 403 boundary.
  holdQr=true;await f.pool.query("WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=stamp.epoch,revoked_at=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE principal_id=$1::uuid AND state='ACTIVE'",[principals[0]]);
  await a.wait("location.pathname==='/workbench/synthetic-provider'&&document.body.innerText.includes('合成企业微信二维码登录')");
  assert.equal(await a.evaluate("JSON.parse(sessionStorage.getItem('synthetic-expiry-native-state')).remindersEnabled"),false,'native reminders stop before the login page loses the business bridge');assert.equal(heldQrRequests,1);
  const dialogsBefore=object(await b.command('state')).dialogs;
  await f.pool.query("WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=stamp.epoch,revoked_at=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE principal_id=$1::uuid AND state='ACTIVE'",[principals[1]]);
  await b.wait("location.pathname==='/workbench/synthetic-provider'&&document.body.innerText.includes('合成企业微信二维码登录')");
  assert.equal(heldQrRequests,2,'each affected native window opens one QR login after real staff session revocation');assert.equal(await b.evaluate('typeof window.workbenchDesktop'),'undefined','the QR page has no business IPC bridge');assert.equal(object(await b.command('state')).dialogs,dialogsBefore,'expired identity must not require an extra leave confirmation');
  console.log('ELECTRON_MVP '+JSON.stringify({actors:3,real_staff_sessions:true,compiled_frontend:true,competing_statuses:[200,409],closed:true,hidden_notification:true,hidden_read_activity_writes:0,notification_click_automated:true,revoked_sessions_blocked:true,physical_toast_confirmation:'NOT_RUN',live_wecom:'NOT_RUN'}));
 }finally{
  for(const desktop of processes)await desktop.close();await tls.close();await runtime?.stop();await auth?.close();
 }
}));
