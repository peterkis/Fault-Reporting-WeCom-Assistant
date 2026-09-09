import test from 'node:test';
import assert from 'node:assert/strict';
import { createReporterDirectoryPort } from '../src/p2-015-contact-journey.mjs';

test('D12-020 unresolved directory call defers within deadline without growing pending calls', async () => {
  let calls=0,finish,signal;
  const directory=createReporterDirectoryPort({timeoutMs:20,resolveProfile:(_input,options)=>{
    calls++;signal=options?.signal;return new Promise(resolve=>{finish=resolve;});
  }});
  const outcome=await Promise.race([directory.resolve({reporter_identity_hash:'a'.repeat(64)}),
    new Promise(resolve=>setTimeout(()=>resolve('NO_DEADLINE'),250))]);
  assert.deepEqual(outcome,{status:'DEFERRED',snapshot:{}});assert.equal(signal.aborted,true);
  for(let i=0;i<5;i++)assert.deepEqual(await directory.resolve({reporter_identity_hash:'b'.repeat(64)}),{status:'DEFERRED',snapshot:{}});
  assert.equal(calls,1);finish({status:'RESOLVED',snapshot:{source:'WECOM_DIRECTORY',version:'late'}});
  await new Promise(resolve=>setImmediate(resolve));
});
