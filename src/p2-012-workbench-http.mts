import type { G1RuntimeExtension } from './p2-g1-runtime.mjs';
type G1AuthenticatedExtension = NonNullable<G1RuntimeExtension['authenticatedHandler']>;
import type { IncidentCommand } from './p2-012-domain-contracts.mjs';
import type { P2012IncidentQuery } from './p2-012-incident-query.mjs';
import type { P2012IncidentCommandService } from './p2-012-incident-command-service.mjs';
import { guard,fail,p2012HttpStatusForCommandResult } from './p2-012-domain-contracts.mjs';
const ROUTES=Object.freeze({'start-review':'START_REVIEW',reject:'REJECT_CANDIDATE',confirm:'CONFIRM_INCIDENT',
  'start-investigating':'START_INVESTIGATING','correct-scope':'CORRECT_SCOPE','primary-ticket':'SET_PRIMARY_TICKET',
  'reports/link':'LINK_REPORT',resolve:'RESOLVE_INCIDENT',close:'CLOSE_INCIDENT'});
export function createP2012WorkbenchHttp({query,commands,enabled=false}: { query: P2012IncidentQuery; commands: Pick<P2012IncidentCommandService, 'perform'>; enabled?: boolean }){
  return (async({request,response,url,authContext,readJson,validateWriteRequest,json}: Parameters<G1AuthenticatedExtension>[0])=>{
    if(!/^\/api\/(incident-candidates|incidents)(?:\/|$)/u.test(url.pathname))return false;guard(enabled);
    const candidate=url.pathname.startsWith('/api/incident-candidates'),root=candidate?'/api/incident-candidates':'/api/incidents',kind=candidate?'candidate':'incident';
    const suffix=url.pathname.slice(root.length),match=/^\/([a-f0-9-]{36})(?:\/(.*))?$/iu.exec(suffix);
    if(request.method==='GET'){
      if([...url.searchParams.keys()].some(k=>!['state','cursor','limit'].includes(k)))fail();
      let result: { row_version?: unknown } & Record<string, unknown>;
      if(!suffix)result=await query.list({authContext,kind,state:url.searchParams.get('state'),after:url.searchParams.get('cursor'),pageLimit:url.searchParams.get('limit')});
      else if(match&&!match[2])result=await query.detail({authContext,id:(match[1] as string),kind});
      else if(match&&!candidate)result=await query.children({authContext,id:(match[1] as string),part:(match[2] as string),after:url.searchParams.get('cursor'),pageLimit:url.searchParams.get('limit')});
      else fail('NOT_FOUND',404);
      json(response,200,result,result.row_version?{etag:'"'+result.row_version+'"'}:{});return true;
    }
    if(request.method==='POST'&&match&&!url.search){
      const body=await readJson(request) as Record<string, unknown>;validateWriteRequest(request,authContext,body,{sessionMutation:false});
      const version=body.expected_candidate_version??body.expected_row_version;
      if(request.headers['if-match']!=='"'+version+'"')fail('VERSION_CONFLICT',409);
      let action=(ROUTES as Record<string, string>)[(match[2] as string)],extra: Record<string, string | undefined>={};
      const report=/^reports\/([a-f0-9-]{36})\/(unlink|mark-recovered)$/iu.exec(match[2]??'');
      const sub=/^subscriptions\/([a-f0-9-]{36})\/(pause|resume)$/iu.exec(match[2]??'');
      if(report){action=report[2]==='unlink'?'UNLINK_REPORT':'MARK_REPORTER_RECOVERED';extra.incident_report_id=report[1];}
      if(sub){action=sub[2]==='pause'?'PAUSE_SUBSCRIPTION':'RESUME_SUBSCRIPTION';extra.subscription_id=sub[1];}
      if(!action||candidate!==['START_REVIEW','REJECT_CANDIDATE','CONFIRM_INCIDENT'].includes(action))fail('NOT_FOUND',404);
      if(['action','incident_id','candidate_review_id','incident_report_id','subscription_id'].some(k=>Object.hasOwn(body,k)))fail();
      const result=await commands.perform({authContext,command:{...body,...extra,action,[candidate?'candidate_review_id':'incident_id']:match[1]} as IncidentCommand});
      json(response,p2012HttpStatusForCommandResult(result),result);return true;
    }
    fail('NOT_FOUND',404);
  }) satisfies G1AuthenticatedExtension;
}
