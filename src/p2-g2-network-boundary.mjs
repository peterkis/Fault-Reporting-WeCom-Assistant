import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { validateG2Manifest, failG2, g2Hash } from './p2-g2-validation-config.mjs';

let installed=false;
export function installG2NetworkBoundary(manifest,{memberOAuthEnabled=false}={}){
  if(typeof memberOAuthEnabled!=='boolean')failG2('NETWORK_ENDPOINT_NOT_APPROVED');
  manifest=validateG2Manifest(manifest);if(installed)failG2('NETWORK_BOUNDARY_ALREADY_INSTALLED');
  const allowed=new Set(['http://127.0.0.1:'+manifest.listen_port,manifest.reporter_origin]);
  if(manifest.mode==='live')allowed.add('https://openws.work.weixin.qq.com');
  const native={fetch:globalThis.fetch,httpRequest:http.request,httpGet:http.get,httpsRequest:https.request,httpsGet:https.get};
  function check(value,protocol,overrides){
    let target;try{
      if(value instanceof URL)target=value;
      else if(typeof value==='string')target=new URL(value);
      else if(value?.url)target=new URL(value.url);
      else{const host=value?.hostname??value?.host;target=new URL((value?.protocol??protocol)+'//'+host+(value?.port?':'+value.port:''));}
    }catch{failG2('NETWORK_ENDPOINT_NOT_APPROVED');}
    if(overrides&&typeof overrides==='object'){
      if(overrides.protocol)target.protocol=overrides.protocol;
      if(overrides.hostname)target.hostname=overrides.hostname;
      else if(overrides.host)target.host=overrides.host;
      if(overrides.port!==undefined)target.port=String(overrides.port);
      if(overrides.socketPath)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
    }
    const approvedWebhook=manifest.mode==='live'&&(manifest.scope.group_webhook_routes??[]).some(r=>r.endpoint_hash===g2Hash(target.href));
    const method=String(overrides?.method??value?.method??'GET').toUpperCase();
    const parameters=target.searchParams;
    const approvedDirectory=manifest.mode==='live'&&manifest.scope.member_directory?.enabled===true
      &&target.origin==='https://qyapi.weixin.qq.com'&&!target.hash&&method==='GET'
      &&(!overrides?.path||overrides.path===target.pathname+target.search)
      &&parameters.size===2&&parameters.has('access_token')&&Boolean(parameters.get('access_token'))
      &&((target.pathname==='/cgi-bin/user/get'&&parameters.has('userid')&&manifest.scope.person_hashes.includes(g2Hash(parameters.get('userid'))))
        ||(target.pathname==='/cgi-bin/department/get'&&parameters.has('id')&&/^[1-9][0-9]{0,14}$/u.test(parameters.get('id'))));
    const approvedMemberOAuth=memberOAuthEnabled&&manifest.mode==='live'&&manifest.scope.reporter_access_policy==='MEMBER_REQUIRED'
      &&target.origin==='https://qyapi.weixin.qq.com'&&!target.hash&&method==='GET'
      &&(!overrides?.path||overrides.path===target.pathname+target.search)&&parameters.size===2
      &&((target.pathname==='/cgi-bin/auth/getuserinfo'&&parameters.getAll('code').length===1&&parameters.getAll('access_token').length===1
        &&Boolean(parameters.get('code'))&&Buffer.byteLength(parameters.get('code'))<=512&&Boolean(parameters.get('access_token'))&&parameters.get('access_token').length<=4096)
        ||(target.pathname==='/cgi-bin/gettoken'&&parameters.getAll('corpid').length===1&&parameters.getAll('corpsecret').length===1
          &&Boolean(parameters.get('corpid'))&&parameters.get('corpid').length<=128&&Boolean(parameters.get('corpsecret'))&&parameters.get('corpsecret').length<=512));
    if((!allowed.has(target.origin)&&!approvedWebhook&&!approvedDirectory&&!approvedMemberOAuth)||target.username||target.password||value?.socketPath)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
    const servername=overrides?.servername??value?.servername;
    if(servername&&servername!==target.hostname)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
    const headers=overrides?.headers??value?.headers;
    const host=headers?.get?.('host')??headers?.host??headers?.Host;
    if(host&&new URL(target.protocol+'//'+host).origin!==target.origin)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
  }
  globalThis.fetch=async(...args)=>{check(args[0],'https:',args[1]);return native.fetch(args[0],{...args[1],redirect:'error'});};
  http.request=function(...args){check(args[0],'http:',args[1]);return native.httpRequest.apply(this,args);};
  http.get=function(...args){check(args[0],'http:',args[1]);return native.httpGet.apply(this,args);};
  https.request=function(...args){check(args[0],'https:',args[1]);return native.httpsRequest.apply(this,args);};
  https.get=function(...args){check(args[0],'https:',args[1]);return native.httpsGet.apply(this,args);};
  syncBuiltinESMExports();installed=true;
  return ()=>{globalThis.fetch=native.fetch;http.request=native.httpRequest;http.get=native.httpGet;
    https.request=native.httpsRequest;https.get=native.httpsGet;syncBuiltinESMExports();installed=false;};
}
export async function probeG2NetworkBoundary(){
  if(!installed)failG2('NETWORK_BOUNDARY_REQUIRED');
  let blocked=0;
  try{await fetch('https://api.openai.com/v1/models');}catch(e){if(e.code==='P2_G2_NETWORK_ENDPOINT_NOT_APPROVED')blocked++;else throw e;}
  try{https.request('https://api.deepseek.com/models');}catch(e){if(e.code==='P2_G2_NETWORK_ENDPOINT_NOT_APPROVED')blocked++;else throw e;}
  return {model_network_unreachable:blocked===2,blocked_model_http_probes:blocked,network_boundary:'PROCESS_HTTP_ALLOWLIST_NOT_OS_FIREWALL'};
}
