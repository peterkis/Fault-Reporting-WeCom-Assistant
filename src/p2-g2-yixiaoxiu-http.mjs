import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {textHashP2016} from './p2-016-domain-contracts.mjs';
import {beginWeComOAuth,readWeComCookie,browserName,sessionName,logoutWeComBrowser,joinWeComBrowserBindings} from './p2-g2-wecom-oauth-http.mjs';
import {WeComOAuthError} from './p2-g2-wecom-web-oauth.mjs';
import {YxxEntryError,failYxx,exactYxx} from './p2-g2-yixiaoxiu-contract.mjs';

const root='/wecom/yixiaoxiu/';
const assets=Object.freeze({'/reporter/':['index.html','text/html'],'/reporter/open':['index.html','text/html'],
  '/reporter/reporter.js':['reporter.js','text/javascript'],'/reporter/reporter.css':['reporter.css','text/css']});
const headers=Object.freeze({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"});
function json(response,status,body,extra={}){response.writeHead(status,{'content-type':'application/json; charset=utf-8',...extra});response.end(status===304?undefined:JSON.stringify(body));}
async function body(request){
  if((request.headers['content-type']??'').split(';')[0].trim()!=='application/json')failYxx('INPUT_INVALID');
  const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>2048)failYxx('INPUT_INVALID');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{failYxx('INPUT_INVALID');}
}
async function asset(response,item){
  let content=await readFile(new URL('../web/p2-reporter/'+item[0],import.meta.url),'utf8');
  if(item[0]==='index.html')content=content.replace('<html lang="zh-CN">','<html lang="zh-CN" data-identity-mode="MEMBER_REQUIRED">');
  response.writeHead(200,{'content-type':item[1]+'; charset=utf-8'});response.end(content);
}
export function createYxxMemberHttp({oauth,oauthHttp,access,timeline,authorizer,publicOrigin,now=Date.now}){
  const origin=new URL(publicOrigin);
  if(origin.protocol!=='https:'||origin.origin!==publicOrigin)failYxx('CONFIG_INVALID');
  const entries=new Map();let closed=false;
  const sweep=()=>{for(const [key,entry] of entries)if(entry.expires<=now()||!oauth.browserValid(entry.browser))entries.delete(key);};
  const handler=async({request,response,url:inputUrl})=>{
    if(!inputUrl.pathname.startsWith(root)&&!inputUrl.pathname.startsWith('/api/reporter')&&!inputUrl.pathname.startsWith('/reporter'))return false;
    for(const [key,value] of Object.entries(headers))response.setHeader(key,value);
    try{
      if(closed)failYxx('UNAVAILABLE');
      if(request.headers.host!==origin.host)failYxx('ORIGIN_INVALID');
      if(typeof request.url!=='string'||!request.url.startsWith('/')||request.url.startsWith('//')||Buffer.byteLength(request.url)>2048)failYxx('INPUT_INVALID');
      const url=new URL(request.url,publicOrigin),path=url.pathname;
      if(url.origin!==publicOrigin)failYxx('ORIGIN_INVALID');
      if(request.url.split('?')[0]!==path)failYxx('INPUT_INVALID');
      const api=path.startsWith('/api/reporter');
      if((request.method==='POST'||api)&&(request.headers.origin&&request.headers.origin!==publicOrigin||request.headers['sec-fetch-site']==='cross-site'))failYxx('ORIGIN_INVALID');
      if(request.method==='POST'&&request.headers.origin!==publicOrigin)failYxx('ORIGIN_INVALID');
      if(request.method==='POST'&&(path==='/api/reporter/logout'||path===root+'logout')){
        if(url.search)failYxx('INPUT_INVALID');exactYxx(await body(request),[]);
        const clear=logoutWeComBrowser({request,oauth});sweep();json(response,200,{logged_out:true},{'set-cookie':clear});return true;
      }
      if(path==='/api/reporter/access/exchange')failYxx('LEGACY_EXCHANGE_DISABLED');
      if(request.method==='GET'&&(path==='/api/reporter/member/session'||path==='/api/reporter/bootstrap')){
        if(url.search)failYxx('INPUT_INVALID');authorizer.authenticate(readWeComCookie(request,sessionName));
        json(response,200,{identity_mode:'MEMBER_REQUIRED',authenticated:true,read_only:true});return true;
      }
      if(request.method==='POST'&&path==='/api/reporter/member-entry/prepare'){
        if(url.search)failYxx('INPUT_INVALID');
        const value=exactYxx(await body(request),['grant']);
        let locator;try{locator=access.legacyLocator(value.grant);}catch{failYxx('INPUT_INVALID');}
        joinWeComBrowserBindings(request,oauth);sweep();const browser=oauth.browserBinding(readWeComCookie(request,browserName));
        if(entries.size>=1024||[...entries.values()].filter(e=>oauth.sameBrowserBinding(e.browser,browser)).length>=8)failYxx('BUSY');
        const entryRef=randomBytes(32).toString('hex');entries.set(entryRef,{locator,browser,expires:now()+300000});
        json(response,200,{entry_path:root+'continue/'+entryRef},{'set-cookie':`${browserName}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1200`});return true;
      }
      const continuation=/^\/wecom\/yixiaoxiu\/continue\/([a-f0-9]{64})$/u.exec(path);
      if(request.method==='GET'&&continuation){
        if(url.search)failYxx('INPUT_INVALID');sweep();const entry=entries.get(continuation[1]);
        joinWeComBrowserBindings(request,oauth);
        if(!entry||!oauth.sameBrowserBinding(entry.browser,readWeComCookie(request,browserName))){
          response.writeHead(404,{'content-type':'text/html; charset=utf-8'});
          response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>入口已失效</title><body><main><h1>入口已失效</h1><p>请重新点击原工单卡片，重新认证后查看进度。</p></main></body></html>');return true;
        }
        const token=readWeComCookie(request,sessionName);
        try{oauth.authenticate(token);}catch(error){if(!(error instanceof WeComOAuthError))throw error;beginWeComOAuth({request,response,oauth,returnPath:path});return true;}
        const ref=await authorizer.locate({sessionToken:token,locator:entry.locator,access});
        authorizer.authenticate(token);entries.delete(continuation[1]);
        response.writeHead(303,{location:root+'tickets/'+ref});response.end();return true;
      }
      const page=/^\/wecom\/yixiaoxiu\/tickets\/([A-Za-z0-9_-]{32})$/u.exec(path);
      if(request.method==='GET'&&page){
        if(url.search)failYxx('INPUT_INVALID');
        try{oauth.authenticate(readWeComCookie(request,sessionName));}catch(error){if(!(error instanceof WeComOAuthError))throw error;beginWeComOAuth({request,response,oauth,returnPath:path});return true;}
        await asset(response,['index.html','text/html']);return true;
      }
      if(assets[path]){if(request.method!=='GET'||url.search)failYxx('INPUT_INVALID');await asset(response,assets[path]);return true;}
      const ticket=/^\/api\/reporter\/tickets\/([A-Za-z0-9_-]{32})(\/timeline)?$/u.exec(path);
      if(request.method==='GET'&&ticket){
        const allowed=ticket[2]?['cursor','limit']:[];
        if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))failYxx('INPUT_INVALID');
        const token=readWeComCookie(request,sessionName),input={sessionToken:token,publicRef:ticket[1]};
        const result=ticket[2]?await timeline.timeline({...input,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}):await timeline.detail(input);
        authorizer.authenticate(token);
        const etag='"'+textHashP2016(JSON.stringify(result))+'"';
        json(response,request.headers['if-none-match']===etag?304:200,result,{etag});return true;
      }
      if(path.startsWith(root+'tickets/')||path.startsWith('/api/reporter/tickets/'))failYxx('INPUT_INVALID');
      if(path.startsWith(root))return oauthHttp({request,response,url});
      failYxx('NOT_FOUND');
    }catch(error){
      let selected=error;
      if(!(error instanceof YxxEntryError))selected=new YxxEntryError(/^P2_016_(CURSOR|LIMIT|INPUT)_INVALID$/u.test(error?.code??'')?'INPUT_INVALID':'UNAVAILABLE');
      json(response,selected.status,{error:{code:selected.code,retryable:selected.status>=500}});return true;
    }
  };
  return Object.freeze({handler,close(){closed=true;entries.clear();authorizer.close();}});
}
