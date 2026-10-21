import assert from 'node:assert/strict';
import {once} from 'node:events';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {test} from 'node:test';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {beginH5Read,createH5ReadBatch,createH5ReadBudget,finishH5Read,getH5ReadBatchContext,getH5ReadParticipantId,getH5ReadBatchTiming,H5_READ_BATCH_LIMITS,type H5ReadBudget} from '../src/yxx-h5-read-batch.mjs';
import {buildH5BatchReadStatement,DEPARTMENT_FRESH_EPOCH_SQL,h5DepartmentPageSql,h5DepartmentSummarySql,h5RecentSql,type H5BatchShape,type H5BatchSqlInput} from '../src/yxx-h5-batch-sql.mjs';

function request(){return new IncomingMessage(new Socket());}
function input(overrides:Partial<H5BatchSqlInput>={}):H5BatchSqlInput{
  return {scope_hash:'a'.repeat(64),source_scope:'FORMAL',source_corp_scope:'synthetic-corp',source_app_scope:'synthetic-app',maximum_directory_age_ms:86400000,
    expected_provider_user_id:'synthetic-user',expected_snapshot_version:'7',expected_department_refs:['synthetic-department'],
    recent:['a'.repeat(64),3,null,1790000000000,null,null,null,'synthetic-bot','synthetic-user','synthetic-bot-binding','synthetic-corp','synthetic-app'],...overrides};
}
const occurrences=(text:string,part:string)=>text.split(part).length-1;

test('batch participant identity and immutable lifecycle timing contain no Cookie or request data',()=>{
  const first=request(),second=request(),cookie='synthetic-cookie-never-an-identifier',url='/private?synthetic-sensitive-value';first.headers.cookie=cookie;second.headers.cookie=cookie;first.url=url;
  try{
    assert.equal(getH5ReadParticipantId(first),undefined);assert.equal(getH5ReadBatchTiming(first),undefined);assert.equal(getH5ReadBatchContext(),undefined);
    beginH5Read(first);const id=getH5ReadParticipantId(first),received=getH5ReadBatchTiming(first);assert.ok(id&&received);assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
    assert.deepEqual(Object.keys(received),['received_at_ms']);assert.ok(Number.isFinite(received.received_at_ms));assert.equal(Object.isFrozen(received),true);
    beginH5Read(first);assert.equal(getH5ReadParticipantId(first),id);assert.equal(getH5ReadBatchTiming(first),received);
    beginH5Read(second);assert.notEqual(getH5ReadParticipantId(second),id);
    finishH5Read(first,'committed');const closed=getH5ReadBatchTiming(first);assert.ok(closed);assert.equal(closed.outcome,'committed');assert.ok(typeof closed.closed_at_ms==='number'&&closed.closed_at_ms>=received.received_at_ms);
    const encoded=JSON.stringify({id,timing:closed});for(const secret of [cookie,url,'headers','socket'])assert.equal(encoded.includes(secret),false);
    beginH5Read(first);assert.notEqual(getH5ReadParticipantId(first),id);assert.deepEqual(Object.keys(getH5ReadBatchTiming(first)??{}),['received_at_ms']);
  }finally{first.socket.destroy();second.socket.destroy();}
});

test('completed IncomingMessage close stays readable while actual request abort and socket close cancel waits',async()=>{
  const normal=request(),aborted=request(),disconnected=request();const budgets=[createH5ReadBudget(normal),createH5ReadBudget(aborted),createH5ReadBudget(disconnected)];
  const [normalBudget,abortedBudget,disconnectedBudget]=budgets;assert.ok(normalBudget&&abortedBudget&&disconnectedBudget);
  try{
    normal.complete=true;normal.emit('close');assert.equal(normalBudget.signal.aborted,false);assert.doesNotThrow(()=>normalBudget.check());assert.equal(await normalBudget.wait(Promise.resolve('readable')),'readable');
    const abortedWait=abortedBudget.wait(new Promise<never>(()=>undefined));const abortedCheck=assert.rejects(abortedWait,{code:'YXX_REQUEST_ABORTED'});aborted.destroy();await abortedCheck;
    assert.equal(aborted.aborted,true);assert.equal(abortedBudget.signal.aborted,true);assert.throws(()=>abortedBudget.check(),{code:'YXX_REQUEST_ABORTED'});
    const socketClosed=once(disconnected.socket,'close');disconnected.socket.destroy();await socketClosed;assert.equal(disconnectedBudget.signal.aborted,true);
    await assert.rejects(disconnectedBudget.wait(Promise.resolve('late body')),{code:'YXX_REQUEST_ABORTED'});
  }finally{for(const budget of budgets)budget.finish('cancelled');for(const req of [normal,aborted,disconnected])req.socket.destroy();}
});

test('finishing a read removes only its abort listeners and preserves unrelated socket listeners',async()=>{
  const req=request(),unrelated=()=>undefined;req.on('aborted',unrelated);req.socket.on('close',unrelated);
  const abortedBefore=req.listenerCount('aborted'),closeBefore=req.socket.listenerCount('close'),budget=createH5ReadBudget(req);
  try{
    assert.equal(req.listenerCount('aborted'),abortedBefore+1);assert.equal(req.socket.listenerCount('close'),closeBefore+1);assert.ok(budget.remaining()<=5000&&budget.remaining()>=0);
    budget.finish('committed');assert.equal(req.listenerCount('aborted'),abortedBefore);assert.equal(req.socket.listenerCount('close'),closeBefore);assert.equal(getH5ReadBatchTiming(req)?.outcome,'committed');
    req.emit('aborted');req.socket.emit('close');assert.equal(budget.signal.aborted,false);assert.equal(await budget.wait(Promise.resolve(17)),17);
    budget.finish('committed');assert.equal(req.listenerCount('aborted'),abortedBefore);assert.equal(req.socket.listenerCount('close'),closeBefore);
  }finally{budget.finish('committed');req.removeListener('aborted',unrelated);req.socket.removeListener('close',unrelated);req.socket.destroy();}
});

test('twenty open participants reject the twenty-first and finishing one immediately returns admission',async()=>{
  const pool=createPostgresPool({max:4,connectionTimeoutMillis:5000}),batch=createH5ReadBatch({pool}),requests:IncomingMessage[]=[],open=new Set<H5ReadBudget>();
  try{
    assert.equal(pool.totalCount,0);assert.equal(H5_READ_BATCH_LIMITS.participants,20);
    for(let index=0;index<20;index++){const req=request();requests.push(req);open.add(batch.open(req));}
    const overflow=request();requests.push(overflow);assert.throws(()=>batch.open(overflow),{code:'YXX_READ_BUSY',status:429});assert.equal(getH5ReadParticipantId(overflow),undefined);
    const first=open.values().next().value;assert.ok(first);batch.finish(first,'committed');open.delete(first);
    const replacement=batch.open(overflow);open.add(replacement);assert.ok(getH5ReadParticipantId(overflow));
    const another=request();requests.push(another);assert.throws(()=>batch.open(another),{code:'YXX_READ_BUSY',status:429});
    for(const budget of open)batch.finish(budget,'committed');open.clear();await batch.close();await batch.close();
    assert.throws(()=>batch.open(another),{code:'YXX_UNAVAILABLE',status:503});assert.equal(pool.totalCount,0);assert.equal(pool.waitingCount,0);
  }finally{for(const budget of open)batch.finish(budget,'cancelled');await batch.close();for(const req of requests)req.socket.destroy();await pool.end();}
});

test('unbounded or non-finite pool checkout configurations fail before allocating a read budget',async()=>{
  const invalid:readonly (number|undefined)[]=[undefined,0,-1,5001,Infinity,NaN];
  for(const connectionTimeoutMillis of invalid){
    const pool=createPostgresPool({max:4,...(connectionTimeoutMillis===undefined?{}:{connectionTimeoutMillis})}),batch=createH5ReadBatch({pool}),req=request();
    try{assert.throws(()=>batch.open(req),{code:'YXX_READ_POOL_UNBOUNDED',status:503});assert.equal(getH5ReadParticipantId(req),undefined);assert.equal(req.listenerCount('aborted'),0);assert.equal(pool.totalCount,0);}
    finally{await batch.close();req.socket.destroy();await pool.end();}
  }
});

test('malicious member, enterprise, application and recent inputs stay JSON parameters for both closed shapes',()=>{
  const attack="synthetic'); SELECT pg_sleep(9); --",malicious=input({scope_hash:attack,source_scope:attack,source_corp_scope:attack,source_app_scope:attack,expected_provider_user_id:attack,expected_snapshot_version:attack,expected_department_refs:[attack],recent:[attack,3,null,1790000000000,null,null,null,attack,attack,attack,attack,attack]});
  for(const shape of ['home','department'] satisfies H5BatchShape[]){
    const slots=[{slot:9,...malicious},{slot:10,...input()}],statement=buildH5BatchReadStatement(shape,slots,65536),control=buildH5BatchReadStatement(shape,[{slot:1,...input()}],65536);
    assert.equal(statement.text,control.text);assert.equal(statement.text.includes(attack),false);assert.equal(statement.values.length,2);assert.equal(statement.values[1],65536);
    const json=statement.values[0];assert.equal(typeof json,'string');assert.ok(typeof json==='string');const decoded:unknown=JSON.parse(json);assert.deepEqual(decoded,slots);
    assert.deepEqual([...new Set(statement.text.match(/\$[0-9]+/gu))].sort(),['$1','$2']);assert.match(statement.text,/pg_catalog\.jsonb_to_recordset\(\$1::jsonb\)/u);
  }
});

test('original department physical-clock multiplicity and own recent source guards survive every constructor',()=>{
  assert.equal(DEPARTMENT_FRESH_EPOCH_SQL,'pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) OPERATOR(pg_catalog.*) 1000::pg_catalog.numeric)::pg_catalog.int8');
  const cases=[{shape:'home',single:h5DepartmentSummarySql(),clocks:4},{shape:'department',single:h5DepartmentPageSql(),clocks:6}] satisfies {shape:H5BatchShape;single:string;clocks:number}[];
  for(const item of cases){const batched=buildH5BatchReadStatement(item.shape,[{slot:1,...input()}]).text;
    for(const text of [item.single,batched]){
      assert.equal(occurrences(text,DEPARTMENT_FRESH_EPOCH_SQL),item.clocks);assert.equal(occurrences(text,'pg_catalog.clock_timestamp()'),item.clocks);
      for(const guard of ['wb.canonical_reporter_binding=er.reporter_identity_hash','i.id=wb.intake_id','i.canonical_reporter_binding=wb.canonical_reporter_binding','i.source_app_scope=wb.source_app_scope','wb.revoked_at IS NULL','wb.retention_until_epoch_ms>'+DEPARTMENT_FRESH_EPOCH_SQL,'i.retention_until_epoch_ms>'+DEPARTMENT_FRESH_EPOCH_SQL])assert.equal(occurrences(text,guard),1,guard);
    }
    assert.equal(occurrences(item.single,"i.source_provider='YIXIAOXIU_WEB'"),1);assert.equal(occurrences(batched,"i.source_provider='YIXIAOXIU_WEB'"),item.shape==='home'?2:1);
  }
  const groupedSummary=h5DepartmentSummarySql('group'),ownershipCase='CASE WHEN i.canonical_reporter_binding=wb.canonical_reporter_binding AND i.source_app_scope=wb.source_app_scope THEN TRUE ELSE FALSE END';
  assert.ok(groupedSummary.includes('JOIN intake.service_intake i ON i.id=wb.intake_id AND '+ownershipCase),'UUID matching cannot replace the complete source ownership predicate; NULL must take ELSE FALSE');
  assert.ok(groupedSummary.includes('JOIN (SELECT id,status FROM pilot_ticket.ticket OFFSET 0) t ON t.id=i.pilot_ticket_id'),'unaccepted sources with no Ticket never enter summary counts');
  assert.ok(groupedSummary.includes("count(*)::integer AS total,count(*) FILTER(WHERE t.status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED','RESOLVED'))::integer AS active_count"));
  assert.equal(groupedSummary.includes('reports AS MATERIALIZED'),false);
  for(const unchanged of [h5DepartmentSummarySql(),h5DepartmentPageSql(),h5DepartmentPageSql('group')])assert.equal(unchanged.includes(ownershipCase),false,'the bounded group summary optimization does not change the legacy or department queries');
  const recent=h5RecentSql('slot');assert.equal(occurrences(recent,'platform.physical_epoch_ms()'),4);
  for(const guard of ["b.canonical_reporter_binding=(resolved.recent->>0)::pg_catalog.text","b.source_corp_scope=(resolved.recent->>10)::pg_catalog.text","b.source_app_scope=(resolved.recent->>11)::pg_catalog.text","r.reporter_binding_hash=(resolved.recent->>9)::pg_catalog.text","i.source_bot_id=(resolved.recent->>7)::pg_catalog.text","i.reporter_wecom_userid=(resolved.recent->>8)::pg_catalog.text","i.source_provider='WECOM_AIBOT'",'UNION ALL','ORDER BY created_at DESC,kind_rank ASC,immutable_id DESC'])assert.ok(recent.includes(guard),guard);
});

test('wire SQL bounds proof, payload and the whole body and returns a closed per-slot status envelope',()=>{
  assert.deepEqual(H5_READ_BATCH_LIMITS,{participants:20,batch:10,inputBytes:262144,resultBytes:4194304,deadlineMs:5000});assert.equal(Object.isFrozen(H5_READ_BATCH_LIMITS),true);
  for(const shape of ['home','department'] satisfies H5BatchShape[]){
    const statement=buildH5BatchReadStatement(shape,[{slot:1,...input()}],4096);assert.equal(statement.values[1],4096);
    for(const fragment of ['octet_length(proof::text)>32768','octet_length(data::text)>262144','octet_length(proof::text)<=32768','octet_length(data::text)<=262144',"WHEN NOT COALESCE(qualified,false) THEN 'FORBIDDEN'","THEN 'TOO_LARGE' ELSE 'READY' END AS status",'COALESCE(sum(octet_length(entry::text)),0)+count(*)*2+2<=$2::bigint',"jsonb_build_object('slot',slot,'status','TOO_LARGE','proof',NULL,'data',NULL)",'jsonb_agg(entry ORDER BY slot)',"proof.provider_user_id=input.expected_provider_user_id",'proof.snapshot_version=input.expected_snapshot_version','proof.department_refs=input.expected_department_refs','cardinality(proof.department_refs)>0 AND cardinality(proof.eligible_reporters)>0','GROUP BY source_scope,source_corp_scope,source_app_scope,maximum_directory_age_ms,eligible_reporters'])assert.ok(statement.text.includes(fragment),fragment);
    assert.equal(statement.text.includes('SELECT * FROM resolved'),false);assert.equal(statement.text.includes('Cookie'),false);
  }
  // These constructor assertions pair with the PG/HTTP integration scenarios; they do not
  // claim execution plans, authorization race safety, throughput or a resource-budget PASS.
});
