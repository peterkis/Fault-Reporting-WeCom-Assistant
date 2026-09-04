import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createConversationWorkbenchHttpServer,closeConversationWorkbenchServer } from '../../src/p2-006-workbench-http.mjs';
import { createP2016WorkbenchHttp } from '../../src/p2-016-workbench-http.mjs';
import { createP2016WorkbenchStatic } from '../../src/p2-016-workbench-static.mjs';
import { formatEpochMsToShanghaiLocal } from '../../src/platform/time-contract.mjs';
export async function createP2016BrowserFixture(){
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin='http://127.0.0.1:'+port,principalId=randomUUID(),ticketId=randomUUID(),reviewId=randomUUID(),journeyId=randomUUID();
  const now='2026-09-04 10:00:00',responses=new Set(),receipts=new Map(),calls=[];
  let version=1,state='QUEUED',reviewStatus='PENDING',expired=false,listCalls=0;
  const source=()=>({id:ticketId,ticket_no:'IT-20260904-0012',status:state,priority:'NORMAL',version,created_at:now,updated_at:now,
    assignee_id:version>1?principalId:null,allowed_actions:state==='QUEUED'?['accept','cancel','add-note']:['start','resolve','add-note','transfer-assignment']});
  const review=()=>({id:reviewId,journey_id:journeyId,status:reviewStatus,priority:'HIGH',review_reason_code:'CLINICAL_REVIEW_REQUIRED',row_version:'1',created_at:now,
    safe_result:{selected_service:'系统登录',known_fields:['服务'],unknown_fields:['症状'],provenance:'<img src=x onerror=window.p2016_xss=1>'},allowed_resolutions:['CONFIRM_TICKET_ELIGIBLE','REQUEST_DESCRIPTION','KEEP_INCIDENT_REVIEW_CANDIDATE']});
  const query={principal:async()=>({principal_id:principalId,display_name:'合成测试坐席',roles:['ADMIN']}),list:async()=>{listCalls++;return {items:[source()],next_cursor:null};},
    detail:async()=>source(),responsibility:async()=>({ticket_assignee_name:version>1?'合成故障处理人':null,resolver_team_name:'信息技术组',conversations:[{session_id:randomUUID(),session_row_version:'1',conversation_principal_id:principalId,conversation_principal_name:'合成沟通坐席'}]}),
    events:async()=>({items:[{event_type:'ticket.created',new_status:state,created_at:now,has_internal_note:calls.some(c=>c.action==='add-note')}],next_cursor:null}),
    eligiblePrincipals:async()=>({items:[{principal_id:principalId,display_name:'合成故障处理人'}]}),deliveries:async()=>({items:[]})};
  const tickets={perform:async({command})=>{if(receipts.has(command.client_command_id))return {...receipts.get(command.client_command_id),replayed:true};
    if(command.expected_version!==version)return {ok:false,error:{code:'P2_016_VERSION_CONFLICT',retryable:false}};
    calls.push(command);await new Promise(r=>setTimeout(r,100));version++;if(command.action==='accept')state='ACCEPTED';
    const result={ok:true,ticket_version:version};receipts.set(command.client_command_id,result);return result;}};
  const reviews={listManualReviews:async()=>({items:reviewStatus==='PENDING'?[review()]:[],next_cursor:null}),getManualReviewDetail:async()=>review(),
    journey:async({part})=>part?[{safe:'合成判定'}]:{origin_channel:'WECOM_GROUP',current_channel:'WECOM_GROUP',status:'WAITING_REVIEW'},
    resolveManualReview:async({body})=>{calls.push(body);reviewStatus='RESOLVED';return {ok:true};}};
  const server=createConversationWorkbenchHttpServer({enabled:true,publicOrigin:origin,queryService:{},commandFacade:{},
    authenticate:async()=>({principal_id:principalId,auth_method:'COOKIE',csrf_token:'synthetic-only-csrf',expires_epoch_ms:expired?'1':String(Date.now()+60000),expires_at:formatEpochMsToShanghaiLocal(String(Date.now()+60000))}),
    staticHandler:createP2016WorkbenchStatic({enabled:true,conversationEnabled:true}),authenticatedHandler:createP2016WorkbenchHttp({query,tickets,reviews,enabled:true}),
    sseHandler:async(request,response)=>{response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});response.write(': connected\n\n');responses.add(response);response.once('close',()=>responses.delete(response));},
  });
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  return {origin,ticketId,calls,get listCalls(){return listCalls;},expire:()=>{expired=true;},
    update:(next='IN_PROGRESS',publish=true)=>{version++;state=next;if(publish)for(const r of responses)r.write('id: 1\nevent: ticket.status.changed\ndata: {}\n\n');},
    disconnect:()=>{for(const r of responses)r.destroy();},
    close:async()=>{for(const r of responses)r.destroy();server.closeAllConnections?.();await closeConversationWorkbenchServer(server);}};
}
