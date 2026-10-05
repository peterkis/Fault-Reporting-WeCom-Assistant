import type { G2Manifest } from './p2-g2-validation-config.mjs';
import type { RequestOptions, ClientRequest, IncomingMessage } from 'node:http';
export interface G2NetworkCapabilities {memberOAuthEnabled?:boolean;memberDelegatedMappingEnabled?:boolean}
type NetworkInput = {url?:string;hostname?:string;host?:string;protocol?:string;port?:string|number;method?:string;socketPath?:string;
 servername?:string;headers?:{get?:(name:string)=>string|null;host?:string;Host?:string}};
type NativeRequestArguments = [value:string|URL|RequestOptions,optionsOrCallback?:RequestOptions|((response:IncomingMessage)=>void),callback?:((response:IncomingMessage)=>void)];
type NetworkOverrides = NetworkInput & {path?:string};
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { validateG2Manifest, failG2, g2Hash } from './p2-g2-validation-config.mjs';

let installed=false;
export function installG2NetworkBoundary(manifest:unknown,{memberOAuthEnabled=false,memberDelegatedMappingEnabled=false}: G2NetworkCapabilities={}){
  if(typeof memberOAuthEnabled!=='boolean')failG2('NETWORK_ENDPOINT_NOT_APPROVED');
  manifest=validateG2Manifest(manifest);if(installed)failG2('NETWORK_BOUNDARY_ALREADY_INSTALLED');
  const allowed=new Set(['http://127.0.0.1:'+(manifest as G2Manifest).listen_port,(manifest as G2Manifest).reporter_origin]);
  if((manifest as G2Manifest).mode==='live')allowed.add('https://openws.work.weixin.qq.com');
  const native={fetch:globalThis.fetch,httpRequest:http.request,httpGet:http.get,httpsRequest:https.request,httpsGet:https.get};
  function check(value:unknown,protocol:string,overrides?:unknown){
    let target;try{
      if(value instanceof URL)target=value;
      else if(typeof value==='string')target=new URL(value);
      else if((value as NetworkInput | null)?.url)target=new URL((value as NetworkInput).url as string);
      else{const host=(value as NetworkInput | null)?.hostname??(value as NetworkInput | null)?.host;target=new URL(((value as NetworkInput | null)?.protocol??protocol)+'//'+host+((value as NetworkInput | null)?.port?':'+(value as NetworkInput).port:''));}
    }catch{failG2('NETWORK_ENDPOINT_NOT_APPROVED');}
    if(overrides&&typeof overrides==='object'){
      if((overrides as NetworkOverrides).protocol)target.protocol=(overrides as NetworkOverrides).protocol as string;
      if((overrides as NetworkOverrides).hostname)target.hostname=(overrides as NetworkOverrides).hostname as string;
      else if((overrides as NetworkOverrides).host)target.host=(overrides as NetworkOverrides).host as string;
      if((overrides as NetworkOverrides).port!==undefined)target.port=String((overrides as NetworkOverrides).port);
      if((overrides as NetworkOverrides).socketPath)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
    }
    const approvedWebhook=(manifest as G2Manifest).mode==='live'&&((manifest as G2Manifest).scope.group_webhook_routes??[]).some(r=>r.endpoint_hash===g2Hash(target.href));
    const method=String((overrides as NetworkOverrides)?.method??(value as NetworkInput | null)?.method??'GET').toUpperCase();
    const parameters=target.searchParams;
    const approvedDirectory=(manifest as G2Manifest).mode==='live'&&(manifest as G2Manifest).scope.member_directory?.enabled===true
      &&target.origin==='https://qyapi.weixin.qq.com'&&!target.hash&&method==='GET'
      &&(!(overrides as NetworkOverrides)?.path||(overrides as NetworkOverrides).path===target.pathname+target.search)
      &&parameters.size===2&&parameters.has('access_token')&&Boolean(parameters.get('access_token'))
      &&((target.pathname==='/cgi-bin/user/get'&&parameters.has('userid')&&(manifest as G2Manifest).scope.person_hashes.includes(g2Hash(parameters.get('userid') as string)))
        ||(target.pathname==='/cgi-bin/department/get'&&parameters.has('id')&&/^[1-9][0-9]{0,14}$/u.test(parameters.get('id') as string)));
    const approvedMemberOAuth=memberOAuthEnabled&&(manifest as G2Manifest).mode==='live'&&(manifest as G2Manifest).scope.reporter_access_policy==='MEMBER_REQUIRED'
      &&target.origin==='https://qyapi.weixin.qq.com'&&!target.hash&&method==='GET'
      &&(!(overrides as NetworkOverrides)?.path||(overrides as NetworkOverrides).path===target.pathname+target.search)&&parameters.size===2
      &&((target.pathname==='/cgi-bin/auth/getuserinfo'&&parameters.getAll('code').length===1&&parameters.getAll('access_token').length===1
        &&Boolean(parameters.get('code'))&&Buffer.byteLength(parameters.get('code') as string)<=512&&Boolean(parameters.get('access_token'))&&(parameters.get('access_token') as string).length<=4096)
        ||(target.pathname==='/cgi-bin/gettoken'&&parameters.getAll('corpid').length===1&&parameters.getAll('corpsecret').length===1
          &&Boolean(parameters.get('corpid'))&&(parameters.get('corpid') as string).length<=128&&Boolean(parameters.get('corpsecret'))&&(parameters.get('corpsecret') as string).length<=512));
    const approvedMapping=memberOAuthEnabled&&memberDelegatedMappingEnabled&&(manifest as G2Manifest).mode==='live'
      &&(manifest as G2Manifest).scope.reporter_access_policy==='MEMBER_REQUIRED'&&target.origin==='https://qyapi.weixin.qq.com'
      &&method==='POST'&&target.pathname==='/cgi-bin/batch/userid_to_openuserid'&&!target.hash
      &&parameters.size===1&&Boolean(parameters.get('access_token'))&&(parameters.get('access_token') as string).length<=4096
      &&(!(overrides as NetworkOverrides)?.path||(overrides as NetworkOverrides).path===target.pathname+target.search);
    if((!allowed.has(target.origin)&&!approvedWebhook&&!approvedDirectory&&!approvedMemberOAuth&&!approvedMapping)||target.username||target.password||(value as NetworkInput | null)?.socketPath)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
    const servername=(overrides as NetworkOverrides)?.servername??(value as NetworkInput | null)?.servername;
    if(servername&&servername!==target.hostname)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
    const headers=(overrides as NetworkOverrides)?.headers??(value as NetworkInput | null)?.headers;
    const host=headers?.get?.('host')??headers?.host??headers?.Host;
    if(host&&new URL(target.protocol+'//'+host).origin!==target.origin)failG2('NETWORK_ENDPOINT_NOT_APPROVED');
  }
  globalThis.fetch=async(...args: Parameters<typeof fetch>)=>{check(args[0],'https:',args[1]);return native.fetch(args[0],{...args[1],redirect:'error'});};
  http.request=function(this:unknown,...args: NativeRequestArguments){check(args[0],'http:',args[1]);return native.httpRequest.apply(this,args as Parameters<typeof http.request>);};
  http.get=function(this:unknown,...args: NativeRequestArguments){check(args[0],'http:',args[1]);return native.httpGet.apply(this,args as Parameters<typeof http.get>);};
  https.request=function(this:unknown,...args: NativeRequestArguments){check(args[0],'https:',args[1]);return native.httpsRequest.apply(this,args as Parameters<typeof https.request>);};
  https.get=function(this:unknown,...args: NativeRequestArguments){check(args[0],'https:',args[1]);return native.httpsGet.apply(this,args as Parameters<typeof https.get>);};
  syncBuiltinESMExports();installed=true;
  return ()=>{globalThis.fetch=native.fetch;http.request=native.httpRequest;http.get=native.httpGet;
    https.request=native.httpsRequest;https.get=native.httpsGet;syncBuiltinESMExports();installed=false;};
}
export async function probeG2NetworkBoundary(){
  if(!installed)failG2('NETWORK_BOUNDARY_REQUIRED');
  let blocked=0;
  try{await fetch('https://api.openai.com/v1/models');}catch(e){if((e as {code?:string}).code==='P2_G2_NETWORK_ENDPOINT_NOT_APPROVED')blocked++;else throw e;}
  try{https.request('https://api.deepseek.com/models');}catch(e){if((e as {code?:string}).code==='P2_G2_NETWORK_ENDPOINT_NOT_APPROVED')blocked++;else throw e;}
  return {model_network_unreachable:blocked===2,blocked_model_http_probes:blocked,network_boundary:'PROCESS_HTTP_ALLOWLIST_NOT_OS_FIREWALL'};
}
