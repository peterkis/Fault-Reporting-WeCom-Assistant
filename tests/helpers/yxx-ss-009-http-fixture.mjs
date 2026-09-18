import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {createYxxDelegatedIdentityMapping} from '../../src/p2-g2-yixiaoxiu-delegated-identity.mjs';

const origin='https://127.0.0.1';
const secret='ss009-synthetic-secret-at-least-32-bytes';
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
const config={enabled:true,corpId:'synthetic-corp',agentId:'1000002',botId:'bot-test',identityMode:'VERIFIED_DELEGATED_MAPPING',
  memberIdsConfirmed:true,proofRef:'tests/ss009-synthetic-mapping',proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST',reporterUserIds:['member-a','member-b']};
const oauthOptions={enabled:true,publicOrigin:origin,corpId:config.corpId,agentId:config.agentId,resolveCode:async code=>({userid:code==='a'?'open-a':'open-b'})};
async function mapping(){return createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'member-a',open_userid:'open-a'},{userid:'member-b',open_userid:'open-b'}]}))});}
function browser(server,initialCookie=''){
  const cookies=new Map(initialCookie?[[initialCookie.name,initialCookie.value]]:[]);
  return {cookies,async request(path,{method='GET',body,headers={}}={}){
    const result=await new Promise((resolve,reject)=>{
      const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{host:'127.0.0.1',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...headers}},res=>{
        const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
    for(const c of result.headers['set-cookie']??[]){const [k,v]=c.split(';')[0].split('=');cookies.set(k,v);}
    return {...result,json:()=>JSON.parse(result.text)};
  }};
}
async function login(client,code='a'){
  const begin=await client.request('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);
  const state=new URL(begin.headers.location).searchParams.get('state');
  assert.equal((await client.request('/wecom/yixiaoxiu/callback?state='+state+'&code='+code)).status,303);
}
const input=description=>({schema_version:1,client_command_id:randomUUID(),description,location:{text:null,unknown:true},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null});
const post=(body,csrf)=>({method:'POST',body,headers:{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':body.client_command_id,
  ...((body.expected_version??body.expected_row_version)!==undefined?{'if-match':'"'+(body.expected_version??body.expected_row_version)+'"'}:{})}});
async function eventually(run){for(let i=0;i<100;i++){const value=await run();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('SS009_WAIT_FAILED');}


export {origin,secret,flags,config,oauthOptions,mapping,browser,login,input,post,eventually};
