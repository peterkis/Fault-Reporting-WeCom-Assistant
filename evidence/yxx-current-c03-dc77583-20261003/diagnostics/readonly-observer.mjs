import assert from 'node:assert/strict';import {existsSync,readFileSync,appendFileSync,writeFileSync} from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/u,'$1'));
const run=path.join(root,'full-02'),tests=path.join(run,'tests'),data=path.join(run,'pg-data');
const require=createRequire(path.join(root,'checkout/package.json')),{Client}=require('pg');
const trace=path.join(tests,'145-p2-g2-process-assembly.integration.test.mjs.cases.jsonl'),record=path.join(tests,'145-p2-g2-process-assembly.integration.test.mjs.json');
const log=path.join(root,'readonly-process-observation.jsonl'),done=path.join(root,'readonly-process-observation-cleanup.json');
assert.equal(existsSync(log),false);assert.equal(existsSync(done),false);
const note=value=>appendFileSync(log,JSON.stringify({event_epoch_ms:String(Date.now()),diagnostic_only:true,...value})+'\n');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let admin,target,closed=false;
try {
 while(!existsSync(trace)){if(existsSync(path.join(tests,'summary.json'))||!existsSync(path.join(data,'postmaster.pid')))throw Error('RUN_ENDED_BEFORE_TARGET');await wait(1000);}
 const pid=readFileSync(path.join(data,'postmaster.pid'),'utf8').split(/\r?\n/u),port=Number(pid[3]);assert.ok(port>=1024&&port<=65535);
 const settings={host:'127.0.0.1',port,user:'postgres',application_name:'yxx_owned_readonly_diagnostic',options:'-c default_transaction_read_only=on -c statement_timeout=1000',connectionTimeoutMillis:1000};
 admin=new Client({...settings,database:'migration_ci'});admin.on('error',()=>{});await admin.connect();
 const actual=(await admin.query('SHOW data_directory')).rows[0].data_directory;assert.equal(path.resolve(actual).toLowerCase(),path.resolve(data).toLowerCase());
 const deadline=Date.now()+180000;
 while(!existsSync(record)&&Date.now()<deadline){
  if(!target){const rows=(await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'p2_015_g2process_%'")).rows;if(rows.length===1){assert.match(rows[0].datname,/^p2_015_g2process_[a-z0-9_]+$/u);target=new Client({...settings,database:rows[0].datname});target.on('error',()=>{});await target.connect();note({event:'OWNED_DATABASE_IDENTIFIED'});}}
  if(target){try{const rows=(await target.query('SELECT status,last_error_code,attempt_count,target_type FROM communication.delivery')).rows;note({delivery_states:rows});}catch(error){note({query_error_code:error.code??'QUERY_UNAVAILABLE'});}}
  await wait(500);
 }
 note({event:existsSync(record)?'TARGET_TERMINAL_RECORD':'OBSERVATION_BOUND_REACHED'});
} catch(error){note({event:'OBSERVER_STOPPED',error_code:error.code??error.message});}
finally {const cleanup_errors=[];for(const client of [target,admin])if(client){try{await client.end();}catch(error){cleanup_errors.push(error.code??'CLIENT_END_FAILED');}}closed=cleanup_errors.length===0;writeFileSync(done,JSON.stringify({kind:'READONLY_DIAGNOSTIC_CLIENT_CLEANUP',diagnostic_only:true,status:closed?'CLEANUP_CONFIRMED':'CLEANUP_UNCONFIRMED',clients_closed:closed,cleanup_errors,source_changed:false,acceptance:false,event_epoch_ms:String(Date.now())},null,2)+'\n',{flag:'wx'});}