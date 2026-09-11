import {once} from 'node:events';
import {createWeComOAuthServer} from './p2-g2-wecom-oauth-server.mjs';
import {createYxxReadonlyServer} from './p2-g2-yixiaoxiu-server.mjs';
import {createP2012Runtime} from './p2-012-workbench-assembly.mjs';
import {failYxx} from './p2-g2-yixiaoxiu-contract.mjs';

// The caller owns credentials and any supplied pool. Profile selection never opens another role.
export function createYxxProfile({profile='OAUTH_ONLY',listenPort=0,...options}){
  if(!['OAUTH_ONLY','MEMBER_TICKET_READONLY','FULL_SERVICE_LOOP'].includes(profile)
    ||!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)failYxx('CONFIG_INVALID');
  if(profile==='FULL_SERVICE_LOOP'){
    if(options.reporterPolicy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
    return createP2012Runtime({...options,listenPort});
  }
  const server=profile==='OAUTH_ONLY'?createWeComOAuthServer({oauth:options.oauth,publicOrigin:options.publicOrigin}):createYxxReadonlyServer(options);
  let started=false,stopping;
  return Object.freeze({server,
    async start(){if(started||stopping)failYxx('UNAVAILABLE');started=true;server.listen(listenPort,'127.0.0.1');await once(server,'listening');return {profile,port:server.address().port};},
    stop(){return stopping??=(async()=>{options.oauth.close?.();if(!server.listening)return;
      await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});})();},
  });
}
