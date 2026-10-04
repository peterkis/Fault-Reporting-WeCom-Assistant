import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import type { ReporterAccess } from './p2-016-reporter-access.mjs';
import type { ReporterTimeline } from './p2-016-reporter-timeline.mjs';
export interface ReporterHttpContext { request: IncomingMessage; response: ServerResponse; url: URL }
export type ReporterHttpHandler = (input: ReporterHttpContext) => Promise<boolean>;
interface ReporterHttpOptions { access: ReporterAccess; timeline: ReporterTimeline; enabled?: boolean; publicOrigin: string; allowLocalHttp?: boolean; accessPolicy?: string; memberHandler?: ReporterHttpHandler | null }

import { readFile } from 'node:fs/promises';
import { exactP2016,failP2016,guardP2016,textHashP2016 } from './p2-016-domain-contracts.mjs';
import {reporterAccessPolicy,failYxx} from './p2-g2-yixiaoxiu-contract.mjs';
const assets: Readonly<Record<string, readonly [string, string]>>=Object.freeze({
  '/reporter/':['index.html','text/html; charset=utf-8'],'/reporter/open':['index.html','text/html; charset=utf-8'],
  '/reporter/reporter.js':['reporter.js','text/javascript; charset=utf-8'],
  '/reporter/reporter.css':['reporter.css','text/css; charset=utf-8'],
});
const cookieName='p2016_reporter';
function cookie(request: IncomingMessage) {
  const values=(request.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
  if(values.length!==1)failP2016('REPORTER_UNAUTHENTICATED',401);return (values[0] as string).slice(cookieName.length+1);
}
function json(response: ServerResponse,status: number,body: unknown,extra: OutgoingHttpHeaders={}) {
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',...extra});
  response.end(status===304?undefined:JSON.stringify(body));
}
async function body(request: IncomingMessage): Promise<unknown> {
  if((request.headers['content-type']??'').split(';')[0]!=='application/json')failP2016('CONTENT_TYPE_INVALID',415);
  let size=0;const chunks: Buffer[]=[];for await(const c of request){size+=c.length;if(size>1024)failP2016('BODY_TOO_LARGE',413);chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{failP2016();}
}
export function createP2016ReporterHttp({access,timeline,enabled=false,publicOrigin,allowLocalHttp=false,accessPolicy='LEGACY_BOUND_GRANT',memberHandler=null}: ReporterHttpOptions): ReporterHttpHandler {
  if(reporterAccessPolicy(accessPolicy)==='MEMBER_REQUIRED'){
    if(enabled!==true||typeof memberHandler!=='function')failYxx('CONFIG_INVALID');return memberHandler as ReporterHttpHandler;
  }
  if(!enabled)return async({url}: ReporterHttpContext)=>{if(assets[url.pathname]||url.pathname.startsWith('/api/reporter/'))guardP2016(false);return false;};
  const parsed=new URL(publicOrigin),secure=parsed.protocol==='https:';
  if(parsed.origin!==publicOrigin||(!secure&&!(allowLocalHttp&&parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))))failP2016('ORIGIN_INVALID');
  const setCookie=(token: string,age: number)=>cookieName+'='+token+'; HttpOnly; SameSite=Strict; Path=/api/reporter; Max-Age='+age+(secure?'; Secure':'');
  return async({request,response,url}: ReporterHttpContext)=>{
    const asset=assets[url.pathname],api=url.pathname.startsWith('/api/reporter/');
    if(!asset&&!api)return false;
    guardP2016(enabled);
    if(asset){
      if(request.method!=='GET'||url.search)failP2016('NOT_FOUND',404);
      const content=await readFile(new URL('../web/p2-reporter/'+asset[0],import.meta.url));
      response.writeHead(200,{'content-type':asset[1],'cache-control':'no-store','referrer-policy':'no-referrer'});response.end(content);return true;
    }
    if([...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k)))failP2016('REPORTER_UNAUTHENTICATED',401);
    if(request.method==='POST'){
      if(request.headers.origin!==publicOrigin||request.headers['sec-fetch-site']==='cross-site')failP2016('ORIGIN_INVALID',403);
      if(url.pathname==='/api/reporter/access/exchange'){
        const value=exactP2016(await body(request),['grant']);
        const result=await access.exchange(value.grant);
        json(response,200,{public_ref:result.public_ref,identity_mode:'BOUND_ACCESS_SESSION'},
          {'set-cookie':setCookie(result.sessionToken,result.max_age_seconds)});return true;
      }
      if(url.pathname==='/api/reporter/logout'){
        exactP2016(await body(request),[]);
        await access.logout(cookie(request));json(response,200,{logged_out:true},{'set-cookie':setCookie('',0)});return true;
      }
    }
    if(request.method==='GET'&&url.pathname==='/api/reporter/bootstrap'){
      json(response,200,await timeline.bootstrap({sessionToken:cookie(request)}));return true;
    }
    const match=/^\/api\/reporter\/tickets\/([A-Za-z0-9_-]{32})(\/timeline)?$/u.exec(url.pathname);
    if(request.method==='GET'&&match){
      const input={sessionToken:cookie(request),publicRef:match[1]};
      const result=match[2]?await timeline.timeline({...input,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}):await timeline.detail(input);
      const etag='"'+textHashP2016(JSON.stringify(result))+'"';
      json(response,request.headers['if-none-match']===etag?304:200,result,{etag});return true;
    }
    failP2016('NOT_FOUND',404);
  };
}
