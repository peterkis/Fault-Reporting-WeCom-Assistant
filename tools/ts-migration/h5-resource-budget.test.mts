import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {H5_MEMORY_BYTES,decodeWindowsBudgetRecord,prepareWindowsResourceBudget,runWindowsResourceBudget,validateWindowsBudgetOptions} from './h5-resource-budget.mjs';

test('hard resource budget rejects relative paths and invalid sample/deadline inputs',()=>{
  const valid={evidenceRoot:resolve('tmp','h5-resource-budget-input'),executable:process.execPath,args:[],cwd:process.cwd(),timeoutMs:10000};
  assert.doesNotThrow(()=>validateWindowsBudgetOptions(valid));
  assert.throws(()=>validateWindowsBudgetOptions({...valid,evidenceRoot:'relative'}),/ABSOLUTE_PATH_REQUIRED/u);
  assert.throws(()=>validateWindowsBudgetOptions({...valid,timeoutMs:0}),/INVALID_TIMEOUT/u);
  assert.throws(()=>validateWindowsBudgetOptions({...valid,sampleMs:1}),/INVALID_SAMPLE_INTERVAL/u);
  assert.throws(()=>validateWindowsBudgetOptions({...valid,args:['bad\0argument']}),/INVALID_ARGUMENT/u);
  assert.throws(()=>decodeWindowsBudgetRecord({schema_version:1,kind:'WIN32_JOB_OBJECT',status:'COMPLETED',limits:{cpu_count:4}}),/INVALID_LIMITS/u);
});

test('Windows kernel job enforces CPU, aggregate commit, inherited membership, breakaway denial and kill-on-close',{skip:process.platform!=='win32',timeout:120000},async t=>{
  const root=process.env.H5_RESOURCE_PROBE_ROOT?resolve(process.env.H5_RESOURCE_PROBE_ROOT):await mkdtemp(join(tmpdir(),'h5-resource-budget-'));
  await mkdir(root,{recursive:true});
  const prepared=await prepareWindowsResourceBudget(join(root,'helper'));
  const observations:Record<string,unknown>={native:prepared};
  for(const kind of ['cpu','memory-single','memory-total','escape','close']){
    await t.test(kind,async()=>{
      const output=join(root,`${kind}-output`),run=join(root,`${kind}-job`);
      const record=await runWindowsResourceBudget({evidenceRoot:run,executable:prepared.executable,args:['probe',kind,output],cwd:root,timeoutMs:30000,sampleMs:100});
      assert.equal(record.status,'COMPLETED',JSON.stringify(record));assert.equal(record.root_exit_code,0,JSON.stringify(record));assert.equal(record.cleanup_active_processes,0);
      assert.equal(record.all_sampled_processes_in_job,true);assert.equal(record.all_sampled_affinities_within_job,true);assert.ok(record.max_observed_private_commit_sum_bytes<=H5_MEMORY_BYTES);assert.ok(record.max_observed_resident_sum_bytes<=H5_MEMORY_BYTES);
      const raw:unknown=JSON.parse(await readFile(join(output,'probe.json'),'utf8'));
      assert.ok(raw&&typeof raw==='object'&&!Array.isArray(raw));
      const probe=Object.fromEntries(Object.entries(raw));observations[kind]={record,probe};
      if(kind==='cpu'){
        assert.equal(typeof probe.observed_cores,'number');assert.ok(typeof probe.observed_cores==='number'&&probe.observed_cores<2.15,JSON.stringify(probe));
        assert.ok(typeof probe.observed_cores==='number'&&probe.observed_cores>0.5,'probe did not exercise CPU pressure');
        assert.equal(probe.unbounded_demand_assertion,'RED_EXPECTED');
      }else if(kind==='memory-single'){
        assert.equal(probe.allocation_succeeded,false);assert.equal(probe.win32_error,1455);
        // The kernel reports PeakJobMemoryUsed above the limit for the rejected reservation on
        // this Windows build. Do not relabel it as successfully allocated/resident memory.
        const limits:unknown=JSON.parse(await readFile(join(run,'enforced-limits.json'),'utf8'));
        assert.ok(limits&&typeof limits==='object'&&'host_available_commit_bytes' in limits&&typeof limits.host_available_commit_bytes==='number'&&limits.host_available_commit_bytes>6*1024**3,'host commit shortage would invalidate the job-limit probe');
      }
      else if(kind==='memory-total'){
        assert.equal(probe.child_exit_code,0);assert.ok(record.peak_active_processes>=2);
        const child:unknown=JSON.parse(await readFile(join(output,'child','probe.json'),'utf8'));assert.ok(child&&typeof child==='object'&&'allocation_succeeded' in child&&'pid' in child);assert.equal(child.allocation_succeeded,false);
        const samples=(await readFile(join(run,'samples.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as unknown);
        assert.ok(samples.some(sample=>sample&&typeof sample==='object'&&'processes' in sample&&Array.isArray(sample.processes)&&sample.processes.some((member:unknown)=>member&&typeof member==='object'&&'pid' in member&&'in_job' in member&&member.pid===child.pid&&member.in_job===true)),'the rejected child allocation must belong to the same sampled job');
      }else if(kind==='escape')assert.equal(probe.breakaway_create_succeeded,false);
      else assert.equal(probe.killed_on_last_handle_close,true);
    });
  }
  await writeFile(join(root,'probe-results.json'),JSON.stringify({schema_version:1,status:'PASS',observations},null,2));
});
