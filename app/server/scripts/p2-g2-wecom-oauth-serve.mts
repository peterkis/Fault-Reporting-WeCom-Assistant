import { createWeComAppTokenProvider } from '../src/p2-g2-wecom-app-token.mjs';
import { createWeComOAuthCodeResolver } from '../src/p2-g2-wecom-oauth-provider.mjs';
import { createWeComWebOAuth } from '../src/p2-g2-wecom-web-oauth.mjs';
import { createWeComOAuthServer } from '../src/p2-g2-wecom-oauth-server.mjs';

try{
  const publicOrigin=process.env.WECOM_WEB_OAUTH_ORIGIN;
  const enabled=process.env.WECOM_WEB_OAUTH_ENABLED==='true';
  const port=Number(process.env.WECOM_WEB_OAUTH_PORT??43123);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('configuration');
  const oauth=createWeComWebOAuth({enabled,publicOrigin,corpId:process.env.CORP_ID,agentId:process.env.APP_ID,
    ...(enabled?{resolveCode:createWeComOAuthCodeResolver({accessTokenProvider:createWeComAppTokenProvider({corpId:process.env.CORP_ID,appSecret:process.env.APP_SECRET})})}:{})});
  const server=createWeComOAuthServer({oauth,publicOrigin});
  server.on('error',()=>{console.error('WECOM_OAUTH_SERVER_FAILED');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'WECOM_OAUTH_LISTENING',enabled,mode:'OAUTH_ONLY'})));
  const stop=()=>{(oauth as {close?:()=>void}).close?.();server.close();server.closeIdleConnections();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{console.error('WECOM_OAUTH_CONFIG_INVALID');process.exitCode=1;}
