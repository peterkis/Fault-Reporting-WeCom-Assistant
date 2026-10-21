import assert from 'node:assert/strict';
import {test} from 'node:test';
import {criticalJavaScript,interactionMetric,isBusinessSelect,percentiles} from './h5-performance-metrics.mjs';

test('performance percentiles retain every finite sample and reject missing evidence',()=>{
  const values=Array.from({length:20},(_,i)=>i+1),result=percentiles(values);
  assert.deepEqual(result,{count:20,min:1,p50:10,p75:15,p95:19,max:20});assert.deepEqual(values,Array.from({length:20},(_,i)=>i+1));
  for(const invalid of [[],[NaN],[Infinity],[-1]])assert.throws(()=>percentiles(invalid),/FINITE_SAMPLES_REQUIRED/u);
});
test('critical script budget counts early concurrent dependencies once and excludes late dialog code',()=>{
  const base={status:200,start_ms:0,end_ms:300,mime:'text/javascript',encoded_bytes:10,decoded_bytes:30,cached:false};
  const result=criticalJavaScript([{...base,path:'/entry.js'},{...base,path:'/entry.js'},{...base,path:'/vendor.js',start_ms:10},{...base,path:'/dialog.js',start_ms:600},{...base,path:'/missing.js',status:404}],500);
  assert.deepEqual(result,{paths:['/entry.js','/vendor.js'],encoded_bytes:20,decoded_bytes:60});
});
test('business SQL budget counts permission and retention checks without hiding them as infrastructure',()=>{
  for(const sql of ['SELECT 1 FROM intake.web_request_binding FOR SHARE','WITH rows AS (SELECT * FROM directory.member_current) SELECT * FROM rows','SELECT * FROM pilot_ticket.ticket'])assert.equal(isBusinessSelect(sql),true,sql);
  for(const sql of ['BEGIN','SAVEPOINT timeline','SET LOCAL statement_timeout=250',"SELECT to_regclass('intake.web_request_binding')",'SELECT * FROM platform.schema_migration'])assert.equal(isBusinessSelect(sql),false,sql);
});

test('qualified physical clocks and catalog joins never hide protected business reads',()=>{
  for(const sql of [
    "WITH reports AS (SELECT b.intake_id FROM intake.web_request_binding b WHERE b.retention_until_epoch_ms>pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) OPERATOR(pg_catalog.*) 1000::pg_catalog.numeric)::pg_catalog.int8) SELECT count(*) FROM reports",
    "SELECT m.* FROM directory.member_current m WHERE EXISTS(SELECT 1 FROM pg_catalog.pg_class)",
    "SELECT * FROM pilot_ticket.ticket WHERE to_regclass('intake.web_request_binding') IS NOT NULL",
    'SELECT * FROM "intake"."web_request_binding"',
    '/* clock guard */ SELECT 1 FROM ONLY intake.web_request_binding FOR SHARE',
    'WITH metadata AS (SELECT 1 FROM information_schema.tables) SELECT * FROM directory.member_current'
  ])assert.equal(isBusinessSelect(sql),true,sql);
});

test('metadata literals, quoted identifiers and nested comments cannot fabricate business reads',()=>{
  for(const sql of [
    "SELECT to_regclass('intake.web_request_binding')",
    "SELECT 'FROM intake.web_request_binding' AS description",
    "SELECT E'escaped\\\' FROM intake.web_request_binding' AS description",
    'SELECT $$FROM intake.web_request_binding$$',
    'SELECT $metadata$JOIN directory.member_current$metadata$',
    'SELECT "FROM intake.web_request_binding" FROM pg_catalog.pg_class',
    'SELECT 1 /* outer /* FROM intake.web_request_binding */ still comment */ FROM pg_catalog.pg_class',
    'SELECT 1 -- FROM intake.web_request_binding\nFROM pg_catalog.pg_class',
    "SELECT * FROM platform.schema_migration WHERE migration_id='FROM intake.web_request_binding'"
  ])assert.equal(isBusinessSelect(sql),false,sql);
});
test('interaction evidence cannot pass without a trusted interaction or Event Timing support',()=>{
  const base={lcp:100,cls:0,supported:['event'],events:[],trustedClicks:0,errors:[]};
  assert.equal(interactionMetric(base).status,'NOT_RUN');
  assert.equal(interactionMetric({...base,supported:[],trustedClicks:1}).status,'NOT_RUN');
  assert.deepEqual(interactionMetric({...base,trustedClicks:2}),{status:'UPPER_BOUND',milliseconds:16,trusted_clicks:2,observed_interactions:0});
  assert.equal(interactionMetric({...base,trustedClicks:1,events:[{id:1,duration:64},{id:1,duration:80}]}).milliseconds,80);
});
