// Integration target: tests/workbench-actor-avatars.test.mts. Root owns build/run.
import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import sharp from 'sharp';
import {actorAvatarSchemaReady,createWorkbenchActorAvatarHttp,createWorkbenchActorAvatarWorker,trustedActorAvatarUrl} from '../app/server/src/workbench-actor-avatars.mjs';
import {createWeb01WorkbenchQuery} from '../app/server/src/web01-workbench-query.mjs';
import {createWeComWorkbenchAuthentication} from '../app/server/src/p2-016-workbench-wecom-auth.mjs';
import type {PostgresTransaction,PostgresQueryRow} from '../app/server/src/platform/postgres-pool.mjs';
import type {WorkbenchHttpAuthContext} from '../app/server/src/p2-006-workbench-http.mjs';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {T16_PNG} from './helpers/wbint-t16-fixture.mjs';

const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const safeImageUrl='https://wx.qlogo.cn/synthetic-avatar/test.png';
function gate(){let open=()=>{};const wait=new Promise<void>(resolve=>{open=resolve;});return {open,wait};}
function statusIs(status:number){return (error:unknown)=>Boolean(error&&typeof error==='object'&&'status' in error&&error.status===status);}
type Handler=ReturnType<typeof createWorkbenchActorAvatarHttp>;
async function invoke(handler:Handler,authContext:WorkbenchHttpAuthContext,path:string){
  const socket=new Socket(),request=new IncomingMessage(socket);request.method='GET';request.url=path;
  const response=new ServerResponse(request);let bytes:Buffer|null=null;
  const end=mock.method(response,'end',(body:unknown)=>{if(Buffer.isBuffer(body))bytes=Buffer.from(body);return response;});
  try{
    const handled=await handler({request,response,url:new URL(path,'https://avatar.example.test'),authContext,
      readJson:async()=>{throw Error('UNEXPECTED_JSON_READ');},validateWriteRequest:()=>{throw Error('UNEXPECTED_WRITE');},json:()=>{throw Error('UNEXPECTED_JSON_RESPONSE');}});
    return {handled,status:response.statusCode,bytes};
  }finally{end.mock.restore();response.destroy();socket.destroy();}
}

test('actor image URL admits exact HTTPS CDN hosts and refuses redirects to arbitrary identities',()=>{
  assert.equal(trustedActorAvatarUrl(safeImageUrl)?.hostname,'wx.qlogo.cn');
  for(const value of [null,42,'http://wx.qlogo.cn/a','https://wx.qlogo.cn.attacker.test/a','https://attacker.test/?host=wx.qlogo.cn',
    'https://127.0.0.1/a','https://[::1]/a','https://169.254.169.254/latest/meta-data','https://name:password@wx.qlogo.cn/a',
    'https://wx.qlogo.cn:8443/a','https://wx.qlogo.cn/a#fragment','data:image/png;base64,a','https://wx.qlogo.cn/'+ 'a'.repeat(2048)])assert.equal(trustedActorAvatarUrl(value),null);
});

test('disabled avatar worker performs no database or Provider work',async()=>{
  const pool:PostgresTransaction={query:async()=>{throw Error('UNEXPECTED_DATABASE');}};
  const worker=createWorkbenchActorAvatarWorker({pool,rootRef:'',keyProvider:()=>{throw Error('UNEXPECTED_KEY');},fetchImpl:async()=>{throw Error('UNEXPECTED_FETCH');}});
  assert.deepEqual(await worker.runOnce(),{processed:false});await worker.close();assert.deepEqual(await worker.runOnce(),{processed:false});
});

test('actor cache, original Ticket READ, official Session and bounded Worker behavior',{timeout:180_000},async t=>{
  await withDetailRestructureFixture(async f=>{
    const actor=f.principals[0],ticket=f.tickets[0],cookie=f.cookies[0];assert.ok(actor&&ticket&&cookie);
    const people=(await f.pool.query<{id:string;wecom_user_id:string}>('SELECT id::text,wecom_user_id FROM pilot_ticket.pilot_principal ORDER BY id')).rows;
    const person=people.find(p=>p.id===actor.id);assert.ok(person);
    const path='/api/workbench/items/ticket/'+ticket.ticket.id+'/actor-avatars/'+actor.id;
    const cards=createWeb01WorkbenchQuery({pool:f.pool,query:f.runtime.query,actorAvatarsEnabled:true});
    const calls={tree:0,detail:0,image:0};let mismatch=false,oversize=false;
    const providerFetch:typeof fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));assert.equal(init?.redirect,'error');assert.ok(init?.signal);
      if(url.hostname==='wx.qlogo.cn'){
        assert.equal(url.href,safeImageUrl);assert.equal(init?.method,'GET');calls.image++;
        return new Response(oversize?new Uint8Array(512*1024+1):new Uint8Array(T16_PNG),{headers:{'content-type':'image/png'}});
      }
      assert.equal(url.origin,'https://rd-api.mobimedical.cn');assert.equal(init?.method,'POST');
      const form=new URLSearchParams(String(init?.body));
      if(url.pathname.endsWith('/getToken')){assert.equal(form.get('key'),'synthetic-avatar-key');return Response.json({result:'TRUE',data:{token:'synthetic-token'}});}
      assert.equal(form.get('token'),'synthetic-token');
      if(url.pathname.endsWith('/getOrganizationTree')){
        assert.equal(form.get('parent_id'),'synthetic-hospital');calls.tree++;
        return Response.json({result:'TRUE',data:[{id:'synthetic-hospital',name:'Synthetic hospital',users:people.map((p,index)=>({user_id:'provider-'+index,tuishiben_id:'employee-'+index,nickname:'Synthetic '+index})),children:[]}]});
      }
      assert.ok(url.pathname.endsWith('/getUserInfo'));calls.detail++;
      const index=people.findIndex(p=>p.wecom_user_id===form.get('uid'));
      if(index<0)return Response.json({result:'FALSE'});
      return Response.json({result:'TRUE',data:{user_id:'provider-'+index,employee_id:mismatch?'wrong-employee':'employee-'+index,nickname:'Synthetic '+index,avatar:safeImageUrl}});
    };
    const workerOptions={pool:f.pool,keyProvider:()=> 'synthetic-avatar-key',rootRef:'synthetic-hospital',fetchImpl:providerFetch,enabled:true};
    const cooldown=async()=>{
      for(const p of people)await f.pool.query(`INSERT INTO workbench.actor_avatar_cache(principal_id,identity_hash,status,error_code,attempted_epoch_ms,expires_epoch_ms)
        VALUES($1,$2,'UNAVAILABLE','ACTOR_AVATAR_TEST_COOLDOWN',platform.physical_epoch_ms(),platform.physical_epoch_ms()+300000)
        ON CONFLICT(principal_id) DO NOTHING`,[p.id,digest(p.wecom_user_id)]);
    };
    const expire=()=>f.pool.query('UPDATE workbench.actor_avatar_cache SET attempted_epoch_ms=platform.physical_epoch_ms()-600001,expires_epoch_ms=platform.physical_epoch_ms()-1 WHERE principal_id=$1',[actor.id]);
    const cached=async()=>{
      const value=(await f.pool.query<{status:string;avatar_bytes:Buffer|null;avatar_sha256:string|null;identity_hash:string;error_code:string|null;ttl:string}>('SELECT status,avatar_bytes,avatar_sha256,identity_hash,error_code,(expires_epoch_ms-attempted_epoch_ms)::text AS ttl FROM workbench.actor_avatar_cache WHERE principal_id=$1',[actor.id])).rows[0];assert.ok(value);return value;
    };
    await cooldown();await f.pool.query('DELETE FROM workbench.actor_avatar_cache WHERE principal_id=$1',[actor.id]);

    await t.test('successful normalization is single-flight and persistent for 24 hours',async()=>{
      const worker=createWorkbenchActorAvatarWorker(workerOptions);
      try{
        const first=worker.runOnce(),second=worker.runOnce();assert.equal(first,second);assert.deepEqual(await first,{processed:true});
        const image=await cached();assert.equal(image.status,'READY');assert.equal(image.ttl,'86400000');assert.ok(image.avatar_bytes);
        assert.equal(image.identity_hash,digest(person.wecom_user_id));assert.equal(image.avatar_sha256,digest(image.avatar_bytes));assert.ok(image.avatar_bytes.length<=32768);
        const metadata=await sharp(image.avatar_bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,64);assert.equal(metadata.height,64);
        assert.deepEqual(await worker.runOnce(),{processed:false});assert.deepEqual(calls,{tree:1,detail:1,image:1});
        const response=await fetch(f.origin+path,{headers:{cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
        assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),image.avatar_bytes);
        const stranger=await fetch(f.origin+path.replace(actor.id,f.outsider.id),{headers:{cookie}});assert.equal(stranger.status,204);assert.equal((await stranger.arrayBuffer()).byteLength,0);
      }finally{await worker.close();}
      const restarted=createWorkbenchActorAvatarWorker(workerOptions);try{assert.deepEqual(await restarted.runOnce(),{processed:false});assert.deepEqual(calls,{tree:1,detail:1,image:1});}finally{await restarted.close();}
    });

    const auth=createWeComWorkbenchAuthentication({pool:f.pool,publicOrigin:'https://avatar.example.test',corpId:'synthetic-corp',agentId:'100001',identityHashKey:'synthetic-avatar-auth-key',accessTokenProvider:async()=> 'synthetic-auth-token',fetchImpl:async(input,init)=>{
      const url=new URL(String(input));assert.equal(url.hostname,'qyapi.weixin.qq.com');assert.ok(url.pathname.endsWith('/userid_to_openuserid'));
      const body:unknown=JSON.parse(String(init?.body));assert.ok(body&&typeof body==='object'&&'userid_list' in body&&Array.isArray(body.userid_list));
      return Response.json({errcode:0,open_userid_list:body.userid_list.map((userid:unknown)=>{assert.equal(typeof userid,'string');return {userid,open_userid:'open-'+String(userid)};})});
    }});
    try{
      await auth.initialize();const sessionId=randomUUID(),expires=String(Date.now()+600000);
      await f.pool.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO pilot_ticket.workbench_auth_session
        (session_id,session_token_hash,csrf_token_hash,principal_id,identity_hash,state,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_at,expires_epoch_ms)
        SELECT $1,$2,$3,$4,$5,'ACTIVE',platform.local_from_epoch_ms(epoch),epoch,platform.local_from_epoch_ms(epoch),epoch,platform.local_from_epoch_ms($6),$6 FROM stamp`,
      [sessionId,digest('session-'+sessionId),digest('csrf-'+sessionId),actor.id,digest(person.wecom_user_id),expires]);
      const authContext={principal_id:actor.id,auth_method:'COOKIE' as const,session_id:sessionId,expires_epoch_ms:expires};
      const make=(query:Pick<typeof cards,'authorizedItem'>=cards,pool:PostgresTransaction=f.pool)=>createWorkbenchActorAvatarHttp({pool,query,enabled:true,currentSessionPredicate:auth.currentSessionPredicate});

      await t.test('non-Ticket aliases fail before resolving a canonical Ticket',async()=>{
        const handler=make({authorizedItem:async()=>{throw Error('ALIAS_MUST_NOT_RESOLVE');}});
        for(const kind of ['review','intake'])await assert.rejects(invoke(handler,authContext,path.replace('/ticket/','/'+kind+'/')),statusIs(404));
      });
      await t.test('a session revoked during the last item wait cannot disclose cached bytes',async()=>{
        let reads=0;const handler=make({authorizedItem:async(...args)=>{const item=await cards.authorizedItem(...args);if(++reads===2)await f.pool.query("WITH stamp AS MATERIALIZED(SELECT platform.physical_epoch_ms() AS epoch) UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=stamp.epoch,revoked_at=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE session_id=$1",[sessionId]);return item;}});
        try{await assert.rejects(invoke(handler,authContext,path),statusIs(401));assert.equal(reads,2);}
        finally{await f.pool.query("UPDATE pilot_ticket.workbench_auth_session SET state='ACTIVE',revoked_at=NULL,revoked_epoch_ms=NULL WHERE session_id=$1",[sessionId]);}
      });
      await t.test('an actor identity changed during the last item wait cannot inherit the old photograph',async()=>{
        let reads=0;const handler=make({authorizedItem:async(...args)=>{const item=await cards.authorizedItem(...args);if(++reads===2)await f.pool.query('UPDATE pilot_ticket.pilot_principal SET wecom_user_id=$2 WHERE id=$1',[actor.id,'synthetic-new-owner']);return item;}});
        try{const response=await invoke(handler,authContext,path);assert.equal(response.status,204);assert.equal(response.bytes,null);}
        finally{await f.pool.query('UPDATE pilot_ticket.pilot_principal SET wecom_user_id=$2 WHERE id=$1',[actor.id,person.wecom_user_id]);}
      });
      await t.test('READ uses current roles after the final principal lookup wait',async()=>{
        const roles=(await f.pool.query<{role:string}>('SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1',[actor.id])).rows;
        const teams=(await f.pool.query<{team_id:string}>('SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=$1',[actor.id])).rows;let changed=false;
        const delayed:PostgresTransaction={async query<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[]){
          const result=await f.pool.query<R>(sql,values);
          if(!changed&&sql.includes('FROM pilot_ticket.pilot_principal AS p')){changed=true;await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1',[actor.id]);await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1,'HANDLER')",[actor.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1',[actor.id]);}
          return result;
        }};
        try{await assert.rejects(invoke(make(cards,delayed),authContext,path),statusIs(404));assert.equal(changed,true);}
        finally{await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1',[actor.id]);for(const r of roles)await f.pool.query('INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1,$2)',[actor.id,r.role]);for(const team of teams)await f.pool.query('INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.id,team.team_id]);}
      });
    }finally{await auth.close();}

    await t.test('directory employee mismatch and oversize image retain only five-minute failure cache',async()=>{
      for(const mode of ['mismatch','oversize'] as const){
        mismatch=mode==='mismatch';oversize=mode==='oversize';await expire();const before=calls.image,worker=createWorkbenchActorAvatarWorker(workerOptions);
        try{assert.deepEqual(await worker.runOnce(),{processed:true});const failed=await cached();assert.equal(failed.status,'UNAVAILABLE');assert.equal(failed.avatar_bytes,null);assert.equal(failed.avatar_sha256,null);assert.equal(failed.ttl,'300000');
          assert.equal(failed.error_code,mode==='mismatch'?'ACTOR_AVATAR_IDENTITY_MISMATCH':'ACTOR_AVATAR_IMAGE_OVERSIZED');if(mode==='mismatch')assert.equal(calls.image,before);
          const requestCount=calls.detail;assert.deepEqual(await worker.runOnce(),{processed:false});assert.equal(calls.detail,requestCount);
        }finally{await worker.close();}
      }
      mismatch=false;oversize=false;
    });
    await t.test('identity or staff-role changes during image download prevent a refreshed cache write',async()=>{
      const roles=(await f.pool.query<{role:string}>('SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1',[actor.id])).rows;
      for(const change of ['identity','role'] as const){
        await expire();const previous=await cached(),entered=gate(),resume=gate();
        const delayedFetch:typeof fetch=async(input,init)=>{
          const response=await providerFetch(input,init),url=new URL(input instanceof Request?input.url:String(input));
          if(url.hostname==='wx.qlogo.cn'){entered.open();await resume.wait;}
          return response;
        };
        const worker=createWorkbenchActorAvatarWorker({...workerOptions,fetchImpl:delayedFetch}),pending=worker.runOnce();
        try{
          await Promise.race([entered.wait,pending.then(()=>{throw Error('AVATAR_DOWNLOAD_SEAM_NOT_REACHED');})]);
          if(change==='identity')await f.pool.query('UPDATE pilot_ticket.pilot_principal SET wecom_user_id=$2 WHERE id=$1',[actor.id,'synthetic-avatar-rebound']);
          else await f.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1 AND role IN ('ADMIN','DISPATCHER','HANDLER')",[actor.id]);
          resume.open();await pending;
          if(change==='identity')assert.deepEqual(await cached(),previous,'a new external identity must not receive the old in-flight profile');
          else assert.equal((await f.pool.query('SELECT 1 FROM workbench.actor_avatar_cache WHERE principal_id=$1',[actor.id])).rowCount,0,'a no-longer-staff principal must be removed from the cache');
        }finally{
          resume.open();await worker.close();
          await f.pool.query('UPDATE pilot_ticket.pilot_principal SET wecom_user_id=$2 WHERE id=$1',[actor.id,person.wecom_user_id]);
          for(const role of roles)await f.pool.query('INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.id,role.role]);
          await cooldown();
        }
      }
    });
    await t.test('close while the initial database selection waits starts no Provider request',async()=>{
      await expire();const entered=gate(),resume=gate();let selected=false;
      const delayed:PostgresTransaction={async query<R extends PostgresQueryRow=Record<string,unknown>>(sql:string,values?:unknown[]){const result=await f.pool.query<R>(sql,values);if(!selected){selected=true;entered.open();await resume.wait;}return result;}};
      const before={...calls},worker=createWorkbenchActorAvatarWorker({...workerOptions,pool:delayed}),pending=worker.runOnce();
      try{await entered.wait;const closing=worker.close();resume.open();await closing;assert.deepEqual(await pending,{processed:false});assert.deepEqual(calls,before);}
      finally{resume.open();await worker.close();}
    });
    await t.test('schema readiness rejects a missing cache column despite a present migration marker',async()=>{
      assert.equal(await actorAvatarSchemaReady(f.pool),true);const client=await f.pool.connect();
      try{await client.query('BEGIN');await client.query('ALTER TABLE workbench.actor_avatar_cache RENAME COLUMN avatar_bytes TO missing_avatar_bytes');assert.equal(await actorAvatarSchemaReady(client),false);}
      finally{await client.query('ROLLBACK');client.release();}
    });
    await t.test('more than 256 eligible staff still refresh and lost roles are pruned below the cap',async()=>{
      const added=await f.pool.query<{id:string;wecom_user_id:string}>(`INSERT INTO pilot_ticket.pilot_principal(wecom_user_id,display_name,is_active)
        SELECT 'synthetic-avatar-capacity-'||n,'Synthetic capacity '||n,true FROM generate_series(1,260) n RETURNING id::text,wecom_user_id`);
      for(const p of added.rows)await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1,'HANDLER')",[p.id]);
      for(const p of added.rows)await f.pool.query(`INSERT INTO workbench.actor_avatar_cache(principal_id,identity_hash,status,error_code,attempted_epoch_ms,expires_epoch_ms)
        VALUES($1,$2,'UNAVAILABLE','ACTOR_AVATAR_TEST_COOLDOWN',platform.physical_epoch_ms(),platform.physical_epoch_ms()+300000)`,[p.id,digest(p.wecom_user_id)]);
      assert.ok(Number((await f.pool.query<{n:string}>('SELECT count(*)::text AS n FROM workbench.actor_avatar_cache')).rows[0]?.n)>256);
      await expire();const worker=createWorkbenchActorAvatarWorker(workerOptions);
      try{
        assert.deepEqual(await worker.runOnce(),{processed:true});assert.equal((await cached()).status,'READY');
        assert.equal((await f.pool.query<{n:string}>('SELECT count(*)::text AS n FROM workbench.actor_avatar_cache')).rows[0]?.n,'256');
        await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1',[actor.id]);await worker.runOnce();
        assert.equal((await f.pool.query('SELECT 1 FROM workbench.actor_avatar_cache WHERE principal_id=$1',[actor.id])).rowCount,0);
        assert.ok(Number((await f.pool.query<{n:string}>('SELECT count(*)::text AS n FROM workbench.actor_avatar_cache')).rows[0]?.n)<=256);
      }finally{await worker.close();}
    });
  },{actorAvatarsEnabled:true});
});
