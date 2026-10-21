import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {H5PerformanceTrace,PerformanceSqlLedgerSnapshot,H5PerformanceSqlLedger,H5PerformanceMemberVerificationLedger,PerformanceMemberVerificationSnapshot} from './helpers/yxx-h5-performance-observability.mjs';

interface MemberDataset {member:number;scopeHash:string;requestRef:string}
interface QuerySample {sha256:string;text:string;values:unknown[];owner_kind:'REQUEST'|'BATCH'|'SETUP';batch_slots:number|null;read_views:string[]}
interface HttpResult {status:number;body:Record<string,unknown>}
interface Timings {count:number;min:number;p50:number;p75:number;p95:number;max:number}
interface LoadMember {member:number;requestRef:string;recoveryScope:string;send(route:string,options:{id:string}):Promise<HttpResult>}
type Observation=H5PerformanceTrace;
type CloneTable='intake.web_command_receipt'|'intake.service_intake'|'intake.web_request_binding'|'intake.web_submission'|'pilot_ticket.ticket'|'pilot_ticket.ticket_event';
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function signedDepartmentCursor(value:unknown,membership:unknown,lastCreated:unknown,secret:string):void{
  assert.equal(typeof value,'string');assert.ok(typeof value==='string');const [body,signature,extra]=value.split('.');assert.ok(body&&signature&&extra===undefined);
  assert.equal(timingSafeEqual(Buffer.from(signature),Buffer.from(createHmac('sha256',secret).update(body).digest('base64url'))),true);
  const decoded=record(JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as unknown);assert.equal(decoded.purpose,'H5_DEPARTMENT');assert.equal(decoded.membership,membership);assert.equal(decoded.at,lastCreated);assert.match(String(decoded.id),/^[a-f0-9-]{36}$/u);assert.equal(typeof decoded.scope,'string');
}

export async function seedLargeConcurrencyDataset(pool:PostgresPool,members:readonly MemberDataset[],outputRoot:string):Promise<Record<string,unknown>>{
  assert.equal(members.length,10);assert.equal(new Set(members.map(member=>member.scopeHash)).size,10);
  const connection=await pool.connect();
  const clone=async(table:CloneTable,source:string,overrides:string)=>{
    const started=performance.now();
    process.stdout.write(JSON.stringify({phase:'large-concurrency-seed-start',table})+'\n');
    // Compute each composite once. All original FKs and CHECK constraints remain enabled.
    await connection.query(`INSERT INTO ${table} SELECT expanded.* FROM ${source} CROSS JOIN LATERAL jsonb_populate_record(NULL::${table},to_jsonb(t)||${overrides}) expanded`);
    process.stdout.write(JSON.stringify({phase:'large-concurrency-seed',table,elapsed_ms:performance.now()-started})+'\n');
  };
  try{
    await connection.query('BEGIN');await connection.query('SET CONSTRAINTS ALL DEFERRED');
    await connection.query(`CREATE TEMP TABLE h5_perf_owners(member integer PRIMARY KEY,scope_hash text NOT NULL,request_ref text NOT NULL,intake_id uuid NOT NULL,ticket_id uuid NOT NULL,existing integer NOT NULL) ON COMMIT DROP`);
    for(const member of members){
      const inserted=await connection.query(`INSERT INTO h5_perf_owners SELECT $1,$2,$3,b.intake_id,i.pilot_ticket_id,(SELECT count(*)::integer FROM intake.web_request_binding WHERE canonical_reporter_binding=$2) FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$3 AND b.canonical_reporter_binding=$2`,[member.member,member.scopeHash,member.requestRef]);
      assert.equal(inserted.rowCount,1);
    }
    await connection.query(`CREATE TEMP TABLE h5_perf_bulk ON COMMIT DROP AS SELECT row_number()OVER() AS g,o.member,o.scope_hash,o.intake_id AS original_intake_id,o.ticket_id AS original_ticket_id,gen_random_uuid() AS intake_id,gen_random_uuid() AS ticket_id,gen_random_uuid() AS receipt_id,gen_random_uuid() AS command_id,gen_random_uuid() AS submission_id,replace(gen_random_uuid()::text,'-','') AS request_ref FROM h5_perf_owners o CROSS JOIN LATERAL generate_series(1,10000-o.existing)n`);
    await clone('intake.web_command_receipt',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT r.* FROM intake.web_command_receipt r WHERE r.result_intake_id=b.original_intake_id LIMIT 1)t`,`jsonb_build_object('id',b.receipt_id,'client_command_id',b.command_id,'result_intake_id',b.intake_id,'result_request_ref',b.request_ref,'scope_hash',b.scope_hash)`);
    await clone('intake.service_intake',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM intake.service_intake WHERE id=b.original_intake_id)t`,`jsonb_build_object('id',b.intake_id,'intake_no','INT-'||to_char(platform.local_now(),'YYYYMMDD')||'-'||(900000+b.g)::text,'primary_web_submission_id',b.submission_id,'pilot_ticket_id',NULL,'status','RECEIVED','canonical_reporter_binding',b.scope_hash)`);
    await clone('intake.web_request_binding',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM intake.web_request_binding WHERE intake_id=b.original_intake_id)t`,`jsonb_build_object('intake_id',b.intake_id,'request_ref',b.request_ref,'canonical_reporter_binding',b.scope_hash,'notify_recipient_id',NULL,'notify_identity_namespace',NULL,'notify_proof_ref',NULL,'notify_verified_epoch_ms',NULL)`);
    await clone('intake.web_submission',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM intake.web_submission WHERE intake_id=b.original_intake_id AND kind='SUBMIT' LIMIT 1)t`,`jsonb_build_object('id',b.submission_id,'intake_id',b.intake_id,'command_receipt_id',b.receipt_id,'canonical_reporter_binding',b.scope_hash)`);
    await clone('pilot_ticket.ticket',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM pilot_ticket.ticket WHERE id=b.original_ticket_id)t`,`jsonb_build_object('id',b.ticket_id,'source_intake_id',b.intake_id,'ticket_no','IT-'||to_char(platform.local_now(),'YYYYMMDD')||'-'||(900000+b.g)::text)`);
    await connection.query("UPDATE intake.service_intake i SET pilot_ticket_id=b.ticket_id,status='TICKET_CREATED' FROM h5_perf_bulk b WHERE i.id=b.intake_id");
    // Every measured member reads a genuinely heavy ticket; nine small tickets cannot dilute request p95.
    await clone('pilot_ticket.ticket_event',`h5_perf_owners o CROSS JOIN LATERAL generate_series(2,10000)g CROSS JOIN LATERAL(SELECT * FROM pilot_ticket.ticket_event WHERE ticket_id=o.ticket_id ORDER BY event_ordinal LIMIT 1)t`,`jsonb_build_object('event_id',gen_random_uuid(),'event_type','ticket.information_added','old_status',t.new_status,'aggregate_version',g,'event_ordinal',g)`);
    await connection.query('UPDATE pilot_ticket.ticket t SET version=10000 FROM h5_perf_owners o WHERE t.id=o.ticket_id');
    await connection.query('COMMIT');
  }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
  const analyzedTables=['intake.service_intake','intake.web_request_binding','intake.web_submission','pilot_ticket.ticket','pilot_ticket.ticket_event','directory.identity_binding','directory.member_current','directory.membership_current','directory.department_current','directory.current_snapshot'];
  for(const table of analyzedTables)await pool.query('ANALYZE '+table);
  const counts=(await pool.query<{member:number;own_reports:number;ticket_events:number}>(`SELECT input.member,(SELECT count(*)::integer FROM intake.web_request_binding b WHERE b.canonical_reporter_binding=input.scope_hash) AS own_reports,(SELECT count(*)::integer FROM pilot_ticket.ticket_event e JOIN intake.service_intake i ON i.pilot_ticket_id=e.ticket_id JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=input.request_ref) AS ticket_events FROM jsonb_to_recordset($1::jsonb) AS input(member integer,scope_hash text,request_ref text) ORDER BY input.member`,[JSON.stringify(members.map(member=>({member:member.member,scope_hash:member.scopeHash,request_ref:member.requestRef})))])).rows;
  assert.equal(counts.length,10);assert.ok(counts.every(member=>member.own_reports===10000&&member.ticket_events===10000));
  const department=(await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM intake.web_request_binding')).rows[0];assert.equal(department?.count,100000);
  const settings=(await pool.query(`SELECT name,setting,unit,source FROM pg_settings WHERE name=ANY($1::text[]) ORDER BY name`,[['server_version','max_connections','shared_buffers','work_mem','maintenance_work_mem','max_parallel_workers','max_parallel_workers_per_gather','max_worker_processes','autovacuum','autovacuum_max_workers','default_statistics_target','jit','effective_cache_size','random_page_cost','seq_page_cost','plan_cache_mode']])).rows;
  const statistics=(await pool.query(`SELECT s.schemaname,s.relname,c.reltuples::bigint AS analyzed_estimate,s.n_live_tup,s.n_dead_tup,s.last_analyze,s.last_autoanalyze,s.analyze_count FROM pg_stat_all_tables s JOIN pg_class c ON c.oid=s.relid WHERE s.schemaname||'.'||s.relname=ANY($1::text[]) ORDER BY s.schemaname,s.relname`,[analyzedTables])).rows;
  const connections=(await pool.query(`SELECT application_name,backend_type,state,count(*)::integer AS connections FROM pg_stat_activity WHERE datname=current_database() OR application_name LIKE 'p2_015_%' GROUP BY application_name,backend_type,state ORDER BY application_name,backend_type,state`)).rows;
  const statuses=(await pool.query<{status:string;count:number}>('SELECT status,count(*)::integer AS count FROM pilot_ticket.ticket GROUP BY status ORDER BY status')).rows;
  const expectedActive=statuses.filter(row=>!['CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'].includes(row.status)).reduce((sum,row)=>sum+row.count,0);
  const result={synthetic:true,members:counts,department_reports:100000,expected_department_active_count:expectedActive,ticket_status_distribution:statuses,heavy_tickets:10,events_per_heavy_ticket:10000,total_heavy_ticket_events:100000,all_original_constraints_enabled:true,analyzed_tables:analyzedTables,pg_settings:settings,table_statistics:statistics,connections_before_measurement:connections,app_pool_max:4,formal_worker_pool_max:1,app_worker_pool_budget:5,fixture_administrative_pool_max:1};
  await writeFile(path.join(outputRoot,'large-concurrency-dataset.json'),JSON.stringify(result,null,2)+'\n');return result;
}

export async function explainLargeConcurrency(pool:PostgresPool,queries:ReadonlyMap<string,QuerySample>,outputRoot:string,phase:'before-measurement'|'after-measurement'='before-measurement'):Promise<Record<string,unknown>>{
  const plans=[],productionHotPlans=[];
  for(const [sampleKey,sample]of queries){
    const batched=sample.owner_kind==='BATCH';
    if(!batched&&!/FROM\s+(?:intake\.web_request_binding|directory\.identity_binding)|WITH\s+(?:all_events|current_member|current_ticket|web_reports|eligible)/iu.test(sample.text))continue;
    const connection=await pool.connect();let inTransaction=false;
    const readSettings=async()=>{const row=(await connection.query<{work_mem:string;hash_mem_multiplier:string;max_parallel_workers_per_gather:string}>("SELECT current_setting('work_mem') AS work_mem,current_setting('hash_mem_multiplier') AS hash_mem_multiplier,current_setting('max_parallel_workers_per_gather') AS max_parallel_workers_per_gather")).rows[0];assert.ok(row);return row;};
    let slotIds:number[]|null=null;
    if(batched){
      assert.ok(sample.batch_slots!==null&&sample.batch_slots>=1&&sample.batch_slots<=10);assert.equal(typeof sample.values[0],'string');
      const slots:unknown=JSON.parse(String(sample.values[0]));assert.ok(Array.isArray(slots));assert.equal(slots.length,sample.batch_slots);
      slotIds=slots.map(value=>{const slot=record(value).slot;assert.equal(typeof slot,'number');assert.ok(typeof slot==='number'&&Number.isSafeInteger(slot));return slot;});assert.equal(new Set(slotIds).size,slotIds.length);
      assert.equal(sample.read_views.length,1);assert.ok(sample.read_views[0]==='home'||sample.read_views[0]==='department');
    }
    const identity={sample_key:sampleKey,sha256:sample.sha256,statement:sample.text,owner_kind:sample.owner_kind,read_views:sample.read_views,batch_slots:sample.batch_slots,slot_ids:slotIds,parameter_types:sample.values.map(value=>value===null?'null':Array.isArray(value)?'array':typeof value),parameter_values:sample.values,parameter_scope:'Task-owned synthetic fixture values captured from this exact compiled SQL shape; not a previous candidate parameter contract'};
    try{
      const defaults=await readSettings();assert.equal(defaults.work_mem,'4MB');
      const started=performance.now(),plan=await connection.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sample.text,sample.values);
      plans.push({...identity,kind:'INSTANCE_DEFAULT_CONTROL',settings:defaults,wall_ms:performance.now()-started,plan:plan.rows});
      // These captured home/department statements run under the product's three local settings.
      // Keep the unmodified instance control above; this separate plan mirrors that transaction only.
      if(batched||/eligible_reporters\s+AS\s+MATERIALIZED/iu.test(sample.text)){
        await connection.query('BEGIN');inTransaction=true;
        const statements=["SET LOCAL work_mem='16MB'",'SET LOCAL hash_mem_multiplier=2','SET LOCAL max_parallel_workers_per_gather=0'];
        for(const statement of statements)await connection.query(statement);
        const settings=await readSettings();assert.deepEqual(settings,{work_mem:'16MB',hash_mem_multiplier:'2',max_parallel_workers_per_gather:'0'});
        const hotStarted=performance.now(),hotPlan=await connection.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sample.text,sample.values),hotElapsed=performance.now()-hotStarted;
        await connection.query('ROLLBACK');inTransaction=false;
        const restored=await readSettings();assert.deepEqual(restored,defaults);
        productionHotPlans.push({...identity,kind:'PRODUCTION_TRANSACTION_LOCAL',transaction_statements:statements,settings,restored_settings:restored,wall_ms:hotElapsed,plan:hotPlan.rows});
      }
    }finally{try{if(inTransaction)await connection.query('ROLLBACK');}finally{connection.release();}}
  }
  assert.ok(plans.length>0);assert.ok(productionHotPlans.length>=2,'actual home and department hot statements must both have transaction-local plans');
  assert.ok(productionHotPlans.some(plan=>plan.owner_kind==='BATCH'&&plan.read_views.includes('home'))&&productionHotPlans.some(plan=>plan.owner_kind==='BATCH'&&plan.read_views.includes('department')),'both actual compiled batch routes must be captured');
  const result={synthetic:true,phase,dataset_file:'large-concurrency-dataset.json',explain_count:plans.length+productionHotPlans.length,instance_control_count:plans.length,production_hot_count:productionHotPlans.length,observed_batch_shapes:productionHotPlans.filter(plan=>plan.owner_kind==='BATCH').map(plan=>({sha256:plan.sha256,views:plan.read_views,slots:plan.batch_slots,slot_ids:plan.slot_ids})),plans,production_hot_plans:productionHotPlans};
  const file=phase==='before-measurement'?'large-concurrency-explain.json':'large-concurrency-explain-after-measurement.json';
  await writeFile(path.join(outputRoot,file),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return {file,explain_count:result.explain_count,instance_control_count:plans.length,production_hot_count:productionHotPlans.length,observed_batch_shapes:result.observed_batch_shapes};
}

export async function measureLargeConcurrency(options:{members:readonly LoadMember[];warmups:number;samples:number;outputRoot:string;traces:readonly Observation[];percentiles:(values:readonly number[])=>Timings;expectedActive:number;cursorSecret:string;inspectRead:(trace:Observation,kind:'BATCHED_HOME_OR_DEPARTMENT'|'REQUEST')=>ReturnType<H5PerformanceSqlLedger['inspectRead']>;sqlLedger:()=>PerformanceSqlLedgerSnapshot;inspectVerification:(trace:Observation)=>ReturnType<H5PerformanceMemberVerificationLedger['inspectTrace']>;verificationLedger:()=>PerformanceMemberVerificationSnapshot;onRoundBoundary:(id:string)=>Promise<void>}):Promise<Record<string,unknown>>{
  assert.equal(options.members.length,10);assert.equal(options.warmups,3);assert.equal(options.samples,20);
  assert.ok(options.members.every(member=>member.recoveryScope.length>0));assert.equal(new Set(options.members.map(member=>member.recoveryScope)).size,10);
  const expectedBusinessSelects={home:3,request:6,department:3} as const;
  const samples:Record<string,unknown>[]=[],groups:Record<string,unknown>={},failures:Record<string,unknown>[]=[],departmentPages=new Map<number,{page:Record<string,unknown>;membership:unknown}>(),timeline={warmup:{ready:0,unavailable:0},measured:{ready:0,unavailable:0}},pagination:Record<string,unknown>[]=[],loop=monitorEventLoopDelay({resolution:10});loop.enable();
  try{
    for(const view of ['home','request','department'] as const){
      const viewRows:{elapsed_ms:number;status:number;warmup:boolean}[]=[];
      for(let round=-options.warmups;round<options.samples;round++){
        const readyAt=performance.now();
        const [rows]=await Promise.all([Promise.all(options.members.map(async member=>{
          const id=`large-${view}-${round<0?'warmup'+(-round):'sample'+round}-${member.member}`,started=performance.now();
          const route='/api/yixiaoxiu/h5/entry?view='+view+(view==='request'?'&request_ref='+encodeURIComponent(member.requestRef):'');
          let status=0,error:string|null=null,body:Record<string,unknown>={};
          try{const response=await member.send(route,{id});status=response.status;body=response.body;}catch(value){error=value instanceof Error&&/^[A-Z_]+$/u.test(value.message)?value.message:'HTTP_REQUEST_FAILED';}
          const trace=options.traces.find(item=>item.id===id),elapsed=performance.now()-started;
          const readSql=trace?options.inspectRead(trace,view==='request'?'REQUEST':'BATCHED_HOME_OR_DEPARTMENT'):null;
          const verification=trace?options.inspectVerification(trace):null;
          const row={id,view,round,member:member.member,warmup:round<0,elapsed_ms:elapsed,client_dispatch_lag_ms:started-readyAt,status,error,server_trace:trace??null,read_sql:readSql,member_verification:verification};
          samples.push(row);viewRows.push({elapsed_ms:elapsed,status,warmup:round<0});
          if(status!==200||error||!trace||trace.provider_calls!==1)failures.push({id,status,error,reason:!trace?'MISSING_TRACE':trace.provider_calls!==1?'PROVIDER_COUNT':'HTTP_STATUS'});
          if(trace&&(trace.provider_outcomes.completed!==1||trace.provider_outcomes.aborted!==0||trace.provider_outcomes.error!==0))failures.push({id,reason:'PROVIDER_OUTCOME',actual:trace.provider_outcomes});
          if(readSql&&(readSql.read_participations!==expectedBusinessSelects[view]||readSql.integrity_errors.length))failures.push({id,view,reason:'WHOLE_PAGE_READ_DEPENDENCIES',actual:readSql,expected:expectedBusinessSelects[view],structure:view==='request'?'SIX_DIRECT':'ONE_INITIAL_ONE_SHARED_ONE_FINAL'});
          if(verification&&verification.integrity_errors.length)failures.push({id,view,reason:'ONE_ACTUAL_H5_ENTRY_VERIFICATION',actual:verification});
          // Count a completed protected DTO, not just an HTTP 200 shell or another member's cached body.
          const payload:Record<string,unknown>={};
          if(status===200)try{
            assert.equal(body.schema_version,1);assert.equal(body.view,view);assert.equal(record(body.bootstrap).recovery_scope,member.recoveryScope);assert.equal(record(body.bootstrap).authenticated,true);assert.equal(typeof body.membership_revision,'string');assert.ok(body.membership_revision);
            const data=record(body.data);payload.scope_matches=true;
            if(view==='home'){
              assert.ok(Array.isArray(data.recent_reports));assert.equal(data.recent_reports.length,3);const summary=record(data.department_summary);assert.equal(summary.total,100000);assert.equal(summary.active_count,options.expectedActive);assert.equal(summary.membership_revision,body.membership_revision);
              Object.assign(payload,{recent_count:data.recent_reports.length,total:summary.total,active_count:summary.active_count});
            }else if(view==='request'){
              assert.equal(record(data.detail).request_ref,member.requestRef);const section=record(data.timeline),bucket=round<0?timeline.warmup:timeline.measured;
              if(section.status==='READY'){const page=record(section.data);assert.ok(Array.isArray(page.items));assert.equal(page.items.length,20);assert.equal(typeof page.next_cursor,'string');bucket.ready++;Object.assign(payload,{timeline_status:'READY',timeline_items:page.items.length,timeline_cursor:true});}
              else{assert.equal(section.status,'UNAVAILABLE');assert.equal(section.code,'YXX_UNAVAILABLE');bucket.unavailable++;payload.timeline_status='UNAVAILABLE';}
            }else{
              const page=record(data.department);assert.equal(page.total,100000);assert.equal(page.active_count,options.expectedActive);assert.ok(Array.isArray(page.items));assert.equal(page.items.length,20);assert.equal(new Set(page.items.map(item=>record(item).ticket_no)).size,20);
              signedDepartmentCursor(page.next_cursor,body.membership_revision,record(page.items.at(-1)).created_at,options.cursorSecret);departmentPages.set(member.member,{page,membership:body.membership_revision});Object.assign(payload,{items:20,total:page.total,active_count:page.active_count,signed_cursor:true});
            }
          }catch{failures.push({id,reason:'PROTECTED_ENTRY_DTO_OR_BOUNDARY_MISMATCH'});}
          Object.assign(row,{payload_observation:payload});
          return row;
        })),options.onRoundBoundary('round-'+view+'-'+String(round+options.warmups))]);
        process.stdout.write(JSON.stringify({phase:'large-concurrency',view,round,warmup:round<0,count:rows.length,p95_ms:options.percentiles(rows.map(row=>row.elapsed_ms)).p95,statuses:[...new Set(rows.map(row=>row.status))]})+'\n');
        await writeFile(path.join(options.outputRoot,'large-concurrency-samples.json'),JSON.stringify({schema_version:1,status:'RUNNING',samples,failures},null,2)+'\n');
      }
      const measured=viewRows.filter(row=>!row.warmup),summary={requests:measured.length,warmups:viewRows.length-measured.length,latency_ms:options.percentiles(measured.map(row=>row.elapsed_ms)),errors:measured.filter(row=>row.status!==200).length,target_p95_ms:1500};
      groups[view]=summary;if(summary.latency_ms.p95>1500)failures.push({view,reason:'LATENCY_BUDGET',actual:summary.latency_ms.p95,target:1500});
    }
    for(const member of options.members){
      const first=departmentPages.get(member.member);assert.ok(first);assert.ok(Array.isArray(first.page.items));
      const next=await member.send('/api/yixiaoxiu/department-reports?limit=20&cursor='+encodeURIComponent(String(first.page.next_cursor)),{id:'pagination-'+member.member});assert.equal(next.status,200);
      assert.equal(next.body.total,100000);assert.equal(next.body.active_count,options.expectedActive);assert.ok(Array.isArray(next.body.items));assert.equal(next.body.items.length,20);
      assert.equal(new Set([...first.page.items,...next.body.items].map(item=>record(item).ticket_no)).size,40);signedDepartmentCursor(next.body.next_cursor,first.membership,record(next.body.items.at(-1)).created_at,options.cursorSecret);
      pagination.push({member:member.member,status:200,total:next.body.total,first_items:20,second_items:20,overlap:0,signed_cursor:true,excluded_from_latency_samples:true});
    }
    const first=options.members[0],second=options.members[1];assert.ok(first&&second);const firstPage=departmentPages.get(first.member);assert.ok(firstPage);const cursor=String(firstPage.page.next_cursor),last=cursor.at(-1),tampered=cursor.slice(0,-1)+(last==='A'?'B':'A');
    for(const [kind,member,value]of [['tampered',first,tampered],['cross-member',second,cursor]] as const){const response=await member.send('/api/yixiaoxiu/department-reports?limit=20&cursor='+encodeURIComponent(value),{id:'pagination-'+kind});assert.equal(response.status,400);assert.equal(record(response.body.error).code,'YXX_CURSOR_INVALID');pagination.push({kind,status:response.status,rejected:true,excluded_from_latency_samples:true});}
  }finally{loop.disable();}
  const ledger=options.sqlLedger(),ids=new Set(samples.map(row=>row.id)),measuredTraces=options.traces.filter(trace=>ids.has(trace.id)),keys=new Set(measuredTraces.map(trace=>trace.trace_key));
  const physical=ledger.statements.filter(statement=>statement.request_keys.some(key=>keys.has(key))),business=physical.filter(statement=>statement.business_select),dependencies=measuredTraces.flatMap(trace=>trace.read_dependencies),participantLinks=business.reduce((sum,statement)=>sum+statement.request_keys.filter(key=>keys.has(key)).length,0);
  if(samples.length!==690||ids.size!==690||measuredTraces.length!==690)failures.push({reason:'COMPLETE_690_HTTP_SAMPLES_REQUIRED',samples:samples.length,unique_ids:ids.size,traces:measuredTraces.length});
  if(dependencies.length!==participantLinks||new Set(physical.map(statement=>statement.statement_id)).size!==physical.length||ledger.integrity_errors.length)failures.push({reason:'PHYSICAL_LOGICAL_SQL_LEDGER_MISMATCH',logical_read_dependencies:dependencies.length,physical_participant_links:participantLinks,integrity_errors:ledger.integrity_errors});
  const providerOutcomes=measuredTraces.reduce((sum,trace)=>({completed:sum.completed+trace.provider_outcomes.completed,aborted:sum.aborted+trace.provider_outcomes.aborted,error:sum.error+trace.provider_outcomes.error}),{completed:0,aborted:0,error:0});
  const verifications=options.verificationLedger(),verificationOperations=measuredTraces.flatMap(trace=>trace.member_verifications),physicalVerifications=verifications.operations.filter(operation=>operation.request_key!==null&&keys.has(operation.request_key));
  const completeVerifications=verificationOperations.length===690&&new Set(verificationOperations.map(operation=>operation.operation_id)).size===690&&physicalVerifications.length===690&&verificationOperations.every(operation=>operation.purpose==='H5_ENTRY'&&operation.started_at_ms!==null&&operation.settled_at_ms!==null&&operation.outcome==='FULFILLED');
  if(!verifications.enabled||!completeVerifications||verifications.integrity_errors.length)failures.push({reason:'APPLICATION_MEMBER_VERIFICATION_LEDGER_MISMATCH',trace_operation_count:verificationOperations.length,physical_operation_count:physicalVerifications.length,integrity_errors:verifications.integrity_errors});
  const doubleLedger={physical_ledger_file:'physical-sql-ledger.json',scope:'Only statements explicitly linked to these 690 HTTP trace keys; all setup, pagination and EXPLAIN statements remain in the complete ledger file',physical_statement_count:physical.length,physical_business_selects:business.length,physical_direct_business_selects:business.filter(statement=>statement.kind==='REQUEST').length,physical_shared_business_selects:business.filter(statement=>statement.kind==='BATCH').length,logical_read_dependencies:dependencies.length,physical_participant_links:participantLinks,shared_participations:dependencies.filter(dependency=>dependency.kind==='SHARED').length,statement_ids:physical.map(statement=>statement.statement_id),integrity_errors:ledger.integrity_errors};
  const result={schema_version:2,status:failures.length?'FAIL':'PASS',dataset_file:'large-concurrency-dataset.json',members:10,warmup_rounds:3,measured_rounds:20,requests_per_round:10,provider_delay_ms:100,app_pool_max:4,worker_pool_max:1,application_worker_pool_budget:5,groups,samples,failures,timeline,pagination_checks:pagination,sql_double_ledger:doubleLedger,provider_outcomes:providerOutcomes,member_verification_scheduler:{ledger_file:'member-verification-ledger.json',scope:verifications.scope,formal_and_warmup_operations:physicalVerifications.length,observed_app_global_max:verifications.observed_max,app_global_final:verifications.final,integrity_errors:verifications.integrity_errors,semantics:'One shared verifier instance: total active <=2, BASE active <=1, H5_ENTRY active <=2, combined pending <=32. Observed maxima are measurements, not a claim that every configured boundary was saturated.'},measurement_preconditions:{complete_690:samples.length===690&&ids.size===690&&measuredTraces.length===690,all_http_200:samples.every(row=>row.status===200),all_client_error_null:samples.every(row=>row.error===null),all_provider_completed:providerOutcomes.completed===690&&providerOutcomes.aborted===0&&providerOutcomes.error===0,all_690_entry_verifications_observed:completeVerifications,protected_dto_validation_failures:failures.filter(failure=>failure.reason==='PROTECTED_ENTRY_DTO_OR_BOUNDARY_MISMATCH').length},event_loop_delay_ms:{min:loop.min/1e6,mean:loop.mean/1e6,max:loop.max/1e6,p50:loop.percentile(50)/1e6,p95:loop.percentile(95)/1e6,p99:loop.percentile(99)/1e6},timing_semantics:{elapsed_ms:'Client request creation through complete response consumption, including loopback transport and all server waits',client_dispatch_lag_ms:'Actual load-generator scheduling from the shared round barrier to each request creation',business_selects:'Direct physical request SELECTs only. Whole-page dependency budget is exactly initial/shared/final=3 for home and department, six direct for request',sql_ms:'Exclusive request-owned awaited query calls, not shared batch spans',sql_shared_dependency_ms:'Inclusive shared SQL awaited time per participant; do not sum across requests as physical throughput',pool_wait_ms:'Explicit request-owned pool.connect checkout wait',pool_wait_shared_dependency_ms:'Inclusive batch checkout dependency; one actual checkout in global ledger',application_admission_queue:'Actual product queued_at_ms to sealed_at_ms; received_at_ms is earlier and never substituted',provider_queue_ms:'Actual verifier STARTED.started_at_ms minus QUEUED.queued_at_ms, joined by opaque operation ID from the request; not an HTTP residual',provider_active_ms:'Actual underlying SETTLED.at_ms minus STARTED.started_at_ms, including lookup/parse; fetch-only provider_ms remains the fixed 100 ms finally duration',event_loop_delay_ms:'Whole-run Node event-loop delay histogram, not per-request queue time'}};
  await writeFile(path.join(options.outputRoot,'large-concurrency.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}
