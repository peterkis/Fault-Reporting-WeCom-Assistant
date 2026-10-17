import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {appendFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {main} from '../../scripts/human-workbench-role.mjs';
import type {WeComGatewayClient} from '../../src/p2-g1-wecom-gateway.mjs';
import type {SendMsgBody} from '@wecom/aibot-node-sdk';
const settings=JSON.parse(process.env.WORKBENCH_ROLE_SETTINGS??'') as {notificationBindingsFile?:string;role:string};
const file=settings.notificationBindingsFile?join(dirname(settings.notificationBindingsFile),'boundaries.jsonl'):join(tmpdir(),new URL(process.env.PILOT_DATABASE_URL??'').pathname.slice(1)+'-worker-boundaries.jsonl');
const record=(value:object)=>appendFileSync(file,JSON.stringify(value)+'\n');
record({role:settings.role,event:'environment',has_app_secret:!!process.env.APP_SECRET,has_bot_secret:!!process.env.WECOM_BOT_SECRET,has_identity_key:!!process.env.PILOT_LOG_IDENTITY_HASH_KEY,has_reporter_secret:!!process.env.P2_016_REPORTER_HMAC_SECRET,has_unrelated_secret:!!process.env.UNRELATED_MODEL_API_KEY});
const fetchImpl:typeof fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');
 let body:unknown;
 if(url.pathname==='/cgi-bin/gettoken')body={errcode:0,access_token:'isolated-token',expires_in:7200};
 else if(url.pathname==='/cgi-bin/batch/userid_to_openuserid'){const payload=JSON.parse(String(init?.body)) as {userid_list:string[]};body={errcode:0,open_userid_list:payload.userid_list.map(userid=>({userid,open_userid:'open-'+userid}))};}
 else if(url.pathname==='/cgi-bin/auth/getuserinfo')body={errcode:0,userid:url.searchParams.get('code')==='staff'?'open-runtime-staff':'open-synthetic-A'};
 else if(url.pathname==='/cgi-bin/message/send'){record({role:settings.role,event:'app-send',payload:JSON.parse(String(init?.body))});body={errcode:0,msgid:'isolated-app-ack'};}
 else if(url.pathname==='/cgi-bin/webhook/send'){record({role:settings.role,event:'group-send',payload:JSON.parse(String(init?.body))});body={errcode:0};}
 else throw Error('ISOLATED_EXTERNAL_PATH_FORBIDDEN');
 return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};
class Sdk extends EventEmitter implements WeComGatewayClient{
 connect(){queueMicrotask(()=>this.emit('authenticated'));}
 disconnect(){this.emit('disconnected');}
 async sendMessage(target:string,body:SendMsgBody){record({role:settings.role,event:'bot-send',target,body});return {errcode:0,headers:{req_id:'isolated-bot-ack'}};}
}
await main(process.argv.slice(2),{fetchImpl,clientFactory:()=>new Sdk()}).catch(error=>{
 const code=error instanceof Error&&/^[A-Za-z0-9_: .,-]+$/u.test(error.message)?error.message:'UNAVAILABLE';
 record({role:settings.role,event:'failed',code});process.send?.({type:'role-failed',error_code:code});process.exit(1);
});
