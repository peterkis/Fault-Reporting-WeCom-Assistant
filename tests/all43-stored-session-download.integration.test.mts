import {test} from 'node:test';
import assert from 'node:assert/strict';
import {get} from 'node:http';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,createHash,createCipheriv} from 'node:crypto';
import {crc32} from 'node:zlib';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createWorkbenchAttachmentStore} from '../src/workbench-attachment-store.mjs';
import {T16_PNG} from './helpers/wbint-t16-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Fixture={pool:PostgresPool;origin:string;backendOrigin:string;cookies:string[];browserCookies:{name:string;value:string}[];sessionId:string;principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string;messageId:string}}[]};
type Read={request:ClientRequest;response:IncomingMessage;first:Promise<void>;done:Promise<boolean>;size:()=>number};
function begin(url:string,cookie:string):Promise<Read>{return new Promise((resolve,reject)=>{
 const request=get(url,{headers:{cookie},agent:false},response=>{
  response.pause();let size=0,seen=false,finish=()=>{};const first=new Promise<void>(r=>{finish=r;}),done=new Promise<boolean>(r=>{response.once('end',()=>r(true));response.once('close',()=>r(false));response.once('error',()=>r(false));});
  response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(!seen){seen=true;response.pause();finish();}});resolve({request,response,first,done,size:()=>size});
 });request.once('error',reject);
});}
test('ALL43 official stored-session logout terminates a backpressured download without changing Principal or READ',{timeout:120000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'all43-session-assets-')),key=randomBytes(32),store=createWorkbenchAttachmentStore({root,key});let primary:unknown;
 try{
  await withWeb01Fixture(async(f:Fixture)=>{
   const ticket=f.tickets[0],principal=f.principals[0],cookie=f.cookies[0];assert.ok(ticket&&principal&&cookie);
   const content=Buffer.alloc(8*1024*1024,97);content.set(Buffer.from('comment\0'));const chunk=Buffer.alloc(content.length+12);chunk.writeUInt32BE(content.length);chunk.write('tEXt',4);content.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,chunk.length-4)),chunk.length-4);
   const bytes=Buffer.concat([T16_PNG.subarray(0,-12),chunk,T16_PNG.subarray(-12)]),asset={ref:randomUUID(),source_intake_id:ticket.intake.intakeId,source_message_id:ticket.intake.messageId,media_ref:'wmr_'+'a'.repeat(32),mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),retention_until_epoch_ms:String(Date.now()+300000),scan_status:'PASSED',classification:'INTERNAL'};
   await f.pool.query("UPDATE channel.message_inbox SET msg_type='image',normalized_message=jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('type','image','source_index',0,'download_ref',$2::text))),'quote',NULL) WHERE id=$1::bigint",[asset.source_message_id,asset.media_ref]);
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(asset)));const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);await writeFile(join(root,asset.ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]));await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,assets:[asset]}));
   const read=await begin(f.backendOrigin+'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id}),cookie);let error:unknown;
   try{
    assert.equal(read.response.statusCode,200);read.response.resume();await read.first;assert.equal(store.ownedResourceState().active,1);
    const csrf=f.browserCookies.find(row=>row.name==='__Host-wecom_workbench_csrf');assert.ok(csrf);
    const logout=await fetch(f.backendOrigin+'/workbench/logout',{method:'POST',headers:{cookie,origin:f.origin,'x-csrf-token':csrf.value}});assert.equal(logout.status,200);assert.deepEqual(await logout.json(),{logged_out:true});
    assert.equal((await f.pool.query("SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid",[f.sessionId])).rows[0]?.state,'REVOKED');
    assert.equal((await f.pool.query("SELECT 1 FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id WHERE p.id=$1::uuid AND p.is_active AND r.role='ADMIN'",[principal.id])).rowCount,1);
    assert.equal((await fetch(f.backendOrigin+'/api/lifecycle/bootstrap',{headers:{cookie}})).status,401);
    read.response.resume();const complete=await read.done;
    console.log('ALL43_STORED_SESSION_DOWNLOAD '+JSON.stringify({official_logout:200,session:'REVOKED',principal_admin_unchanged:true,complete,received:read.size(),total:bytes.length}));
    assert.equal(complete,false,'a revoked stored session must not finish remaining chunks');assert.ok(read.size()>0&&read.size()<bytes.length);
   }catch(failure){error=failure;}
   await closeBrowserTestResources([()=>{read.response.destroy();read.request.destroy();},async()=>{await read.done;}],error);
  },{realWorkbenchAuthentication:true,workbenchAttachmentsEnabled:true,attachmentStore:store});
 }catch(error){primary=error;}
 await closeBrowserTestResources([()=>store.close(),()=>{key.fill(0);assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});},()=>rm(root,{recursive:true,force:true})],primary);
});
