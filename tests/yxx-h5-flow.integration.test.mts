import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import type {IncomingHttpHeaders} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withP2015IsolatedDatabase} from './helpers/p2-015-postgres-harness.mjs';
import {sourceFile} from './helpers/migration-roots.mjs';
import {entryConfig,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createApplicationMemberVerifier} from '../src/wecom-application-member.mjs';
import {createWeComAppTokenProvider} from '../src/p2-g2-wecom-app-token.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {createYxxH5Runtime} from '../src/yxx-h5-runtime.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {migrateWorkbenchAuth} from '../scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory} from '../scripts/p2-007-migrate.mjs';
import {migrateTicketSelfHandling} from '../scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../scripts/ticket-round-notifications-migrate.mjs';
import {migrateTicketReopenRounds} from '../scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateMvpNotifications} from '../scripts/mvp-notifications-migrate.mjs';

const ORIGIN='https://127.0.0.1';
const ACCEPT='application/vnd.yixiaoxiu.v2+json';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function array(value:unknown):unknown[]{assert.ok(Array.isArray(value));return value;}
function wave(){
  const samples=1600,data=Buffer.alloc(samples*2),header=Buffer.alloc(44);
  for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/16000)*2000),i*2);
  header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
  return Buffer.concat([header,data]);
}
interface HttpResult {status:number;headers:IncomingHttpHeaders;body:Record<string,unknown>;bytes:Buffer}
interface RequestOptions {method?:'GET'|'POST'|'PUT'|'DELETE';body?:Record<string,unknown>|Buffer;commandId?:string;contentType?:string;headers?:Record<string,string>;discardResponse?:boolean}
function client(base:string,initialCookie?:{name:string;value:string}) {
  const cookies=new Map<string,string>(initialCookie?[[initialCookie.name,initialCookie.value]]:[]);let csrf='';
  async function send(path:string,options:RequestOptions={}):Promise<HttpResult>{
    const method=options.method??'GET',input=options.body,body=input===undefined?undefined:Buffer.isBuffer(input)?input:Buffer.from(JSON.stringify(input));
    const object=input!==undefined&&!Buffer.isBuffer(input)?input:null;
    const commandId=options.commandId??(object&&typeof object.client_command_id==='string'?object.client_command_id:null);
    const result=await new Promise<HttpResult>((resolveResult,reject)=>{
      const request=httpRequest(base+path,{method,headers:{host:new URL(ORIGIN).host,connection:'close',accept:ACCEPT,cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),
        ...(method!=='GET'?{origin:ORIGIN,'x-csrf-token':csrf}:{}),
        ...(body?{'content-length':String(body.length),'content-type':options.contentType??'application/json'}:{}),
        ...(commandId?{'idempotency-key':commandId}:{}),
        ...(object&&typeof object.expected_ticket_version==='number'?{'if-match':'"'+object.expected_ticket_version+'"'}:{}),...options.headers}},response=>{
          if(options.discardResponse){response.destroy();resolveResult({status:0,headers:{},body:{},bytes:Buffer.alloc(0)});return;}
          const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>{
            const bytes=Buffer.concat(chunks),json=response.headers['content-type']?.includes('application/json')&&bytes.length?record(JSON.parse(bytes.toString('utf8'))):{};
            resolveResult({status:response.statusCode??0,headers:response.headers,body:json,bytes});
          });
        });
      request.on('error',reject);request.setTimeout(20000,()=>request.destroy(new Error('H5_FLOW_HTTP_DEADLINE')));request.end(body);
    });
    for(const cookie of result.headers['set-cookie']??[]){const pair=cookie.split(';')[0]??'',at=pair.indexOf('=');if(at>0)cookies.set(pair.slice(0,at),pair.slice(at+1));}
    if(typeof result.body.csrf_token==='string')csrf=result.body.csrf_token;
    return result;
  }
  return {send,get:(path:string)=>send(path),post:(path:string,body:Record<string,unknown>)=>send(path,{method:'POST',body}),async login(code:string){
    const login=await send('/wecom/yixiaoxiu/login');assert.equal(login.status,302);assert.ok(login.headers.location);
    const state=new URL(login.headers.location).searchParams.get('state');assert.ok(state);
    const callback=await send('/wecom/yixiaoxiu/callback?code='+encodeURIComponent(code)+'&state='+encodeURIComponent(state));assert.equal(callback.status,303,JSON.stringify(callback.body));
    const bootstrap=await send('/api/yixiaoxiu/bootstrap');assert.equal(bootstrap.status,200,JSON.stringify(bootstrap.body));return bootstrap.body;
  }};
}

test('H5 real HTTP, Core, media Worker and current workbench READ share one isolated source and original UUID',{timeout:240000},async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;assert.ok(databaseUrl,'PILOT_DATABASE_URL is required for the H5 flow integration');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname));
  const ffmpegPath=process.env.H5_MEDIA_FFMPEG,ffprobePath=process.env.H5_MEDIA_FFPROBE;
  assert.ok(ffmpegPath&&ffprobePath,'controlled FFmpeg and FFprobe paths are required; conversion cannot be skipped');
  assert.ok((await stat(ffmpegPath)).isFile());assert.ok((await stat(ffprobePath)).isFile());
  const root=await mkdtemp(join(tmpdir(),'yxx-h5-flow-')),key=randomBytes(32);
  try{await withP2015IsolatedDatabase({databaseUrl,purpose:'h5flow',max:2,run:async({pool,databaseUrl:isolated}:{pool:PostgresPool;databaseUrl:string})=>{
    assert.ok(Number((await pool.query<{server_version_num:string}>('SHOW server_version_num')).rows[0]?.server_version_num)>=180000);
    const migrationRoot=dirname(sourceFile('database/migrations/001_p1_003_channel_message_inbox.sql'));
    await migrateCurrentBaselineWithYxx({databaseUrl:isolated});
    const migrationOptions={databaseUrl:isolated,mode:'apply' as const};
    const formal=new Map<number,()=>Promise<unknown>>([
      [35,()=>migrateWorkbenchAuth(migrationOptions)],[36,()=>migrateThirdPartyStaffDirectory(migrationOptions)],
      [39,()=>migrateTicketSelfHandling({databaseUrl:isolated,mode:'apply'})],[40,()=>migrateTicketStaffCompletion({databaseUrl:isolated,mode:'apply'})],
      [41,()=>migrateTicketRoundNotifications({databaseUrl:isolated,mode:'apply'})],[43,()=>migrateTicketReopenRounds({databaseUrl:isolated,mode:'apply'})],
      [63,()=>migrateMvpNotifications({databaseUrl:isolated,mode:'apply'})],
    ]);
    for(const file of (await readdir(migrationRoot)).filter(file=>/^\d{3}_.+\.sql$/u.test(file)&&Number(file.slice(0,3))>34&&Number(file.slice(0,3))<=65).sort()){
      const number=Number(file.slice(0,3));if(number===52)continue; // The formal 041 migrator owns its 052 successor.
      const migrate=formal.get(number);if(migrate)await migrate();else await pool.query(await readFile(join(migrationRoot,file),'utf8'));
    }
    const access=createPilotAccessService({pool});
    const admin=await access.upsertPrincipal({wecomUserId:'h5-flow-admin',displayName:'合成跨层管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const outsider=await access.upsertPrincipal({wecomUserId:'h5-flow-outsider',displayName:'合成跨层越权人员',roles:['HANDLER'],resolverTeamIds:[]});
    const config=validateYxxEntryConfig({...entryConfig,identityMode:'VERIFIED_APP_OPENID'});assert.ok(config.enabled);
    const visible=new Set(['h5-open-a','h5-open-b']),providerPaths:string[]=[];let memberUnavailable=false;
    const fetchImpl:typeof fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(init?.redirect,'error');providerPaths.push(url.pathname);
      if(url.pathname==='/cgi-bin/gettoken')return new Response(JSON.stringify({errcode:0,access_token:'H5_FLOW_SYNTHETIC_TOKEN',expires_in:7200}));
      if(url.pathname==='/cgi-bin/user/get'){
        if(memberUnavailable)return new Response('synthetic temporary outage',{status:503});
        const id=url.searchParams.get('userid');return new Response(JSON.stringify(id&&visible.has(id)?{errcode:0,userid:id,name:'合成报修成员',status:1,enable:1}:{errcode:60011}));
      }
      if(url.pathname==='/cgi-bin/get_jsapi_ticket'||url.pathname==='/cgi-bin/ticket/get')return new Response(JSON.stringify({errcode:0,ticket:'H5_FLOW_SYNTHETIC_TICKET',expires_in:7200}));
      if(url.pathname==='/cgi-bin/media/get')return new Response(Buffer.from(PNG),{headers:{'content-type':'image/png'}});
      assert.fail('unexpected WeCom endpoint: '+url.pathname);
    };
    const tokenProvider=createWeComAppTokenProvider({corpId:config.corpId,appSecret:'H5_FLOW_SYNTHETIC_SECRET',fetchImpl});
    const mapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:tokenProvider,fetchImpl});
    const memberFlags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    const runtime=createP2016Runtime({pool,publicOrigin:ORIGIN,reporterOrigin:ORIGIN,principalIds:[admin.id,outsider.id],identityHmacKey:'h5-flow-synthetic-identity-key',
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:false},externalSendEnabled:false,mvpNotificationsEnabled:true,
      reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:config,identityMapping:mapping,applicationMemberVerifier:createApplicationMemberVerifier({accessTokenProvider:tokenProvider,fetchImpl}),
      yxxSelfService:{featureFlags:memberFlags,reporterFeedbackEnabled:true},ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,
      yxxH5:{enabled:true,privateRoot:root,key,accessTokenProvider:tokenProvider,fetchImpl,workbenchProgressEnabled:true},
      wecomWebOAuth:{enabled:true,corpId:config.corpId,agentId:config.agentId,resolveCode:async code=>({userid:code==='A'?'h5-open-a':'h5-open-b'})}});
    assert.ok('server' in runtime,'the explicitly enabled H5 runtime must provide its real HTTP server');
    const worker=createP2016OrchestrationWorker({pool,mvpPolicy:true,identityHmacKey:'h5-flow-synthetic-identity-key',notifications:runtime.notifications,realtime:runtime.realtimeProjector,yxxSelfService:{featureFlags:memberFlags}});
    const mediaWorker=createYxxH5Runtime({pool,scopeSecret:entryKey,role:'WORKER',options:{enabled:true,privateRoot:root,key,ffmpegPath,ffprobePath}});
    try{
      // Existing manual-host pattern: all handlers/auth/ports are real; the test owns each finite Worker turn.
      const address=await listenConversationWorkbenchServer(runtime.server),base='http://127.0.0.1:'+address.port;
      const a=client(base),b=client(base),beforeLookup=providerPaths.length;
      const bootstrap=await a.login('A');await b.login('B');
      assert.equal(providerPaths.filter(path=>path==='/cgi-bin/user/get').length,2,'each bootstrap shares one membership proof across its reads');
      assert.ok(providerPaths.length>beforeLookup);assert.equal(record(bootstrap.h5).can_upload,true);assert.equal(record(record(bootstrap.h5).sdk).corp_id,config.corpId);
      const signature=await a.post('/api/yixiaoxiu/js-sdk/signature',{url:ORIGIN+'/wecom/yixiaoxiu/reports/new',kind:'CORP'});
      assert.equal(signature.status,200,JSON.stringify(signature.body));assert.equal(signature.body.corpId,config.corpId);assert.match(string(signature.body.signature),/^[a-f0-9]{40}$/u);

      const contact={schema_version:2,client_command_id:randomUUID(),intent:'CONTACT_REQUEST',description:null,location:{text:null,unknown:true},media_refs:[]};
      const lostContact=await a.send('/api/yixiaoxiu/requests',{method:'POST',body:contact,discardResponse:true});assert.equal(lostContact.status,0,'discard the committed HTTP response before a receipt reaches the client');
      const recovered=await a.get('/api/yixiaoxiu/commands/'+contact.client_command_id);assert.equal(recovered.status,200);const contactRef=string(recovered.body.request_ref);
      const contactReplay=await a.post('/api/yixiaoxiu/requests',contact);assert.equal(contactReplay.body.replayed,true);assert.equal(record(contactReplay.body.receipt).request_ref,contactRef);
      assert.equal((await b.get('/api/yixiaoxiu/commands/'+contact.client_command_id)).status,404);

      const voiceBytes=wave(),reserve=await a.post('/api/yixiaoxiu/media/uploads',{schema_version:1,client_command_id:randomUUID(),kind:'VOICE',mime_type:'audio/wav',byte_size:voiceBytes.length,duration_ms:100});
      assert.equal(reserve.status,201,JSON.stringify(reserve.body));const mediaRef=string(reserve.body.media_ref);
      const uploaded=await a.send('/api/yixiaoxiu/media/uploads/'+mediaRef+'/content',{method:'PUT',commandId:randomUUID(),contentType:'audio/wav',body:voiceBytes});assert.equal(uploaded.status,200,JSON.stringify(uploaded.body));
      assert.equal(uploaded.body.playback_status,'PENDING');
      const pureMedia={schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:null,location:{text:null,unknown:true},media_refs:[mediaRef]};
      const accepted=await a.post('/api/yixiaoxiu/requests',pureMedia);assert.equal(accepted.status,202,JSON.stringify(accepted.body));const requestRef=string(record(accepted.body.receipt).request_ref);
      const replay=await a.post('/api/yixiaoxiu/requests',pureMedia);assert.equal(replay.status,200);assert.equal(record(replay.body.receipt).request_ref,requestRef);
      const rejected=await b.post('/api/yixiaoxiu/requests',{...pureMedia,client_command_id:randomUUID()});assert.equal(rejected.status,404,JSON.stringify(rejected.body));

      const native=await a.post('/api/yixiaoxiu/media/uploads',{schema_version:1,client_command_id:randomUUID(),kind:'IMAGE',mime_type:'image/jpeg',byte_size:null,duration_ms:null});assert.equal(native.status,201);
      const nativeRef=string(native.body.media_ref),imported=await a.send('/api/yixiaoxiu/media/uploads/'+nativeRef+'/wecom',{method:'POST',commandId:randomUUID(),body:{server_id:'H5_FLOW_SYNTHETIC_IMAGE'}});assert.equal(imported.status,200,JSON.stringify(imported.body));
      assert.equal(imported.body.mime_type,'image/png');
      const imageReport=await a.post('/api/yixiaoxiu/requests',{...pureMedia,client_command_id:randomUUID(),media_refs:[nativeRef]});assert.equal(imageReport.status,202);const imageRequestRef=string(record(imageReport.body.receipt).request_ref);

      for(let attempt=0;attempt<4;attempt++){
        await worker.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},now_epoch_ms:String(Date.now()+15000),batch_size:5});
        if((await pool.query('SELECT 1 FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=ANY($1::text[])',[[contactRef,requestRef,imageRequestRef]])).rowCount===3)break;
      }
      const tickets=await pool.query<{id:string;ticket_no:string;version:number;request_ref:string}>('SELECT t.id::text,t.ticket_no,t.version,b.request_ref FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=ANY($1::text[])',[[contactRef,requestRef,imageRequestRef]]);
      assert.equal(tickets.rowCount,3,'contact, voice-only and imported-image-only reports each create one Core ticket');
      const ticket=tickets.rows.find(row=>row.request_ref===requestRef);assert.ok(ticket);
      const reports=await a.get('/api/yixiaoxiu/my-reports?source=WEB&status=OPEN&search='+encodeURIComponent(ticket.ticket_no));assert.equal(reports.status,200,JSON.stringify(reports.body));
      assert.deepEqual(array(reports.body.items).map(item=>record(item).ref),[requestRef]);assert.deepEqual(array((await b.get('/api/yixiaoxiu/my-reports?source=WEB&status=OPEN')).body.items),[]);
      const pendingDetail=await a.get('/api/yixiaoxiu/requests/'+requestRef);assert.equal(pendingDetail.status,200,JSON.stringify(pendingDetail.body));
      assert.equal(record(pendingDetail.body.ticket).ticket_no,ticket.ticket_no);assert.equal(record(array(record(pendingDetail.body.h5).media)[0]).media_ref,mediaRef);
      assert.equal((await b.get('/api/yixiaoxiu/requests/'+requestRef)).status,404);
      const mediaPath='/api/yixiaoxiu/requests/'+requestRef+'/media/'+mediaRef;
      assert.equal((await a.get(mediaPath)).status,503,'pending playback is explicit while the original remains readable');
      assert.deepEqual((await a.get(mediaPath+'?variant=ORIGINAL')).bytes,voiceBytes);assert.equal((await b.get(mediaPath+'?variant=ORIGINAL')).status,404);
      await mediaWorker.runOnce();
      const ready=await a.get('/api/yixiaoxiu/requests/'+requestRef);assert.equal(record(array(record(ready.body.h5).media)[0]).playback_status,'READY');
      const playback=await a.get(mediaPath);assert.equal(playback.status,200,JSON.stringify(playback.body));assert.equal(playback.headers['content-type'],'audio/wav');assert.equal(playback.bytes.toString('ascii',0,4),'RIFF');
      assert.deepEqual((await a.get(mediaPath+'?variant=ORIGINAL')).bytes,voiceBytes);
      const image=await a.get('/api/yixiaoxiu/requests/'+imageRequestRef+'/media/'+nativeRef);assert.equal(image.status,200);assert.deepEqual(image.bytes,PNG);

      const staffCookies=runtime.authenticate.browserCookies?.();assert.ok(staffCookies?.[0]&&staffCookies[1]);
      const staff=client(base,staffCookies[0]),foreignStaff=client(base,staffCookies[1]);
      const staffBootstrap=await staff.get('/api/lifecycle/bootstrap');assert.equal(staffBootstrap.status,200);assert.equal(staffBootstrap.body.web_reports_enabled,true);
      const staffPath='/api/workbench/items/ticket/'+ticket.id+'/web-report';
      assert.equal((await staff.get(staffPath)).status,200);assert.equal((await foreignStaff.get(staffPath)).status,404);
      const staffOriginal=await staff.get(staffPath+'/media/'+mediaRef+'?variant=ORIGINAL');assert.equal(staffOriginal.status,200,JSON.stringify(staffOriginal.body));assert.deepEqual(staffOriginal.bytes,voiceBytes);
      const staffPlayable=await staff.get(staffPath+'/media/'+mediaRef);assert.equal(staffPlayable.status,200,JSON.stringify(staffPlayable.body));assert.deepEqual(staffPlayable.bytes,playback.bytes);
      await access.upsertPrincipal({wecomUserId:'h5-flow-outsider',displayName:'合成跨层越权人员',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
      assert.equal((await foreignStaff.get(staffPath)).status,200,'READ is evaluated against the current granted team');
      await access.upsertPrincipal({wecomUserId:'h5-flow-outsider',displayName:'合成跨层越权人员',roles:['HANDLER'],resolverTeamIds:[]});
      assert.equal((await foreignStaff.get(staffPath+'/media/'+mediaRef)).status,404,'the same staff cookie cannot reuse a revoked READ');

      const urge={schema_version:1,client_command_id:randomUUID(),expected_ticket_version:ticket.version};
      const urged=await a.post('/api/yixiaoxiu/requests/'+requestRef+'/urge',urge);assert.equal(urged.status,200,JSON.stringify(urged.body));
      assert.equal((await a.post('/api/yixiaoxiu/requests/'+requestRef+'/urge',urge)).body.replayed,true);
      assert.equal(record((await staff.get(staffPath)).body.urge).active,true);
      const urgeReceipt=await a.get('/api/yixiaoxiu/requests/'+requestRef+'/member-commands/'+urge.client_command_id+'?purpose=URGE');assert.equal(urgeReceipt.status,200);assert.equal(urgeReceipt.body.state,'COMMITTED');
      assert.equal((await pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.id])).rows[0]?.version,ticket.version);
      memberUnavailable=true;assert.equal((await a.get('/api/yixiaoxiu/bootstrap')).status,503,'Provider outage must not become revocation');memberUnavailable=false;
      assert.equal((await a.get('/api/yixiaoxiu/bootstrap')).status,200);visible.delete('h5-open-a');assert.equal((await a.get('/api/yixiaoxiu/requests/'+requestRef)).status,403);
      assert.equal((await pool.query<{n:number}>('SELECT count(*)::integer AS n FROM channel.message_inbox')).rows[0]?.n,0);assert.equal((await pool.query<{n:number}>('SELECT count(*)::integer AS n FROM conversation.session')).rows[0]?.n,0);
      assert.equal(providerPaths.includes('/cgi-bin/message/send'),false);assert.equal(providerPaths.includes('/cgi-bin/batch/userid_to_openuserid'),false);
      assert.ok(providerPaths.includes('/cgi-bin/media/get'));assert.ok(providerPaths.includes('/cgi-bin/get_jsapi_ticket'));
    }finally{await mediaWorker.close();await worker.stop();await runtime.stop();assert.equal(runtime.server.listening,false);assert.deepEqual(mediaWorker.media?.ownedResourceState(),{active:0,plaintext_bytes:0});}
  }});}finally{key.fill(0);await rm(root,{recursive:true,force:true});}
});
