import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeComMemberDirectory} from '../src/p2-015-wecom-member-directory.mjs';
import {createReporterDirectoryPort} from '../src/p2-015-contact-journey.mjs';

test('目录失败响应被取消，结束后中止共享请求信号',async()=>{
  let cancelled=false,signal;
  const directory=createWeComMemberDirectory({enabled:true,botId:'synthetic-bot',memberIdsConfirmed:true,
    accessTokenProvider:async()=> 'synthetic-token',fetchImpl:async(_url,options)=>{
      signal=options.signal;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:503});
    }});
  assert.equal((await directory.resolve({source:'WECOM_DIRECTORY',bot_id:'synthetic-bot',reporter_external_id:'synthetic-member'})).status,'DEFERRED');
  assert.equal(cancelled,true);assert.equal(signal.aborted,true);
});

test('目录端口成功、失败和超时都清理信号，未结束的提供者保持隔离',async()=>{
  for(const result of ['RESOLVED','FAILED','HANG']){
    let signal,finish,calls=0;
    const directory=createReporterDirectoryPort({timeoutMs:20,resolveProfile:async(_input,options)=>{
      calls++;signal=options.signal;
      if(result==='FAILED')throw new Error('synthetic-error');
      if(result==='HANG')return new Promise(resolve=>{finish=resolve;});
      return {status:'RESOLVED',snapshot:{}};
    }});
    assert.equal((await directory.resolve({})).status,result==='RESOLVED'?'RESOLVED':'DEFERRED');
    assert.equal(signal.aborted,true);
    if(result==='HANG'){
      assert.equal((await directory.resolve({})).status,'DEFERRED');assert.equal(calls,1);
      finish({status:'RESOLVED',snapshot:{}});await new Promise(resolve=>setImmediate(resolve));
    }
  }
});
