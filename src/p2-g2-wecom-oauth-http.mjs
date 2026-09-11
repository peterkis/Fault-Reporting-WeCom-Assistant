import { WeComOAuthError } from './p2-g2-wecom-web-oauth.mjs';

const root='/wecom/yixiaoxiu/';
const browserName='__Host-wecom_oauth',sessionName='__Host-wecom_session';
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function readCookie(request,name){
  const values=(request.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));
  return values.length===1?values[0].slice(name.length+1):null;
}
function page(response,status,text,extra={}){
  response.writeHead(status,{'content-type':'text/html; charset=utf-8',...extra});
  response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>医小修 · 企业微信认证</title><body><main><h1>医小修</h1><p>'+text+'</p><a href="'+root+'login">重新认证</a></main></body></html>');
}
export function createWeComOAuthHttp({oauth,publicOrigin}={}){
  return async({request,response,url})=>{
    if(!url.pathname.startsWith(root))return false;
    response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
    response.setHeader('x-content-type-options','nosniff');
    response.setHeader('content-security-policy',"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(!oauth?.enabled){page(response,503,'网页认证尚未启用。');return true;}
    try{
      if(url.origin!==publicOrigin)throw new WeComOAuthError('WECOM_AUTH_REQUIRED');
      if(request.method==='GET'&&url.pathname===root+'login'&&!url.search){
        const start=oauth.begin();response.writeHead(302,{location:start.location,'set-cookie':cookie(browserName,start.browserToken,300)});response.end();return true;
      }
      if(request.method==='GET'&&url.pathname===root+'callback'){
        if([...url.searchParams.keys()].some(key=>!['code','state'].includes(key))||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1)
          throw new WeComOAuthError('WECOM_AUTH_REQUIRED');
        const result=await oauth.complete({code:url.searchParams.get('code'),state:url.searchParams.get('state'),browserToken:readCookie(request,browserName)});
        oauth.logout(readCookie(request,sessionName));
        response.writeHead(303,{location:root,'set-cookie':[cookie(browserName,'',0),cookie(sessionName,result.sessionToken,result.maxAgeSeconds)]});response.end();return true;
      }
      if(request.method==='GET'&&url.pathname===root&&!url.search){
        oauth.authenticate(readCookie(request,sessionName));page(response,200,'企业微信成员认证成功。');return true;
      }
      if(request.method==='POST'&&url.pathname===root+'logout'&&!url.search){
        if(request.headers.origin!==publicOrigin||request.headers['sec-fetch-site']==='cross-site')throw new WeComOAuthError('WECOM_AUTH_REQUIRED',403);
        oauth.logout(readCookie(request,sessionName));page(response,200,'已退出认证。',{'set-cookie':cookie(sessionName,'',0)});return true;
      }
      page(response,404,'未找到此页面。');return true;
    }catch(error){
      const status=error instanceof WeComOAuthError?error.status:502;
      page(response,status,status===403?'当前账号不支持此应用认证。':status>=500?'认证服务暂时不可用，请稍后重试。':'认证已失效，请重新认证。');return true;
    }
  };
}
