import {pathToFileURL} from 'node:url';
import {runApp,runWorker} from './p2-g1-process-role.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createWeComAppTokenProvider} from '../src/p2-g2-wecom-app-token.mjs';
import {createWeComOAuthCodeResolver} from '../src/p2-g2-wecom-oauth-provider.mjs';
import {createLimitedGuard} from '../src/yxx-limited-write-guard.mjs';
import {validateLimitedManifest,reject} from '../src/yxx-limited-write-contract.mjs';

export async function main(argv=process.argv.slice(2)){
  if(!process.send||argv.length!==1||!['--role=app','--role=worker'].includes(argv[0]))reject('ROLE_INVALID');
  let stopped=false,operational=false;
  process.once('disconnect',()=>{stopped=true;process.exit(1);});
  process.on('message',m=>{if(m?.type==='stop')stopped=true;if(m?.type==='ss010-activate')operational=true;});
  const manifest=validateLimitedManifest(JSON.parse(process.env.SS010_MANIFEST));
  const member=JSON.parse(process.env.SS010_MEMBER),synthetic=process.env.SS010_SYNTHETIC==='true';
  const guard=createLimitedGuard({manifest,member,secret:process.env.P2_G2_REPORTER_HMAC_SECRET,stopFile:process.env.SS010_STOP_FILE,isStopped:()=>stopped});
  const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
  if(argv[0]==='--role=worker')return runWorker({reportCycleHealth:true,extensionFactory:({pool})=>{
    const orchestrator=createYxxSelfServiceOrchestrator({pool:guard.protectPool(pool),profile:'FULL_SERVICE_LOOP',featureFlags:flags});
    return {runOnce:async()=>{guard.active();if(!operational)return;return orchestrator.processPendingFromWorker({batchSize:10});}};
  }});
  const guardedFetch=(url,options)=>{guard.active();const target=new URL(url);if(target.origin!=='https://qyapi.weixin.qq.com'
    ||!['/cgi-bin/gettoken','/cgi-bin/auth/getuserinfo','/cgi-bin/batch/userid_to_openuserid'].includes(target.pathname))reject('PROVIDER_FORBIDDEN');return fetch(url,{...options,redirect:'error'});};
  const provider=synthetic?async()=> 'synthetic':createWeComAppTokenProvider({corpId:member.corpId,appSecret:process.env.APP_SECRET,fetchImpl:guardedFetch});
  const identityMapping=await createYxxDelegatedIdentityMapping({config:member,accessTokenProvider:provider,
    fetchImpl:synthetic?async()=>new Response(JSON.stringify({errcode:0,open_userid_list:member.reporterUserIds.map((id,i)=>({userid:id,open_userid:'open-'+i}))})):guardedFetch});
  const resolveCode=synthetic?async code=>({userid:code==='a'?'open-0':'open-1'}):createWeComOAuthCodeResolver({accessTokenProvider:provider,fetchImpl:guardedFetch});
  return runApp({runtimeFactory:options=>{
    const pool=guard.protectPool(options.pool);
    const limitedRequestGuard=async({request,response,url})=>{
      try{
        guard.active();
        if(!operational)reject('STARTING');
        const memberRoute=url.pathname.startsWith('/wecom/yixiaoxiu/')||url.pathname.startsWith('/api/yixiaoxiu/');
        if(!memberRoute&&request.headers.host!==new URL(options.publicOrigin).host)reject('INTERNAL_ORIGIN_REQUIRED');
        if(['GET','HEAD'].includes(request.method))return false;
        if(request.method!=='POST')reject('ROUTE_FORBIDDEN');
        if(url.pathname==='/wecom/yixiaoxiu/logout'||url.pathname==='/api/yixiaoxiu/requests'
          ||/^\/api\/yixiaoxiu\/requests\/[A-Za-z0-9_-]{32}\/supplements$/u.test(url.pathname))return false;
        const ticket=/^\/api\/tickets\/([a-f0-9-]{36})\/(queue|accept|start|request-information|wait-vendor|resume|resolve|confirm|reopen|cancel|notes)$/iu.exec(url.pathname);
        const review=/^\/api\/manual-reviews\/([a-f0-9-]{36})\/resolve$/iu.exec(url.pathname);
        if(!ticket&&!review)reject('ROUTE_FORBIDDEN');
        const found=ticket?await pool.query('SELECT 1 FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE i.pilot_ticket_id=$1::uuid',[ticket[1]])
          :await pool.query('SELECT 1 FROM intake.manual_review_item r JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id WHERE r.id=$1::uuid',[review[1]]);
        if(found.rowCount!==1)reject('OBJECT_FORBIDDEN');return false;
      }catch{response.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:{code:'YXX_ENTRY_FORBIDDEN',retryable:false}}));return true;}
    };
    return createP2016Runtime({...options,pool,reporterOrigin:manifest.public_origin,
      reporterHmacSecret:process.env.P2_G2_REPORTER_HMAC_SECRET,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:member,identityMapping,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:false},
      wecomWebOAuth:{enabled:true,corpId:member.corpId,agentId:member.agentId,resolveCode},
      yxxSelfService:{featureFlags:flags,quota:guard.quota},limitedRequestGuard});
  }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.send?.({type:'role-failed',error_code:'SS010_ROLE_FAILED'});process.exit(1);});
