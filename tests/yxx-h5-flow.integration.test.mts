import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import type {IncomingHttpHeaders} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,stat,mkdir,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withP2015IsolatedDatabase} from './helpers/p2-015-postgres-harness.mjs';
import {sourceFile} from './helpers/migration-roots.mjs';
import {entryConfig,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {validateYxxEntryConfig} from '../app/server/src/p2-g2-yixiaoxiu-contract.mjs';
import {createYxxDelegatedIdentityMapping} from '../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createApplicationMemberVerifier} from '../app/server/src/wecom-application-member.mjs';
import {createWeComAppTokenProvider} from '../app/server/src/p2-g2-wecom-app-token.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {createP2016OrchestrationWorker} from '../app/server/src/p2-016-orchestration-adapters.mjs';
import {createYxxH5Runtime} from '../app/server/src/yxx-h5-runtime.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {listenConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';
import {migrateCurrentBaselineWithYxx} from '../app/server/scripts/migrate-current-baseline.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory} from '../app/server/scripts/p2-007-migrate.mjs';
import {migrateTicketSelfHandling} from '../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../app/server/scripts/ticket-round-notifications-migrate.mjs';
import {migrateTicketReopenRounds} from '../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateMvpNotifications} from '../app/server/scripts/mvp-notifications-migrate.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';

const ORIGIN='https://127.0.0.1';
const ACCEPT='application/vnd.yixiaoxiu.v2+json';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function array(value:unknown):unknown[]{assert.ok(Array.isArray(value));return value;}
function wave(samples=1600){
  const data=Buffer.alloc(samples*2),header=Buffer.alloc(44);
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

async function verifyDetailMedia(origin:string,ticketId:string,cookie:{name:string;value:string},ready:()=>Promise<void>,voiceRef:string,originalVideo:Buffer,emptyTicketId:string){
  const directory=join(tmpdir(),'workbench-detail-media-'+randomUUID()),downloads=join(directory,'downloads');await mkdir(downloads,{recursive:true});let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
  try{
    browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticketId+'?detail=page',width:1280,height:900,cookies:[{name:cookie.name,value:cookie.value,url:origin+'/'}]});assert.ok(browser);
    await browser.command('Page.enable');await browser.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{globalThis.__mediaUrls=new Set();globalThis.__mediaBlobs=new Map();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);globalThis.__mediaUrls.add(url);globalThis.__mediaBlobs.set(url,blob);return url;};URL.revokeObjectURL=url=>{globalThis.__mediaUrls.delete(url);globalThis.__mediaBlobs.delete(url);revoke(url);};globalThis.__mediaReads=[];globalThis.__metadataFailure=location.pathname.endsWith("+JSON.stringify(ticketId)+");const original=fetch;globalThis.fetch=async(url,options)=>{if(String(url).includes('/web-report/media/'))globalThis.__mediaReads.push(String(url));const response=await original(url,options);if(globalThis.__metadataFailure&&String(url).endsWith('/attachments')){globalThis.__metadataFailure=false;await response.arrayBuffer();return new Response(JSON.stringify({error:{code:'TEMPORARY_TEST_READ_FAILURE',retryable:true}}),{status:503,headers:{'content-type':'application/json'}});}return response;};})()"});
    await browser.command('Page.reload');await browser.waitFor("document.querySelectorAll('.detail-media-card').length===2&&document.querySelector('.detail-voice')!==null");
    const active=browser,click=(selector:string)=>clickWorkbenchControl(active,selector);
    await click('.detail-media-card:has(.media-video-play)');await browser.waitFor("document.querySelector('.detail-media-dialog[role=dialog]')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})===true&&document.querySelector('.detail-media-dialog video')?.readyState>=2&&document.querySelector('.detail-media-dialog video')?.videoWidth>0");
    const pendingVideoUrl=string(await browser.evaluate("document.querySelector('.detail-media-dialog video').src"));
    const pendingVideoRead=string(await browser.evaluate("globalThis.__mediaReads.filter(value=>new URL(value,location.href).searchParams.get('variant')==='ORIGINAL').at(-1)")),videoPath=new URL(pendingVideoRead,origin).pathname;
    assert.equal(await browser.evaluate("(async()=>{const bytes=await globalThis.__mediaBlobs.get(document.querySelector('.detail-media-dialog video').src).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');})()"),createHash('sha256').update(originalVideo).digest('hex'),'pending video previews the exact original before conversion runs');
    await click('.media-download');await browser.waitFor("document.querySelector('[data-toast-source=attachments]')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})===true&&document.querySelector('[data-toast-source=attachments]')?.textContent.includes('已交给浏览器下载')");
    let downloaded:Buffer|undefined;const deadline=Date.now()+5000;while(Date.now()<deadline){try{downloaded=await readFile(join(downloads,'report-material.mp4'));break;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}
    assert.deepEqual(downloaded,originalVideo,'pending video keeps its exact original download available');
    await click('[aria-label="关闭附件预览"]');await browser.waitFor("!document.querySelector('.detail-media-dialog')&&!globalThis.__mediaUrls.has("+JSON.stringify(pendingVideoUrl)+")");await ready();
    await browser.waitFor("document.querySelector('.detail-media-card:not(:has(.media-video-play)) img')?.naturalWidth>0&&document.querySelector('.media-retry')?.disabled===false");
    const imageBefore=await browser.evaluate("document.querySelector('.detail-media-card:not(:has(.media-video-play)) img').src");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.media-refresh'))||document.body.innerText.includes('网页报修资料')"),false);
    assert.equal(await browser.evaluate("document.querySelectorAll('.report-materials').length"),1);
    await click('.media-retry');
    assert.equal(await browser.evaluate("document.querySelector('.detail-media-card:not(:has(.media-video-play)) img').src"),imageBefore,'refresh retains the already displayed image URL');
    await browser.waitFor("[...document.querySelectorAll('.detail-media-card img')].filter(img=>img.naturalWidth>0).length===2&&document.querySelector('.voice-play')?.disabled===false");
    assert.equal(await browser.evaluate(`globalThis.__mediaReads.some(url=>url.includes(${JSON.stringify(voiceRef)}))`),false,'voice is not fetched before user playback');
    await click('.voice-play');await browser.waitFor("document.querySelector('.detail-voice audio')?.paused===false&&document.querySelector('.detail-voice audio')?.currentTime>0");
    await click('.voice-play');assert.equal(await browser.evaluate("document.querySelector('.detail-voice audio').paused"),true);
    const slider='.voice-progress [data-slot=slider-thumb] input[type=range]';
    await browser.waitFor('document.querySelector('+JSON.stringify(slider)+')?.disabled===false');
    await browser.evaluate('document.querySelector('+JSON.stringify(slider)+').focus()');
    assert.equal(await browser.evaluate('document.activeElement===document.querySelector('+JSON.stringify(slider)+')'),true,'keyboard targets the actual HeroUI range input');
    for(const key of ['Home',...Array.from({length:25},()=> 'ArrowRight')]){const keyCode=key==='Home'?36:39;for(const type of ['rawKeyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});}
    await browser.waitFor("document.querySelector('.detail-voice audio').paused===true&&Math.abs(document.querySelector('.detail-voice audio').currentTime-2.5)<0.02&&Number(document.querySelector('.voice-progress input[type=range]').value)===2.5&&document.querySelector('[aria-label=\"语音剩余时长\"]').textContent==='00:02'");
    const voiceUrl=string(await browser.evaluate("document.querySelector('.detail-voice audio').src")),playableReadStart=Number(await browser.evaluate('globalThis.__mediaReads.length'));
    await click('.detail-media-card:has(.media-video-play)');await browser.waitFor("document.querySelector('.detail-media-dialog[role=dialog]')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})===true&&document.querySelector('.detail-media-dialog video')?.readyState>=2&&document.querySelector('.detail-media-dialog video')?.videoWidth>0");
    assert.equal(await browser.evaluate('globalThis.__mediaReads.slice('+playableReadStart+').some(value=>{const url=new URL(value,location.href);return url.pathname==='+JSON.stringify(videoPath)+'&&url.searchParams.get("variant")==="PLAYABLE";})'),true,'after conversion the same video previews its playable copy');
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-voice audio'))||globalThis.__mediaUrls.has("+JSON.stringify(voiceUrl)+")"),false,'opening video releases the former voice element and Blob URL');
    const playableVideoUrl=string(await browser.evaluate("document.querySelector('.detail-media-dialog video').src"));
    await click('[aria-label="关闭附件预览"]');await browser.waitFor("!document.querySelector('.detail-media-dialog')&&!globalThis.__mediaUrls.has("+JSON.stringify(playableVideoUrl)+")");
    await click('.detail-media-card:not(:has(.media-video-play))');await browser.waitFor("document.querySelector('.detail-media-dialog img')?.naturalWidth>0");
    await click('[aria-label="关闭附件预览"]');
    await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'detail-media-390.png');await writeFile(file,pixels);
    await click('[aria-label="关闭详情"]');await browser.waitFor("!document.querySelector('#detail-title')&&globalThis.__mediaUrls.size===0&&globalThis.__mediaBlobs.size===0");
    await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+emptyTicketId+'?detail=page'});await browser.waitFor("document.querySelector('.media-empty')?.textContent.includes('没有可读取的已保存附件')");assert.equal(await browser.evaluate("document.querySelector('.detail-attachments').textContent.includes('存储暂不可用')"),false,'a valid empty H5 report does not inherit the disabled legacy store warning');
    console.log('WORKBENCH_DETAIL_MEDIA '+JSON.stringify({pending_original_preview:true,pending_original_download:true,image_preview:true,video_preview:true,voice_play_pause_seek_countdown:true,voice_lazy:true,blob_urls_after_close:0,screenshots:[{file,sha256:createHash('sha256').update(pixels).digest('hex')}]}));
  }catch(error){
    failure=error;
    if(browser)try{
      console.log('H5_FLOW_DETAIL_MEDIA_DIAGNOSTIC '+JSON.stringify(await browser.evaluate("({path:location.pathname,detailPresent:Boolean(document.querySelector('#detail-title')),previewPresent:Boolean(document.querySelector('.detail-media-dialog')),urlCount:globalThis.__mediaUrls?.size,blobCount:globalThis.__mediaBlobs?.size,blobKinds:[...(globalThis.__mediaBlobs?.values()??[])].map(blob=>({type:blob.type,bytes:blob.size}))})")));
      await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));
      await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href,mediaReads:globalThis.__mediaReads})')));
    }catch(diagnostic){failure=new AggregateError([error,diagnostic],'H5_FLOW_MEDIA_FAILURE_OBSERVATION');}
  }
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
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
      // Exercise the production detail with actual encrypted image, voice and video sources.
      const videoFile=join(root,'synthetic-detail.mp4');
      await promisify(execFile)(ffmpegPath,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','2','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',videoFile],{timeout:20_000,windowsHide:true});
      const galleryRefs:string[]=[];
      for(const material of [{kind:'IMAGE',mime:'image/png',bytes:PNG,duration:null},{kind:'VOICE',mime:'audio/wav',bytes:wave(64000),duration:4000},{kind:'VIDEO',mime:'video/mp4',bytes:await readFile(videoFile),duration:2000}]){
        const reserved=await a.post('/api/yixiaoxiu/media/uploads',{schema_version:1,client_command_id:randomUUID(),kind:material.kind,mime_type:material.mime,byte_size:material.bytes.length,duration_ms:material.duration});assert.equal(reserved.status,201,JSON.stringify(reserved.body));
        const ref=string(reserved.body.media_ref),uploaded=await a.send('/api/yixiaoxiu/media/uploads/'+ref+'/content',{method:'PUT',commandId:randomUUID(),contentType:material.mime,body:material.bytes});assert.equal(uploaded.status,200,JSON.stringify(uploaded.body));galleryRefs.push(ref);
      }
      const gallery=await a.post('/api/yixiaoxiu/requests',{schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:'合成详情媒体检查：图片、语音和视频来自同一报修。',location:{text:'合成门诊 203',unknown:false},media_refs:galleryRefs});assert.equal(gallery.status,202,JSON.stringify(gallery.body));
      const galleryRequest=string(record(gallery.body.receipt).request_ref);
      await worker.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},now_epoch_ms:String(Date.now()+15000),batch_size:5});
      const galleryTicket=(await pool.query<{id:string}>('SELECT t.id::text FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=$1',[galleryRequest])).rows[0];assert.ok(galleryTicket);
      const emptyTicket=tickets.rows.find(row=>row.request_ref===contactRef);assert.ok(emptyTicket&&galleryRefs[1]);await verifyDetailMedia(base,galleryTicket.id,staffCookies[0],async()=>{await mediaWorker.runOnce();await mediaWorker.runOnce();},galleryRefs[1],await readFile(videoFile),emptyTicket.id);
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
      const originalReportTime=(await staff.get('/api/workbench/items/ticket/'+ticket.id)).body.reported_at;assert.equal(typeof originalReportTime,'string');
      const supplemented=await a.post('/api/yixiaoxiu/requests/'+requestRef+'/supplements',{schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'实际合成补充材料：首次收到报修的时间应保持不变。'});assert.equal(supplemented.status,202,JSON.stringify(supplemented.body));
      const supplementedDetail=await staff.get('/api/workbench/items/ticket/'+ticket.id);assert.equal(supplementedDetail.status,200);assert.equal(supplementedDetail.body.reported_at,originalReportTime);
      memberUnavailable=true;assert.equal((await a.get('/api/yixiaoxiu/bootstrap')).status,503,'Provider outage must not become revocation');memberUnavailable=false;
      assert.equal((await a.get('/api/yixiaoxiu/bootstrap')).status,200);visible.delete('h5-open-a');assert.equal((await a.get('/api/yixiaoxiu/requests/'+requestRef)).status,403);
      assert.equal((await pool.query<{n:number}>('SELECT count(*)::integer AS n FROM channel.message_inbox')).rows[0]?.n,0);assert.equal((await pool.query<{n:number}>('SELECT count(*)::integer AS n FROM conversation.session')).rows[0]?.n,0);
      assert.equal(providerPaths.includes('/cgi-bin/message/send'),false);assert.equal(providerPaths.includes('/cgi-bin/batch/userid_to_openuserid'),false);
      assert.ok(providerPaths.includes('/cgi-bin/media/get'));assert.ok(providerPaths.includes('/cgi-bin/get_jsapi_ticket'));
    }finally{await mediaWorker.close();await worker.stop();await runtime.stop();assert.equal(runtime.server.listening,false);assert.deepEqual(mediaWorker.media?.ownedResourceState(),{active:0,plaintext_bytes:0});}
  }});}finally{key.fill(0);await rm(root,{recursive:true,force:true});}
});
