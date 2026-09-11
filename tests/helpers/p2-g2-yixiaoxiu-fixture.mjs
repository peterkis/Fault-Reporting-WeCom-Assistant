import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {withP2012Database,applyThrough031} from './p2-012-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from '../../src/p1-006-ticket-state-actions.mjs';
import {createP2016ReporterAccess} from '../../src/p2-016-reporter-access.mjs';
import {createP2016TicketNotificationProjector} from '../../src/p2-016-ticket-notification-projector.mjs';
import {transactionP2016} from '../../src/p2-016-domain-contracts.mjs';

export const entryOrigin='https://entry.test';
export const entryConfig=Object.freeze({enabled:true,corpId:'synthetic-corp',agentId:'1000002',botId:'bot-test',
  identityMode:'VERIFIED_SAME_NAMESPACE',memberIdsConfirmed:true,proofRef:'tests/synthetic-identity-correspondence',
  proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'});
export const entryKey='synthetic-only-yxx-reporter-hmac-key-32-bytes';
export async function withYxxDatabase(run,{grantTtlMs=1800000}={}){
  return withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'yxxentry',run:async context=>{
    await applyThrough031(context);await migrateP2012({databaseUrl:context.databaseUrl});
    let epoch=String(Date.now());
    const access=createP2016ReporterAccess({pool:context.pool,enabled:true,hmacSecret:entryKey,now:()=>epoch,grantTtlMs});
    const notifications=createP2016TicketNotificationProjector({pool:context.pool,enabled:true,cardEnabled:true,reporterAccess:access,additionalEventTypes:['ticket.created']});
    async function seed(reporter='synthetic-A',bot='bot-test',chatType='single'){
      const input=await seedPersistedIntake({pool:context.pool,text:'HIS无法登录 synthetic-private-note',requestType:'INCIDENT',status:'RECEIVED',chatType});
      // Fixture identities are synthetic and this pool belongs to the newly created private database.
      await context.pool.query('UPDATE intake.service_intake SET reporter_wecom_userid=$2,source_bot_id=$3 WHERE id=$1::uuid',[input.intakeId,reporter,bot]);
      const ticket=(await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:input.intakeId,occurredAt:input.receivedAt,traceId:'synthetic-yxx-entry'})).ticket;
      const notification=await transactionP2016(context.pool,async tx=>{
        const event=await appendTicketEvent({transaction:tx,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'synthetic-yxx-entry'});
        return notifications.project({transaction:tx,ticket,event});
      });
      return {ticket,intake:input,grant:await access.deliveryGrant({deliveryId:notification.delivery_id}),deliveryId:notification.delivery_id};
    }
    return run({...context,access,seed,setGrantClock:value=>{epoch=value;}});
  }});
}
export async function listenYxx(server){server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
export async function stopYxx(server){await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});}
export function httpBrowser(base){
  const cookies=new Map();
  return {cookies,async request(path,options={}){
    const response=await new Promise((resolve,reject)=>{
      const outgoing=httpRequest(base,{path,method:options.method??'GET',headers:{host:new URL(entryOrigin).host,
        ...(cookies.size?{cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...options.headers}},incoming=>{
        const chunks=[];incoming.on('data',c=>chunks.push(c));incoming.on('error',reject);incoming.on('end',()=>{
          const headers=new Headers();for(let i=0;i<incoming.rawHeaders.length;i+=2)headers.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
          resolve(new Response([204,304].includes(incoming.statusCode)?null:Buffer.concat(chunks),{status:incoming.statusCode,headers}));
        });
      });outgoing.on('error',reject);outgoing.setTimeout(10000,()=>outgoing.destroy(new Error('YXX_TEST_HTTP_TIMEOUT')));outgoing.end(options.body);
    });
    for(const item of response.headers.getSetCookie()){
      const pair=item.split(';')[0],split=pair.indexOf('='),name=pair.slice(0,split),value=pair.slice(split+1);
      if(/Max-Age=0(?:;|$)/u.test(item))cookies.delete(name);else cookies.set(name,value);
    }
    return response;
  }};
}
export async function loginYxx(browser,{path='/wecom/yixiaoxiu/login',code='synthetic-A-code'}={}){
  const start=await browser.request(path);assert.equal(start.status,302);
  const url=new URL(start.headers.get('location'));
  const response=await browser.request('/wecom/yixiaoxiu/callback?code='+encodeURIComponent(code)+'&state='+url.searchParams.get('state'));
  assert.equal(response.status,303);return response.headers.get('location');
}
export async function businessDigest(pool){
  const tables=(await pool.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('pilot_ticket','intake','channel','conversation','incident','communication') AND tablename<>'reporter_access_event' ORDER BY schemaname,tablename")).rows;
  const digest={};for(const {schemaname,tablename} of tables){
    const q=await pool.query('SELECT to_jsonb(t)::text AS row FROM "'+schemaname+'"."'+tablename+'" t ORDER BY to_jsonb(t)::text');
    digest[schemaname+'.'+tablename]=createHash('sha256').update(JSON.stringify(q.rows)).digest('hex');
  }return digest;
}
