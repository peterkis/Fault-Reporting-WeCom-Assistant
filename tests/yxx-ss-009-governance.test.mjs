import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {g2TestFiles} from '../scripts/p2-g2-synthetic-e2e.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {readYxxLocalValidationScope} from '../src/yxx-self-service-validation-scope.mjs';
import {SS009_BASE,evidenceHash} from '../src/yxx-self-service-verification.mjs';
import {g2EvidenceTime,assertG2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const json=file=>JSON.parse(readFileSync(file,'utf8'));

test('SS-009 governance preserves historical baseline user files parent gate and full collector coverage',()=>{
  assert.equal(git(['merge-base',SS009_BASE,'HEAD']),SS009_BASE);
  assert.ok(readYxxLocalValidationScope(process.cwd()));
  const start=json('evidence/yxx-ss-009-start.json');assertG2EvidenceTime(start);
  assert.equal(evidenceHash(readFileSync('.gitignore')),start.gitignore_sha256);assert.equal(git(['rev-parse',':.gitignore']),start.gitignore_index);
  const phase=json('plans/current_phase.json');assert.equal(phase.last_completed_task,'P2-012');assert.equal(phase.last_completed_gate,'P2-G1');assert.equal(phase.last_completed_architecture_task,'ARCH-006');
  const files=g2TestFiles('full'),candidate=g2CandidateInventory();
  for(const name of ['evidence/p2-g2-yxx-entry-creation-v2-regression-run.json','evidence/yxx-ss-008-pr18-full-regression-run.json'])for(const file of json(name).files)assert.ok(files.includes(file.path));
  assert.ok(files.length>=183);assert.equal(new Set(files).size,files.length);for(const file of files)assert.ok(candidate.files.some(f=>f.path===file));
  const stamp=g2EvidenceTime();assertG2EvidenceTime(stamp);assert.throws(()=>assertG2EvidenceTime({...stamp,event_epoch_ms:Number(stamp.event_epoch_ms)}));
});

const parse=file=>JSON.parse(execFileSync('python',['-c','import sys,json,yaml; print(json.dumps(yaml.safe_load(sys.stdin.buffer.read().decode("utf-8"))))'],{input:readFileSync(file,'utf8'),encoding:'utf8'}));
test('SS-009 parsed OpenAPI resolves seven member APIs consistently with unique operation IDs and shared time types',()=>{
  const shared=parse('contracts/yxx_self_service.openapi.yaml');
  const endpoints=Object.keys(shared.paths).filter(p=>p.startsWith('/api/yixiaoxiu/'));assert.equal(endpoints.length,7);
  for(const file of ['contracts/openapi.yaml','contracts/conversation_center.openapi.yaml']){
    const doc=parse(file),seen=new Set();
    for(const [route,raw] of Object.entries(doc.paths)){
      let item=raw;
      if(raw.$ref){const [relative,pointer]=raw.$ref.split('#');const target=parse('contracts/'+relative.replace(/^\.\//u,''));item=pointer.split('/').slice(1).reduce((v,k)=>v[k.replaceAll('~1','/').replaceAll('~0','~')],target);assert.ok(item);}
      for(const method of ['get','post','put','delete','patch'])if(item[method]?.operationId){assert.ok(!seen.has(item[method].operationId));seen.add(item[method].operationId);}
      if(endpoints.includes(route))assert.deepEqual(item,shared.paths[route]);
    }
    for(const route of endpoints)assert.ok(doc.paths[route]);
  }
  for(const file of ['contracts/yxx_self_service_request_detail.schema.json','contracts/yxx_self_service_receipt.schema.json']){
    // Schemas use the existing platform contracts rather than RFC3339 dates.
    const text=readFileSync(file,'utf8');assert.ok(!text.includes('"format": "date-time"'));assert.ok(/local_datetime|epoch_ms_string/u.test(text));
  }
});
