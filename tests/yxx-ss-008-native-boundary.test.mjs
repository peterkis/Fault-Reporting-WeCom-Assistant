import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createYxxSelfServiceNativeHttp } from '../src/yxx-self-service-native-http.mjs';

test('SS-008 submit and supplement suppress an old member receipt after a committed identity change',async()=>{
  let native,binding='a',committed=0;
  const server=createServer(async(request,response)=>{await native.handler({request,response,url:new URL(request.url,origin)});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const csrf='synthetic-ss008-csrf-token-at-least-32';
  const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
  const accept=async()=>{committed++;binding='b';return {replayed:false,receipt:{request_ref:'A'.repeat(32),status:'ACCEPTED'}};};
  native=createYxxSelfServiceNativeHttp({publicOrigin:origin,oauth:{authenticate:()=>({})},oauthHttp:async()=>false,
    command:{accept},supplement:{accept},query:{list(){},detailWithEtag(){},timeline(){},commandStatus(){}},featureFlags:flags,
    recoveryBindingSecret:'synthetic-ss008-recovery-secret-at-least-32',
    authenticateMember:async()=>({profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:csrf,
      canonical_reporter_binding:binding.repeat(64),source_corp_scope:'corp',source_app_scope:'app'})});
  try{
    for(const path of ['/api/yixiaoxiu/requests','/api/yixiaoxiu/requests/'+'A'.repeat(32)+'/supplements']){
      binding='a';const before=committed;
      const response=await fetch(origin+path,{method:'POST',headers:{cookie:'__Host-wecom_session=synthetic',origin,'content-type':'application/json','x-csrf-token':csrf},body:'{}'});
      assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/request_ref|ACCEPTED/);
      assert.equal(committed,before+1,'the already committed fact is preserved');
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
