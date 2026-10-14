import type { G1RuntimeExtension } from './p2-g1-runtime.mjs';
type G1AuthenticatedExtension = NonNullable<G1RuntimeExtension['authenticatedHandler']>;
import type { IncidentCommand } from './p2-012-domain-contracts.mjs';
import type { P2012IncidentQuery } from './p2-012-incident-query.mjs';
import type {createIncidentDeliveryControl} from './p2-012-incident-delivery-control.mjs';
import {INCIDENT_DELIVERY_AUTHORITY_HEADERS} from './workbench-incident-delivery-authority.mjs';
import type { P2012IncidentCommandService } from './p2-012-incident-command-service.mjs';
import { guard,fail,p2012HttpStatusForCommandResult } from './p2-012-domain-contracts.mjs';
const ROUTES=Object.freeze({'start-review':'START_REVIEW',reject:'REJECT_CANDIDATE',confirm:'CONFIRM_INCIDENT',
  'start-investigating':'START_INVESTIGATING','correct-scope':'CORRECT_SCOPE','primary-ticket':'SET_PRIMARY_TICKET',
  'reports/link':'LINK_REPORT',resolve:'RESOLVE_INCIDENT',close:'CLOSE_INCIDENT'});
export function createP2012WorkbenchHttp({query,commands,deliveryControl,enabled=false,candidateWorkspaceEnabled=false,internalNotesEnabled=false,publicProgressEnabled=false,ownerTransferEnabled=false}: { query: P2012IncidentQuery; deliveryControl?:ReturnType<typeof createIncidentDeliveryControl>; commands: Pick<P2012IncidentCommandService, 'perform'>; enabled?: boolean;candidateWorkspaceEnabled?:boolean;internalNotesEnabled?:boolean;publicProgressEnabled?:boolean;ownerTransferEnabled?:boolean }){
  return (async({request,response,url,authContext,readJson,validateWriteRequest,json}: Parameters<G1AuthenticatedExtension>[0])=>{
    if(!/^\/api\/(incident-candidates|incidents)(?:\/|$)/u.test(url.pathname))return false;guard(enabled);
    const candidate=url.pathname.startsWith('/api/incident-candidates'),root=candidate?'/api/incident-candidates':'/api/incidents',kind=candidate?'candidate':'incident';
    const suffix=url.pathname.slice(root.length),match=/^\/([a-f0-9-]{36})(?:\/(.*))?$/iu.exec(suffix);
    const ownerTransfer=!candidate&&['owner-transfer-targets','transfer-owner'].includes(match?.[2]??'');
    if(ownerTransfer&&!ownerTransferEnabled)fail('NOT_FOUND',404);
    const internal=!candidate&&match?.[2]==='internal-notes';
    const publication=!candidate&&(match?.[2]==='publish-update'||match?.[2]?.startsWith('public-progress'));
    if(publication&&!publicProgressEnabled)fail('NOT_FOUND',404);
    if(internal&&!internalNotesEnabled)fail('NOT_FOUND',404);
    const controlRoute=!candidate&&match?/^notifications\/([a-f0-9-]{36})\/(control|retry|reconcile)$/iu.exec(match[2]??''):null;
    const controlReceipt=!candidate&&match?/^notification-commands\/([a-f0-9-]{36})$/iu.exec(match[2]??''):null;
    if(controlRoute||controlReceipt){
      if(!match||!deliveryControl)fail('NOT_FOUND',404);if(url.search)fail();
      const incidentId=match[1] as string;
      if(request.method==='GET'&&controlReceipt){json(response,200,await deliveryControl.receipt({authContext,incidentId,commandId:controlReceipt[1] as string}));return true;}
      if(request.method==='GET'&&controlRoute?.[2]==='control'){const current=await deliveryControl.capabilityWithAuthority({authContext,incidentId,deliveryId:controlRoute[1] as string});json(response,200,current.capability,{[INCIDENT_DELIVERY_AUTHORITY_HEADERS.retry]:current.authority.retry_authorized?'1':'0',[INCIDENT_DELIVERY_AUTHORITY_HEADERS.reconcile]:current.authority.reconcile_authorized?'1':'0'});return true;}
      if(request.method==='POST'&&controlRoute&&(controlRoute[2]==='retry'||controlRoute[2]==='reconcile')){
        const body=await readJson(request) as Record<string,unknown>;validateWriteRequest(request,authContext,body,{sessionMutation:false});
        if(request.headers['if-match']!=='"'+body.expected_row_version+'"')fail('VERSION_CONFLICT',409);
        json(response,200,await deliveryControl.perform({authContext,incidentId,deliveryId:controlRoute[1] as string,action:controlRoute[2],body}));return true;
      }
      fail('NOT_FOUND',404);
    }
    if(request.method==='GET'){
      if(ownerTransfer&&match){
        if(match[2]!=='owner-transfer-targets')fail('NOT_FOUND',404);
        if([...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))fail();
        json(response,200,await query.ownerTransferTargets({authContext,id:match[1] as string,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;
      }
      if(publication&&match){
        if([...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))fail();
        const routes=/^public-progress\/([a-f0-9-]{36})\/deliveries$/iu.exec(match[2]??'');
        const input={authContext,incidentId:match[1] as string,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')};
        if(match[2]==='public-progress')json(response,200,await query.publicProgress(input));
        else if(routes)json(response,200,await query.publicProgressDeliveries({...input,publicationId:routes[1] as string}));else fail('NOT_FOUND',404);return true;
      }
      if(internal&&match){
        if([...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))fail();
        json(response,200,await query.internalNotes({authContext,incidentId:match[1] as string,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;
      }
      const receipt=match?/^commands\/([a-f0-9-]{36})$/iu.exec(match[2]??''):null;
      if(receipt&&match){
        if(!candidateWorkspaceEnabled)fail('NOT_FOUND',404);
        if(url.search)fail();
        const input={authContext,id:match[1] as string,commandId:receipt[1] as string};
        json(response,200,candidate?await query.candidateCommandReceipt(input):await query.incidentCommandReceipt(input));return true;
      }
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
      if(match[2]==='transfer-owner')action='TRANSFER_OWNER';
      if(internal)action='ADD_INTERNAL_NOTE';if(match[2]==='publish-update')action='PUBLISH_PUBLIC_PROGRESS';
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
