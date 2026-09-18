// Owned test process only. Never imported by a Runtime or enabled by a persistent flag.
import {createPostgresPool} from '../../src/platform/postgres-pool.mjs';
import {createYxxSelfServiceStore} from '../../src/yxx-self-service-store.mjs';
import {createYxxMemberCommandContext} from '../../src/yxx-self-service-command.mjs';
import {createYxxSelfServiceOrchestrator} from '../../src/yxx-self-service-orchestrator.mjs';
const base=createPostgresPool({connectionString:process.env.PILOT_DATABASE_URL,max:2,application_name:'ss009_owned_crash'});
base.on('error',()=>{});
let barrier=null;
const pause=async point=>{if(barrier!==point)return;barrier=null;process.send({type:'barrier',point});await new Promise(()=>{});};
const pool={query:base.query.bind(base),async connect(){const c=await base.connect();return {release:()=>c.release(),async query(sql,...args){if(sql==='COMMIT')await pause('before-commit');const r=await c.query(sql,...args);if(sql==='COMMIT')await pause('after-commit');return r;}};}};
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
const auth={profile:'MEMBER_SELF_SERVICE',write_flag:true,flags,csrf_token:'synthetic-csrf',canonical_reporter_binding:'a'.repeat(64),source_corp_scope:'synthetic-corp',source_app_scope:'synthetic-app',proof_ref:'tests/ss009'};
const store=createYxxSelfServiceStore({pool,scopeSecret:'ss009-synthetic-secret-at-least-32-bytes'});
const command=createYxxMemberCommandContext({store,profile:auth.profile,flags,authenticate:async()=>auth,recheck:Object.assign(async()=>auth,{localOnly:true}),quota:Object.assign(async()=>true,{localOnly:true})});
const processor=createYxxSelfServiceOrchestrator({pool,profile:auth.profile,featureFlags:flags});
process.on('message',async m=>{
  try{barrier=m.barrier??null;let result;
    if(m.action==='accept')result=await command.accept({input:m.input,kind:m.kind??'SUBMIT',requestRef:m.ref,request:{headers:{'x-csrf-token':auth.csrf_token,'idempotency-key':m.input.client_command_id}}});
    else if(m.action==='process'){await pause('before-process');result=await processor.processOne({requestRef:m.ref});}
    else if(m.action==='status')result=await command.commandStatus({request:{},clientCommandId:m.command});
    else if(m.action==='stop'){await base.end();process.disconnect();return;}
    process.send({type:'result',result});
  }catch(e){process.send({type:'failure',code:e.code??'TEST_FAILED'});}
});
process.send({type:'ready'});
