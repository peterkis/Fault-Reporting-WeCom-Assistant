import {createPostgresPool} from '../../src/platform/postgres-pool.mjs';
import {createWeComWebOAuth} from '../../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxProfile} from '../../src/p2-g2-yixiaoxiu-profile.mjs';
import {entryOrigin,entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';

if(typeof process.send!=='function')throw new Error('YXX_TEST_IPC_REQUIRED');
const db=new URL(process.env.PILOT_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(db.hostname)||!/^p2_015_yxxentry_[a-f0-9_]+$/u.test(db.pathname.slice(1)))throw new Error('YXX_TEST_ISOLATED_DB_REQUIRED');
const pool=createPostgresPool({connectionString:process.env.PILOT_DATABASE_URL,max:4,connectionTimeoutMillis:2000});
const oauth=createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>({userid:'synthetic-A'})});
const runtime=createYxxProfile({profile:'MEMBER_TICKET_READONLY',pool,oauth,publicOrigin:entryOrigin,reporterHmacSecret:entryKey,reporterMemberEntry:entryConfig});
let stopping;
const stop=()=>stopping??=(async()=>{await runtime.stop();await pool.end();process.disconnect?.();})();
process.on('message',message=>{if(message?.type==='stop')void stop();});process.once('disconnect',()=>void stop());
try{const {port}=await runtime.start();process.send({type:'ready',port});}catch{await stop();process.exitCode=1;}
