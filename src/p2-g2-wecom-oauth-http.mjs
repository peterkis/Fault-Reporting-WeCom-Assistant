import { WeComOAuthError } from './p2-g2-wecom-web-oauth.mjs';

const root='/wecom/yixiaoxiu/';
export const browserName='__Host-wecom_oauth',sessionName='__Host-wecom_session';
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export function readWeComCookie(request,name){
  const values=(request.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));
  return values.length===1?values[0].slice(name.length+1):null;
}
const intentName=state=>'__Host-wecom_intent_'+state;
export function joinWeComBrowserBindings(request,oauth){
  const names=new Set([browserName]);
  for(const part of (request.headers.cookie??'').split(';')){const name=part.trim().split('=')[0];if(/^__Host-wecom_intent_[a-f0-9]{64}$/u.test(name))names.add(name);}
  oauth.joinBrowserBindings?.([...names].map(name=>readWeComCookie(request,name)));
}
export function beginWeComOAuth({request,response,oauth,returnPath='/wecom/yixiaoxiu/'}){
  // The per-state cookie also covers two first navigations racing before the shared cookie exists.
  joinWeComBrowserBindings(request,oauth);
  const start=oauth.begin({browserToken:readWeComCookie(request,browserName),returnPath});
  const state=new URL(start.location).searchParams.get('state');
  response.writeHead(302,{location:start.location,'set-cookie':[
    cookie(browserName,start.browserToken,1200),cookie(intentName(state),start.browserToken,300),
  ]});response.end();
}
export function logoutWeComBrowser({request,oauth}){
  oauth.logout(readWeComCookie(request,sessionName));
  const names=new Set([browserName]);
  for(const part of (request.headers.cookie??'').split(';')){
    const name=part.trim().split('=')[0];
    if(/^__Host-wecom_intent_[a-f0-9]{64}$/u.test(name))names.add(name);
  }
  for(const name of names)oauth.logoutBrowser?.(readWeComCookie(request,name));
  return [cookie(sessionName,'',0),...Array.from(names,name=>cookie(name,'',0))];
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
        beginWeComOAuth({request,response,oauth});return true;
      }
      if(request.method==='GET'&&url.pathname===root+'callback'){
        if([...url.searchParams.keys()].some(key=>!['code','state'].includes(key))||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1)
          throw new WeComOAuthError('WECOM_AUTH_REQUIRED');
        joinWeComBrowserBindings(request,oauth);
        const state=url.searchParams.get('state');
        const binding=readWeComCookie(request,intentName(state))??readWeComCookie(request,browserName);
        const result=await oauth.complete({code:url.searchParams.get('code'),state,browserToken:binding});
        oauth.logout(readWeComCookie(request,sessionName));
        response.writeHead(303,{location:result.returnPath??root,'set-cookie':[
          cookie(intentName(state),'',0),cookie(browserName,binding,1200),cookie(sessionName,result.sessionToken,result.maxAgeSeconds),
        ]});response.end();return true;
      }
      if(request.method==='GET'&&url.pathname===root&&!url.search){
        oauth.authenticate(readWeComCookie(request,sessionName));page(response,200,'企业微信成员认证成功。请从机器人发给您的工单卡片进入。');return true;
      }
      if(request.method==='POST'&&url.pathname===root+'logout'&&!url.search){
        if(request.headers.origin!==publicOrigin||request.headers['sec-fetch-site']==='cross-site')throw new WeComOAuthError('WECOM_AUTH_REQUIRED',403);
        page(response,200,'已退出认证。',{'set-cookie':logoutWeComBrowser({request,oauth})});return true;
      }
      page(response,404,'未找到此页面。');return true;
    }catch(error){
      const status=error instanceof WeComOAuthError?error.status:502;
      page(response,status,status===403?'当前账号不支持此应用认证。':status>=500?'认证服务暂时不可用，请稍后重试。':'认证已失效，请重新认证。');return true;
    }
  };
}
