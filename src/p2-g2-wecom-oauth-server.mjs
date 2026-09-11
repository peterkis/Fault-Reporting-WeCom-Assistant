import { createServer } from 'node:http';
import { createWeComOAuthHttp } from './p2-g2-wecom-oauth-http.mjs';

// Authentication-only boot mode. Run instead of the full App until its separate live gates are ready.
export function createWeComOAuthServer({oauth,publicOrigin,memberHandler=null,profile='OAUTH_ONLY'}){
  if(!['OAUTH_ONLY','MEMBER_TICKET_READONLY'].includes(profile)
    ||(profile==='OAUTH_ONLY')!==(memberHandler===null)
    ||memberHandler!==null&&typeof memberHandler!=='function')throw new TypeError('WECOM_OAUTH_CONFIG_INVALID');
  const host=new URL(publicOrigin).host;
  const handler=createWeComOAuthHttp({oauth,publicOrigin});
  const counts={authenticated_callbacks:0,authenticated_pages:0};
  const server=createServer({maxHeaderSize:8192},async(request,response)=>{
    response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
    response.setHeader('x-content-type-options','nosniff');
    if(request.headers.host!==host){response.writeHead(421);response.end();return;}
    if(Buffer.byteLength(request.url??'')>2048){response.writeHead(414);response.end();return;}
    try{
      const url=new URL(request.url??'/',publicOrigin);
      if(request.method==='GET'&&url.pathname==='/health/live'&&!url.search){
        response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,mode:profile,...counts}));return;
      }
      response.once('finish',()=>{
        if(url.pathname==='/wecom/yixiaoxiu/callback'&&response.statusCode===303)counts.authenticated_callbacks++;
        if(url.pathname==='/wecom/yixiaoxiu/'&&response.statusCode===200)counts.authenticated_pages++;
      });
      if(memberHandler&&await memberHandler({request,response,url}))return;
      if(await handler({request,response,url}))return;
      response.writeHead(404);response.end();
    }catch{if(!response.headersSent){response.writeHead(503);response.end();}else response.destroy();}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=50;
  server.once('close',()=>oauth.close?.());
  return server;
}
