import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {get} from 'node:http';
import type {IncomingMessage,ClientRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {withT16Fixture,T16_PNG} from './helpers/wbint-t16-fixture.mjs';
async function until(check:()=>Promise<boolean>,budget=5000){const deadline=Date.now()+budget;while(Date.now()<deadline){if(await check())return;await delay(25);}assert.fail('owned resource did not reach the expected state');}
test('cancelled reads keep their sole admission while a real PostgreSQL source check remains unsettled',async()=>{
  await withT16Fixture(async({pool,origin,cookie,tickets,asset,store,runtime})=>{
    const ticket=tickets[0];assert.ok(ticket);const locker=await pool.connect(),first=new AbortController(),second=new AbortController();
    const path=origin+'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id});
    let pendingFirst:Promise<Response|null>|undefined,pendingSecond:Promise<Response|null>|undefined,secondResponse:Response|null=null,stopping:Promise<unknown>|undefined,stopped=false;
    const waiters=async()=>Number((await pool.query<{count:number}>("SELECT count(*)::integer AS count FROM pg_locks WHERE relation='intake.service_intake_message'::regclass AND NOT granted")).rows[0]?.count);
    try{
      await locker.query('BEGIN');await locker.query('LOCK TABLE intake.service_intake_message IN ACCESS EXCLUSIVE MODE');
      pendingFirst=fetch(path,{headers:{cookie},signal:first.signal}).catch(()=>null);await until(async()=>await waiters()===1);first.abort();await pendingFirst;
      pendingSecond=fetch(path,{headers:{cookie},signal:second.signal}).then(response=>{secondResponse=response;return response;}).catch(()=>null);
      await until(async()=>secondResponse!==null||await waiters()>1);
      assert.equal(await waiters(),1,'unfinished source validation must not admit a second source query');
      const response=await pendingSecond;assert.ok(response);assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:{code:'ATTACHMENT_BUSY',retryable:true}});
      stopping=runtime.stop().then(()=>{stopped=true;});await delay(50);assert.equal(stopped,false,'shutdown must wait for the unfinished source check');
    }finally{first.abort();second.abort();await locker.query('ROLLBACK');locker.release();await Promise.allSettled([pendingFirst,pendingSecond]);await stopping;}
    await until(async()=>await waiters()===0);assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  });
});
interface PausedRead {request:ClientRequest;response:IncomingMessage;first:Promise<void>;done:Promise<boolean>;size:()=>number}
function pausedRead(url:string,cookie:string):Promise<PausedRead>{return new Promise((resolve,reject)=>{
  const request=get(url,{headers:{cookie},agent:false},response=>{
    response.pause();let size=0,complete=false,seen=false,firstByte=()=>{};
    const first=new Promise<void>(r=>{firstByte=r;}),done=new Promise<boolean>(r=>{response.once('end',()=>{complete=true;r(true);});response.once('close',()=>r(complete));response.once('error',()=>r(false));});
    response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(!seen){seen=true;response.pause();firstByte();}});
    resolve({request,response,first,done,size:()=>size});
  });request.once('error',reject);
});}
test('real authenticated large-file backpressure preserves single reading, deadline and cleanup after revoke, disconnect and stop',async()=>{
  await withT16Fixture(async({pool,origin,cookie,tickets,asset,store,save,principals,runtime})=>{
    const ticket=tickets[0],principal=principals[0];assert.ok(ticket);assert.ok(principal);
    const text=Buffer.alloc(8*1024*1024,97);text.set(Buffer.from('comment\0'));const chunk=Buffer.alloc(text.length+12);chunk.writeUInt32BE(text.length);chunk.write('tEXt',4);text.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,chunk.length-4)),chunk.length-4);
    const bytes=Buffer.concat([T16_PNG.subarray(0,-12),chunk,T16_PNG.subarray(-12)]),record={...asset,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};await save([record],bytes);
    const url=origin+'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id}),owned:PausedRead[]=[];
    const begin=async()=>{const read=await pausedRead(url,cookie);owned.push(read);assert.equal(read.response.statusCode,200);read.response.resume();await read.first;assert.equal(store.ownedResourceState().active,1);return read;};
    const clean=()=>until(async()=>store.ownedResourceState().active===0&&store.ownedResourceState().handles===0&&store.ownedResourceState().plaintext_bytes===0&&pool.waitingCount===0&&pool.totalCount===pool.idleCount);
    try{
      const disconnect=await begin(),busy=await fetch(url,{headers:{cookie}});assert.equal(busy.status,429);await busy.arrayBuffer();disconnect.response.destroy();disconnect.request.destroy();await disconnect.done;await clean();
      console.log('T16_HTTP_RESOURCE '+JSON.stringify({boundary:'DISCONNECT_AND_SINGLE_READER',store:store.ownedResourceState(),waiting:pool.waitingCount}));
      const revoke=await begin();await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal.id]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[principal.id]);await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);
      revoke.response.resume();assert.equal(await revoke.done,false);assert.ok(revoke.size()>0&&revoke.size()<bytes.length);await clean();await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'ADMIN')",[principal.id]);
      console.log('T16_HTTP_RESOURCE '+JSON.stringify({boundary:'REVOKED_MID_STREAM',received:revoke.size(),total:bytes.length,store:store.ownedResourceState()}));
      const timed=await begin(),started=Date.now();await until(async()=>store.ownedResourceState().active===0,17_000);const elapsed=Date.now()-started;assert.ok(elapsed>=14_000&&elapsed<=17_000);timed.response.destroy();timed.request.destroy();await timed.done;await clean();
      console.log('T16_HTTP_RESOURCE '+JSON.stringify({boundary:'ORIGINAL_15_SECOND_DEADLINE',elapsed_ms:elapsed,store:store.ownedResourceState()}));
      const stop=await begin();await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal(await stop.done,false);await clean();
      console.log('T16_HTTP_RESOURCE '+JSON.stringify({boundary:'HOST_STOP',store:store.ownedResourceState(),waiting:pool.waitingCount}));
    }finally{for(const read of owned){read.response.destroy();read.request.destroy();}await Promise.allSettled(owned.map(read=>read.done));}
  });
});
