import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {createConversationWorkbenchQueryService,WorkbenchAuthContext,WorkbenchListState} from './p2-006-workbench-query.mjs';
import type {createWeb01WorkbenchQuery} from './web01-workbench-query.mjs';
import type {createConversationWorkbenchCommandFacade} from './p2-006-workbench-command-facade.mjs';
import type {ConversationWorkspaceEntry,ConversationCanonicalItem} from '../contracts/workbench_conversation_workspace_contracts.js';
import type {ConversationCommandReceipt,ConversationWorkspaceDelivery} from '../contracts/workbench_conversation_workspace_contracts.js';
import {WORKBENCH_ERROR_CODES,WorkbenchError} from './p2-006-workbench-query.mjs';
import {assertLocalDateTime} from './platform/time-contract.mjs';
import {exactP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
type Query=ReturnType<typeof createConversationWorkbenchQueryService>;
type Summary=Pick<Awaited<ReturnType<Query['listConversations']>>['items'][number],'session'|'assignment'|'handoff'|'capabilities'>;
interface LabelRow {session_id:string;participant_label:string|null;topic:string|null;ticket_id:string|null;review_id:string|null;intake_id:string|null;chat_type:string;reply_binding:boolean}
function invalid(status=400):never{throw new WorkbenchError(status===404?WORKBENCH_ERROR_CODES.notFound:WORKBENCH_ERROR_CODES.requestInvalid,status);}
function keys(url:URL,allowed:readonly string[]){const names=[...url.searchParams.keys()];if(names.some(key=>!allowed.includes(key))||new Set(names).size!==names.length)invalid();}
export function createWorkbenchConversations({pool,query,itemQuery,commands,enabled=false,supplementFollowUpEnabled=false}:{pool:PostgresTransaction;query:Query;itemQuery:ReturnType<typeof createWeb01WorkbenchQuery>;commands:ReturnType<typeof createConversationWorkbenchCommandFacade>;enabled?:boolean;supplementFollowUpEnabled?:boolean}){
  async function enrich(authContext:WorkbenchAuthContext,items:readonly Summary[]):Promise<ConversationWorkspaceEntry[]>{
    if(!items.length)return [];
    const labels=await pool.query<LabelRow>(`SELECT s.id::text AS session_id,i.id::text AS intake_id,i.summary AS topic,th.chat_type,
      COALESCE(i.source_provider='WECOM_AIBOT' AND th.provider=i.source_provider AND th.channel_account_id=i.source_bot_id
        AND th.chat_type=i.source_chat_type AND s.participant_key=i.reporter_wecom_userid
        AND th.external_thread_key=CASE WHEN i.source_chat_type='single' THEN i.reporter_wecom_userid ELSE i.source_chat_id END,false) AS reply_binding,
      CASE WHEN j.profile_resolution_status='RESOLVED' AND j.retention_until_epoch_ms>platform.physical_epoch_ms() THEN left(j.profile_snapshot->'contact'->>'name',128) END AS participant_label,
      COALESCE(t.id,j.linked_ticket_id)::text AS ticket_id,r.id::text AS review_id
      FROM conversation.session s JOIN conversation.thread th ON th.id=s.thread_id LEFT JOIN intake.service_intake i ON i.id=s.service_intake_id AND i.retention_until>platform.local_now()
      LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id
      LEFT JOIN LATERAL(SELECT journey.* FROM intake.channel_leg leg JOIN intake.contact_journey journey ON journey.id=leg.journey_id
        WHERE leg.source_intake_id=i.id AND (leg.conversation_session_id=s.id OR leg.conversation_session_id IS NULL)
          AND (leg.conversation_thread_id=s.thread_id OR leg.conversation_thread_id IS NULL)
          AND leg.reporter_identity_hash=journey.reporter_identity_hash AND i.reporter_wecom_userid=s.participant_key
          AND journey.retention_until_epoch_ms>platform.physical_epoch_ms()
        ORDER BY leg.leg_ordinal,journey.id LIMIT 1) j ON TRUE
      LEFT JOIN LATERAL(SELECT review.id FROM intake.manual_review_item review WHERE review.service_intake_id=i.id AND review.status='PENDING' ORDER BY review.created_at,review.id LIMIT 1) r ON TRUE
      WHERE s.id=ANY($1::uuid[])`,[items.map(item=>item.session.session_id)]);
    const result:ConversationWorkspaceEntry[]=[];
    for(const entry of items){
      const label=labels.rows.find(row=>row.session_id===entry.session.session_id);let canonical:ConversationCanonicalItem|null=null;
      for(const [kind,id]of [['ticket',label?.ticket_id],['review',label?.review_id],['intake',label?.intake_id]] as const){
        if(!id)continue;
        try{const item=await itemQuery.authorizedItem(authContext,kind,id);canonical={kind:item.kind,id:item.id,number:item.number,title:item.title};break;}
        catch(error){if(!error||typeof error!=='object'||!('status' in error)||error.status!==404)throw error;}
      }
      result.push({session:entry.session,participant_label:label?.participant_label?.trim()||'报修人（资料未提供）',topic:canonical?.title??label?.topic?.slice(0,512)??'服务主题资料不可用',channel_label:label?.chat_type==='group'?'群来源 · 回复通过私聊':'Bot 私聊',canonical_item:canonical,
        assignment:{status:entry.assignment.status,assigned_to_me:entry.assignment.assigned_to_me,assigned_display_name:entry.assignment.assigned_display_name},
        handoff:entry.handoff?{handoff_id:entry.handoff.handoff_id,status:entry.handoff.status??'',row_version:entry.handoff.row_version}:null,
        capabilities:entry.session.status==='ENDED'?[]:[...new Set([...entry.capabilities,...(entry.assignment.status==='ASSIGNED'&&entry.assignment.assigned_to_me?['TRANSFER']:[])])].filter(action=>{
          if(['READ_CURSOR','RECONCILE','DELIVERY_RETRY'].includes(action))return false;
          if(action==='TAKEOVER')return entry.assignment.status!=='ASSIGNED';
          if(['TRANSFER','FORCE_TRANSFER','RELEASE'].includes(action))return entry.assignment.status==='ASSIGNED';
          if(action==='REPLY')return label?.reply_binding===true;
          if(action==='REQUEST_HANDOFF')return !['REQUESTED','ACCEPTED'].includes(entry.handoff?.status??'');
          if(action==='CANCEL_HANDOFF')return entry.handoff?.status==='REQUESTED';return true;
        })});
    }
    return result;
  }
  async function detail(authContext:WorkbenchAuthContext,sessionId:string){
    const value=await query.getConversationDetail({authContext,sessionId});
    const [entry]=await enrich(authContext,[value]);if(!entry)invalid(404);return entry;
  }
  async function itemLinks(authContext:WorkbenchAuthContext,kind:string,id:string){
    const item=await itemQuery.authorizedItem(authContext,kind,id);
    const rows=await pool.query<{session_id:string}>(`SELECT s.id::text AS session_id FROM conversation.session s
      WHERE s.service_intake_id=$1::uuid OR ($2='ticket' AND EXISTS(
        SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
        JOIN intake.service_intake i ON i.id=l.source_intake_id
        WHERE j.linked_ticket_id=$3::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
          AND i.retention_until>platform.local_now() AND i.reporter_wecom_userid=s.participant_key
          AND (l.conversation_session_id=s.id OR l.source_intake_id=s.service_intake_id)
          AND (l.conversation_thread_id=s.thread_id OR l.conversation_thread_id IS NULL)))
      ORDER BY s.last_activity_at DESC,s.id DESC LIMIT 100`,[item.intake_id,kind,item.id]);
    const items:ConversationWorkspaceEntry[]=[];
    for(const row of rows.rows){try{items.push(await detail(authContext,row.session_id));}catch(error){if(!(error instanceof WorkbenchError)||error.status!==404)throw error;}}
    return {items};
  }
  async function receipt(authContext:WorkbenchAuthContext,sessionId:string,commandId:string,purpose:string):Promise<ConversationCommandReceipt>{
    await query.getConversationDetail({authContext,sessionId});const principal=(await query.getBootstrap({authContext})).principal;
    const base={session_id:sessionId,client_command_id:commandId};
    const row=(await pool.query<{message_id:string;outbox_id:string|null;delivery_ids:string[];created_at:unknown}>(`SELECT m.id::text AS message_id,o.id::text AS outbox_id,
      ARRAY(SELECT d.id::text FROM communication.delivery d WHERE d.outbox_id=o.id ORDER BY d.id) AS delivery_ids,m.created_at
      FROM communication.message m LEFT JOIN communication.outbox o ON o.message_id=m.id
      WHERE m.session_id=$1::uuid AND m.client_command_id=$2::uuid AND m.sender_principal_id=$3::uuid
        AND m.idempotency_scope='AGENT' AND m.purpose=$4 AND m.sender_kind='AGENT'`,[sessionId,commandId,principal.principal_id,purpose==='messages'?'HUMAN_REPLY':'INTERNAL_NOTE'])).rows[0];
    return row?{...base,state:'COMMITTED',result:{message_id:row.message_id,outbox_id:row.outbox_id,delivery_ids:row.delivery_ids,created_at:assertLocalDateTime(row.created_at),command_status:'REPLAYED',replayed:true}}:{...base,state:'UNKNOWN'};
  }
  async function deliveries(authContext:WorkbenchAuthContext,sessionId:string):Promise<{items:ConversationWorkspaceDelivery[]}>{
    await query.getConversationDetail({authContext,sessionId});
    const rows=await pool.query<Omit<ConversationWorkspaceDelivery,'sent_at'|'created_at'>&{sent_at:unknown;created_at:unknown}>(`SELECT m.id::text AS message_id,m.purpose,d.id::text AS delivery_id,d.status,d.side_effect_state,d.provider AS channel,d.attempt_count,d.last_error_code,d.sent_at,m.created_at
      FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
      WHERE m.session_id=$1::uuid ORDER BY d.updated_at DESC,d.id DESC LIMIT 100`,[sessionId]);
    return {items:rows.rows.map(row=>({...row,sent_at:row.sent_at===null?null:assertLocalDateTime(row.sent_at),created_at:assertLocalDateTime(row.created_at)}))};
  }
  return {async handler({request,response,url,authContext,json,readJson,validateWriteRequest}:Context){
    const command=/^\/api\/workbench\/conversations\/([a-f0-9-]{36})\/(messages|internal-notes)\/commands\/([a-f0-9-]{36})$/iu.exec(url.pathname);
    const delivery=/^\/api\/workbench\/conversations\/([a-f0-9-]{36})\/deliveries$/iu.exec(url.pathname);
    const session=/^\/api\/workbench\/conversations\/([a-f0-9-]{36})(?:\/(items|eligible-principals|takeover|transfer|release|handoff\/request|handoff\/cancel|messages|internal-notes))?$/iu.exec(url.pathname);
    const links=/^\/api\/workbench\/items\/(ticket|review|intake)\/([a-f0-9-]{36})\/conversations$/iu.exec(url.pathname);
    if(url.pathname!=='/api/workbench/conversations'&&!command&&!delivery&&!session&&!links)return false;
    if(!enabled)throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled,503);
    if(request.method==='POST'&&session?.[2]){
      keys(url,[]);const action=session[2].toLowerCase(),body=await readJson(request);
      const common=['client_command_id','expected_row_version','reason_code'];
      if(action==='messages'){exactP2016(body,['client_command_id','expected_row_version','text','follow_up_target'],['client_command_id','expected_row_version','text']);if(body.follow_up_target!==undefined&&!supplementFollowUpEnabled)invalid(404);}
      else if(action==='internal-notes')exactP2016(body,['client_command_id','expected_row_version','text'],['client_command_id','expected_row_version','text']);
      else if(action==='transfer')exactP2016(body,[...common,'target_principal_id','force'],['client_command_id','expected_row_version','target_principal_id']);
      else if(action==='takeover'||action==='handoff/cancel')exactP2016(body,[...common,'handoff_id'],['client_command_id','expected_row_version']);
      else if(action==='release'||action==='handoff/request')exactP2016(body,common,['client_command_id','expected_row_version']);else invalid(404);
      validateWriteRequest(request,authContext,body,{sessionMutation:true});
      const input={authContext,sessionId:uuidP2016(session[1]),body};
      const result=action==='messages'?await commands.reply(input):action==='internal-notes'?await commands.internalNote(input):action==='handoff/request'?await commands.requestHandoff(input):action==='handoff/cancel'?await commands.cancelHandoff(input):action==='takeover'?await commands.takeover(input):action==='transfer'?await commands.transfer(input):await commands.release(input);
      json(response,action==='messages'?202:action==='internal-notes'?201:200,result);return true;
    }
    if(request.method!=='GET')invalid(404);
    if(command){keys(url,[]);json(response,200,await receipt(authContext,uuidP2016(command[1]),uuidP2016(command[3]),command[2]?.toLowerCase()??''));return true;}
    if(delivery){keys(url,[]);json(response,200,await deliveries(authContext,delivery[1]??''));return true;}
    if(links){keys(url,[]);json(response,200,await itemLinks(authContext,links[1]?.toLowerCase()??'',uuidP2016(links[2])));return true;}
    if(session){const sessionId=uuidP2016(session[1]),part=session[2]?.toLowerCase();
      if(!part){keys(url,[]);const result=await detail(authContext,sessionId);json(response,200,result,{etag:'"'+result.session.row_version+'"'});return true;}
      if(part==='eligible-principals'){keys(url,[]);json(response,200,await query.listEligiblePrincipals({authContext,sessionId}));return true;}
      if(part==='items'){keys(url,['before_sequence','after_sequence','limit']);const before=url.searchParams.get('before_sequence'),after=url.searchParams.get('after_sequence');const page=await query.listConversationItems({authContext,sessionId,...(before===null?{}:{before_sequence:before}),...(after===null?{}:{after_sequence:after}),limit:url.searchParams.get('limit')});
        json(response,200,{...page,items:page.items.map(({safe_content:_safe,...item})=>item)});return true;}
      invalid(404);
    }
    keys(url,['state','cursor','limit']);
    const page=await query.listConversations({authContext,state:url.searchParams.get('state') as WorkbenchListState|null??'open',cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')});
    json(response,200,{items:await enrich(authContext,page.items),next_cursor:page.next_cursor});return true;
  }};
}
