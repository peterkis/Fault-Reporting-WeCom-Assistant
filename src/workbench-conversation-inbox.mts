import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {WorkbenchAuthorizationAdapter,WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {WorkbenchAuthContext} from './p2-006-workbench-query.mjs';
import type {createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import type {ConversationWorkspaceDelivery} from '../contracts/workbench_conversation_workspace_contracts.js';
import type {ConversationInboxState,ConversationInboxSource,ConversationInboxPage,ConversationInboxEntry,ConversationChatEntry,ConversationRelatedPage,ConversationSourceBadge,ConversationChatItemPage,ConversationChatDeliveryPage} from '../contracts/workbench_conversation_inbox_contracts.js';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import {transactionP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {assertLocalDateTime} from './platform/time-contract.mjs';
import {GROUP_REF_SQL} from './workbench-source-groups.mjs';
import {SESSION_JOURNEY_JOIN_SQL,conversationReference} from './conversation-topic-scope.mjs';
import {RULE_ACTION_MESSAGE_JOIN_SQL} from './conversation-rule-admission.mjs';

interface Options {pool:PostgresPool;authorization:WorkbenchAuthorizationAdapter;enabled?:boolean;identityHmacKey?:string|undefined;currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate']|undefined}
interface Identity {provider:string;channel_account_id:string;participant_key:string}
interface SessionRow extends Identity {session_id:string;status:string;control_mode:string;generation_version:number;row_version:number;last_activity_at:string;journey_id:string|null;participant_label:string;department_label:string|null;topic:string;canonical_item:ConversationChatEntry['canonical_item'];source:ConversationSourceBadge;chat_type:'group'|'single';reply_binding:boolean;assignment_status:string;assigned_principal_id:string|null;assigned_display_name:string|null;handoff:ConversationChatEntry['handoff']}
interface InboxRow extends Identity {anchor_session_id:string;participant_label:string;department_label:string|null;latest_activity_at:string;matching_topic_count:number;unread_count:number;last_item:ConversationInboxEntry['last_item_preview'];sources:ConversationSourceBadge[];source_count:number;owner_count:number;mine_count:number;assigned_count:number;session_count:number;owner_name:string|null;has_delivery_exception:boolean}
interface Cursor {v:2;binding:string;criteria:string;scope:string;at:string;anchor:string}
type Params={sourceGroups:boolean;values:unknown[];add(value:unknown,cast?:string):string};
interface ReadQuery {prefix:string;sql:string;anchor?:string;cursor?:string;scope?:boolean;cursorScope?:string}
function invalid(code:string=WORKBENCH_ERROR_CODES.requestInvalid,status=400):never{throw new WorkbenchError(code,status);}
function integer(v:string|null,fallback:number,max:number):number{if(v===null)return fallback;if(!/^[1-9][0-9]*$/u.test(v)||!Number.isSafeInteger(Number(v))||Number(v)>max)invalid();return Number(v);}
function keys(url:URL,allowed:readonly string[]){const names=[...url.searchParams.keys()];if(names.some(k=>!allowed.includes(k))||new Set(names).size!==names.length)invalid();}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))invalid();return v as Record<string,unknown>;}
const states=new Set<ConversationInboxState>(['open','mine','unassigned','waiting_human','waiting_user','failed_delivery','ended']);
export function conversationInboxCriteria(url:URL){
  keys(url,['state','source','q','source_group_ref','cursor','limit']);
  const state=url.searchParams.get('state')??'open',source=url.searchParams.get('source')??'all',q=(url.searchParams.get('q')??'').trim(),group=url.searchParams.get('source_group_ref');
  if(!states.has(state as ConversationInboxState)||!['all','group','direct'].includes(source)||[...q].length>128||/[\u0000-\u001f\u007f]/u.test(q)||group!==null&&!/^[a-f0-9]{64}$/u.test(group))invalid();
  return {state:state as ConversationInboxState,source:source as ConversationInboxSource,q,group,limit:integer(url.searchParams.get('limit'),30,100)};
}
export function createConversationInbox({pool,authorization,enabled=false,identityHmacKey,currentSessionPredicate}:Options){
  const key=identityHmacKey??'';
  if(typeof enabled!=='boolean'||enabled&&key.length<16)throw new TypeError('CONVERSATION_INBOX_CONFIGURATION_INVALID');
  function guard(){if(!enabled)invalid(WORKBENCH_ERROR_CODES.disabled,503);}
  const digest=(value:unknown,purpose:string)=>createHmac('sha256',key).update(purpose+'\0'+JSON.stringify(value)).digest('hex');
  function binding(auth:WorkbenchAuthContext,p:WorkbenchPrincipal){const a=object(auth);return digest([p.principal_id,a.session_id??null,a.auth_method??null,a.expires_epoch_ms??null,a.csrf_token??null,p.roles,p.team_ids],'CURSOR_ACTOR_V1');}
  function encode(c:Cursor){const data=Buffer.from(JSON.stringify(c)).toString('base64url');return data+'.'+createHmac('sha256',key).update('CONVERSATION_CURSOR_V1\0'+data).digest('base64url');}
  function decode(value:string|null):Cursor|null{
    if(value===null)return null;if(value.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value))invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
    const [data,mac]=value.split('.');if(!data||!mac)invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
    const actual=Buffer.from(mac,'base64url'),expected=createHmac('sha256',key).update('CONVERSATION_CURSOR_V1\0'+data).digest();
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
    try{const c=object(JSON.parse(Buffer.from(data,'base64url').toString('utf8')) as unknown);
      if(Object.keys(c).sort().join(',')!=='anchor,at,binding,criteria,scope,v'||c.v!==2||typeof c.binding!=='string'||typeof c.criteria!=='string'||typeof c.scope!=='string'||!/^[a-f0-9]{64}$/u.test(c.scope))invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
      return {v:2,binding:c.binding,criteria:c.criteria,scope:c.scope,at:assertLocalDateTime(c.at),anchor:uuidP2016(c.anchor)};
    }catch{invalid(WORKBENCH_ERROR_CODES.cursorInvalid);}
  }
  async function read<T>(auth:WorkbenchAuthContext,body:(p:WorkbenchPrincipal,params:Params)=>ReadQuery):Promise<{rows:T[];principal:WorkbenchPrincipal;scope:string}>{
    guard();return transactionP2016(pool,async tx=>{
      await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
      const p=await authorization.resolvePrincipal(auth,{queryable:tx});if(!p)invalid(WORKBENCH_ERROR_CODES.forbidden,403);
      const sourceGroups=(await tx.query<{present:boolean}>("SELECT to_regclass('workbench.source_group_name') IS NOT NULL AS present")).rows[0]?.present===true;
      const params:Params={sourceGroups,values:[p.principal_id,p.roles.some(r=>['ADMIN','DISPATCHER'].includes(r)),p.roles,p.team_ids],add(value,cast=''){this.values.push(value);return '$'+this.values.length+cast;}};
      const expiry=object(auth).expires_epoch_ms;
      if(typeof expiry!=='string'||!/^[0-9]{1,16}$/u.test(expiry))invalid(WORKBENCH_ERROR_CODES.unauthenticated,401);
      let sessionSql=params.add(expiry,'::bigint')+'>platform.physical_epoch_ms()';
      // Keep the expiry bind in the query when adding the real Session fence.
      // Replacing it leaves an untyped parameter hole under PostgreSQL Parse.
      if(currentSessionPredicate){const s=currentSessionPredicate(auth,p.principal_id,params.values.length+1);params.values.push(...s.values);sessionSql='('+sessionSql+') AND ('+s.sql+')';}
      const spec=body(p,params);
      const scopeSql=spec.scope?"(SELECT encode(sha256(convert_to(COALESCE(string_agg(session_id,',' ORDER BY session_id),''),'UTF8')),'hex') FROM eligible)":"''::text";
      const cursorSql=spec.cursorScope===undefined?(spec.cursor??'TRUE'):`(${spec.cursor??'TRUE'}) AND ${scopeSql}=${params.add(spec.cursorScope)}`;
      // Current auth/role/team facts and the returned material share this final READ snapshot.
      const proof=(await tx.query<{authenticated:boolean;scope_valid:boolean;anchor_valid:boolean;cursor_valid:boolean;readable_scope:string;items:T[]}>(`${spec.prefix} SELECT (${sessionSql}) AS authenticated,
        EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal cp WHERE cp.id=$1::uuid AND cp.is_active
          AND ARRAY(SELECT DISTINCT role::text FROM pilot_ticket.pilot_principal_role WHERE principal_id=cp.id ORDER BY role::text)=$3::text[]
          AND ARRAY(SELECT DISTINCT team_id::text FROM pilot_ticket.pilot_team_member WHERE principal_id=cp.id ORDER BY team_id::text)=$4::text[]) AS scope_valid,
        (${spec.anchor??'TRUE'}) AS anchor_valid,(${cursorSql}) AS cursor_valid,${scopeSql} AS readable_scope,
        COALESCE((SELECT jsonb_agg(to_jsonb(result)) FROM (${spec.sql}) result),'[]'::jsonb) AS items`,params.values)).rows[0];
      if(!proof?.authenticated)invalid(WORKBENCH_ERROR_CODES.unauthenticated,401);if(!proof.scope_valid)invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
      if(!proof.anchor_valid)invalid(WORKBENCH_ERROR_CODES.notFound,404);if(!proof.cursor_valid)invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
      return {rows:proof.items,principal:p,scope:proof.readable_scope};
    });
  }
  function relation(p:WorkbenchPrincipal,params:Params,filterDeliveryException=false){
    const access=authorization.sessionAccessPredicate(p,{start:params.values.length+1,ticketAlias:'tk'});params.values.push(...access.values);
    const groupRef=GROUP_REF_SQL.replaceAll('i.','oi.');
    return `WITH eligible AS (SELECT s.id::text AS session_id,th.provider,th.channel_account_id,s.participant_key,
      s.status,s.control_mode,s.generation_version::integer,s.row_version::integer,to_char(s.last_activity_at,'YYYY-MM-DD HH24:MI:SS') AS last_activity_at,
      j.id::text AS journey_id,COALESCE(NULLIF(left(CASE WHEN j.profile_resolution_status='RESOLVED' THEN j.profile_snapshot->'contact'->>'name' END,128),''),'报修人（资料未提供）') AS participant_label,
      CASE WHEN j.profile_resolution_status='RESOLVED' THEN NULLIF(left(j.profile_snapshot->'memberships'->0->>'name',128),'') END AS department_label,
      CASE WHEN ct.id IS NOT NULL AND ($2::boolean OR ct.assignee_id=$1::uuid OR ('HANDLER'=ANY($3::text[]) AND ct.resolver_team_id=ANY($4::text[])))
        THEN jsonb_build_object('kind','ticket','id',ct.id,'number',ct.ticket_no,'title',ct.title)
        WHEN ct.id IS NULL AND $2::boolean AND rev.id IS NOT NULL THEN jsonb_build_object('kind','review','id',rev.id,'number','待复核','title',i.summary)
        WHEN ct.id IS NULL AND $2::boolean THEN jsonb_build_object('kind','intake','id',i.id,'number','服务受理','title',i.summary) END AS canonical_item,
      CASE WHEN ct.id IS NOT NULL AND ($2::boolean OR ct.assignee_id=$1::uuid OR ('HANDLER'=ANY($3::text[]) AND ct.resolver_team_id=ANY($4::text[])))
        THEN ct.title ELSE COALESCE(NULLIF(left(i.summary,512),''),'服务主题资料不可用') END AS topic,
      CASE WHEN oi.source_chat_type='group' AND oi.source_chat_id IS NOT NULL THEN jsonb_build_object('kind','group','label',COALESCE(gn.display_name,'群名称未登记'),'ref',${groupRef})
        WHEN oi.source_chat_type='single' THEN jsonb_build_object('kind','direct','label','Bot 私聊来源','ref',NULL)
        ELSE jsonb_build_object('kind','unknown','label','来源资料不可用','ref',NULL) END AS source,
      th.chat_type,COALESCE(i.source_provider='WECOM_AIBOT' AND th.provider=i.source_provider AND th.channel_account_id=i.source_bot_id
        AND th.chat_type=i.source_chat_type AND s.participant_key=i.reporter_wecom_userid
        AND th.external_thread_key=CASE WHEN i.source_chat_type='single' THEN i.reporter_wecom_userid ELSE i.source_chat_id END,false) AS reply_binding,
      COALESCE(a.assignment_status,'UNASSIGNED') AS assignment_status,a.assigned_principal_id::text,ap.display_name AS assigned_display_name,
      CASE WHEN h.id IS NOT NULL THEN jsonb_build_object('handoff_id',h.id,'status',h.status,'row_version',h.row_version::integer) END AS handoff,
      ${filterDeliveryException?`EXISTS(SELECT 1 FROM communication.message cm JOIN communication.outbox co ON co.message_id=cm.id JOIN communication.delivery d ON d.outbox_id=co.id
        WHERE cm.session_id=s.id AND cm.retention_until_epoch_ms>platform.physical_epoch_ms() AND d.status IN ('DEAD_LETTER','RECONCILIATION_REQUIRED'))`:'FALSE'} AS has_delivery_exception
      FROM conversation.session s JOIN conversation.thread th ON th.id=s.thread_id
      JOIN intake.service_intake i ON i.id=s.service_intake_id AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND i.source_provider=th.provider AND i.source_bot_id=th.channel_account_id AND i.reporter_wecom_userid=s.participant_key
      LEFT JOIN conversation.assignment a ON a.session_id=s.id LEFT JOIN pilot_ticket.pilot_principal ap ON ap.id=a.assigned_principal_id
      LEFT JOIN pilot_ticket.ticket tk ON tk.source_intake_id=i.id ${SESSION_JOURNEY_JOIN_SQL}
      LEFT JOIN pilot_ticket.ticket ct ON ct.id=COALESCE(tk.id,j.linked_ticket_id)
      LEFT JOIN intake.service_intake oi ON oi.id=CASE WHEN jb.count=0 THEN i.id ELSE j.origin_intake_id END AND oi.retention_until_epoch_ms>platform.physical_epoch_ms()
      ${params.sourceGroups?`LEFT JOIN workbench.source_group_name gn ON oi.source_chat_type='group' AND gn.ref=${groupRef}`:'LEFT JOIN LATERAL(SELECT NULL::text AS display_name) gn ON TRUE'}
      LEFT JOIN LATERAL(SELECT r.id FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING' ORDER BY r.created_at,r.id LIMIT 1) rev ON TRUE
      LEFT JOIN LATERAL(SELECT h.id,h.status,h.row_version FROM conversation.handoff h WHERE h.session_id=s.id ORDER BY h.requested_at DESC,h.id DESC LIMIT 1) h ON TRUE
      WHERE ${access.sql})`;
  }
  function entry(r:SessionRow,p:WorkbenchPrincipal):ConversationChatEntry{
    const capabilities=r.status==='ENDED'?[]:authorization.actionsFor(p,{assignedToMe:r.assignment_status==='ASSIGNED'&&r.assigned_principal_id===p.principal_id,canTakeover:r.assignment_status!=='ASSIGNED'}).filter(a=>{
      if(['READ_CURSOR','RECONCILE','DELIVERY_RETRY'].includes(a))return false;if(a==='REPLY')return r.reply_binding;
      if(a==='TAKEOVER')return r.assignment_status!=='ASSIGNED';if(['TRANSFER','FORCE_TRANSFER','RELEASE'].includes(a))return r.assignment_status==='ASSIGNED';
      if(a==='REQUEST_HANDOFF')return !['REQUESTED','ACCEPTED'].includes(r.handoff?.status??'');if(a==='CANCEL_HANDOFF')return r.handoff?.status==='REQUESTED';return true;
    });
    if(r.status!=='ENDED'&&r.assigned_principal_id===p.principal_id&&!capabilities.includes('TRANSFER'))capabilities.push('TRANSFER');
    return {session:{session_id:r.session_id,status:r.status,control_mode:r.control_mode,generation_version:r.generation_version,row_version:r.row_version,last_activity_at:assertLocalDateTime(r.last_activity_at)},
      participant_label:r.participant_label,department_label:r.department_label,topic:r.topic,channel_label:r.chat_type==='group'?'群来源 · 回复通过私聊':'Bot 私聊',
      canonical_item:r.canonical_item,assignment:{status:r.assignment_status,assigned_to_me:r.assigned_principal_id===p.principal_id,assigned_display_name:r.assigned_display_name},handoff:r.handoff,capabilities,
      contact_ref:conversationReference(key,'contact',r),topic_ref:conversationReference(key,'topic',r,r.journey_id?'journey:'+r.journey_id:'session:'+r.session_id),
      original_source:r.source,current_contact_channel:r.chat_type==='group'?'group':'direct',reply_channel_label:r.reply_binding?'发送到本人 Bot 私聊':'当前绑定不支持回复'};
  }
  async function detail(auth:WorkbenchAuthContext,id:string):Promise<ConversationChatEntry>{
    const result=await read<SessionRow>(auth,(p,v)=>({prefix:relation(p,v),sql:'SELECT * FROM eligible WHERE session_id='+v.add(uuidP2016(id),'::text')}));
    const row=result.rows[0];if(!row)invalid(WORKBENCH_ERROR_CODES.notFound,404);return entry(row,result.principal);
  }
  async function inbox(auth:WorkbenchAuthContext,url:URL):Promise<ConversationInboxPage>{
    guard();const c=conversationInboxCriteria(url),cursor=decode(url.searchParams.get('cursor')),criteria=digest(c,'INBOX_FILTER_V1');
    const result=await read<InboxRow>(auth,(p,v)=>{
      if(cursor&&(cursor.binding!==binding(auth,p)||cursor.criteria!==criteria))invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
      const base=relation(p,v,c.state==='failed_delivery'),predicates=[c.state==='ended'?"status='ENDED'":"status<>'ENDED'"];
      if(c.state==='mine')predicates.push("assignment_status='ASSIGNED' AND assigned_principal_id=$1::text");
      if(c.state==='unassigned')predicates.push("assignment_status='UNASSIGNED'");
      if(c.state==='waiting_human')predicates.push("(handoff->>'status'='REQUESTED' OR assignment_status='UNASSIGNED')");
      if(c.state==='waiting_user')predicates.push("status='WAITING_USER'");if(c.state==='failed_delivery')predicates.push('has_delivery_exception');
      if(c.source!=='all')predicates.push("source->>'kind'="+v.add(c.source));if(c.group)predicates.push("source->>'ref'="+v.add(c.group));
      if(c.q){const search=v.add('%'+c.q.replace(/[\\%_]/gu,'\\$&')+'%');predicates.push(`(participant_label ILIKE ${search} OR topic ILIKE ${search} OR (canonical_item->>'kind'='ticket' AND canonical_item->>'number' ILIKE ${search}))`);}
      const filtered=base+`, matched AS(SELECT * FROM eligible WHERE ${predicates.join(' AND ')}), grouped AS(
        SELECT provider,channel_account_id,participant_key,max(last_activity_at) AS latest_activity_at,
          count(DISTINCT COALESCE('j:'||journey_id,'s:'||session_id))::integer AS matching_topic_count,
          count(DISTINCT assigned_principal_id) FILTER(WHERE status<>'ENDED' AND assignment_status='ASSIGNED')::integer AS owner_count,
          count(*) FILTER(WHERE status<>'ENDED' AND assignment_status='ASSIGNED')::integer AS assigned_count,
          count(*) FILTER(WHERE status<>'ENDED' AND assigned_principal_id=$1::text)::integer AS mine_count,count(*)::integer AS session_count,
          max(assigned_display_name) AS owner_name,
          (array_agg(session_id ORDER BY (status<>'ENDED' AND reply_binding) DESC,last_activity_at DESC,session_id DESC))[1] AS anchor_session_id,
          (array_agg(participant_label ORDER BY last_activity_at DESC,session_id DESC))[1] AS participant_label,
          (array_agg(department_label ORDER BY last_activity_at DESC,session_id DESC))[1] AS department_label
        FROM matched GROUP BY provider,channel_account_id,participant_key)`;
      let boundary='',valid='TRUE';if(cursor){const anchor=v.add(cursor.anchor),at=v.add(cursor.at);valid=`EXISTS(SELECT 1 FROM grouped WHERE anchor_session_id=${anchor} AND latest_activity_at=${at})`;
        boundary=` WHERE (g.latest_activity_at,g.provider,g.channel_account_id,g.participant_key)<(${at},(SELECT provider FROM grouped WHERE anchor_session_id=${anchor}),(SELECT channel_account_id FROM grouped WHERE anchor_session_id=${anchor}),(SELECT participant_key FROM grouped WHERE anchor_session_id=${anchor}))`;}
      const order=' ORDER BY g.latest_activity_at DESC,g.provider DESC,g.channel_account_id DESC,g.participant_key DESC';
      const prefix=filtered+`, page AS MATERIALIZED(SELECT g.* FROM grouped g ${boundary}${order} LIMIT ${v.add(c.limit+1)}),
        page_sessions AS MATERIALIZED(SELECT m.* FROM matched m JOIN page p USING(provider,channel_account_id,participant_key)),
        origins AS(SELECT DISTINCT provider,channel_account_id,participant_key,source FROM page_sessions),
        material AS(SELECT ps.provider,ps.channel_account_id,ps.participant_key,
          count(*) FILTER(WHERE item.visibility IN ('EXTERNAL','INTERNAL') AND item.sequence_no>COALESCE(rc.last_read_sequence,0))::integer AS unread_count,
          (array_agg(jsonb_build_object('item_id',item.id,'text',left(item.text,256),'sender_kind',item.sender_kind,'visibility',item.visibility)
            ORDER BY item.occurred_at DESC,item.sequence_no DESC,item.id DESC) FILTER(WHERE NULLIF(btrim(item.text),'') IS NOT NULL))[1] AS last_item
          FROM page_sessions ps JOIN conversation.item item ON item.session_id=ps.session_id::uuid
          LEFT JOIN conversation.read_cursor rc ON rc.session_id=item.session_id AND rc.principal_id=$1::uuid
          WHERE item.retention_until>platform.local_now() AND (item.visibility IN ('EXTERNAL','INTERNAL') OR ('ADMIN'=ANY($3::text[]) AND item.visibility='RESTRICTED'))
          GROUP BY ps.provider,ps.channel_account_id,ps.participant_key),
        exceptions AS(SELECT DISTINCT ps.provider,ps.channel_account_id,ps.participant_key FROM page_sessions ps
          JOIN communication.message cm ON cm.session_id=ps.session_id::uuid JOIN communication.outbox co ON co.message_id=cm.id JOIN communication.delivery d ON d.outbox_id=co.id
          WHERE cm.retention_until_epoch_ms>platform.physical_epoch_ms() AND d.status IN ('DEAD_LETTER','RECONCILIATION_REQUIRED'))`;
      const sql=`SELECT g.*,COALESCE(m.unread_count,0) AS unread_count,m.last_item,ex.provider IS NOT NULL AS has_delivery_exception,
        (SELECT count(*)::integer FROM origins o WHERE (o.provider,o.channel_account_id,o.participant_key)=(g.provider,g.channel_account_id,g.participant_key)) AS source_count,
        ARRAY(SELECT source FROM origins o WHERE (o.provider,o.channel_account_id,o.participant_key)=(g.provider,g.channel_account_id,g.participant_key) ORDER BY source::text LIMIT 8) AS sources
        FROM page g LEFT JOIN material m USING(provider,channel_account_id,participant_key) LEFT JOIN exceptions ex USING(provider,channel_account_id,participant_key)${order}`;
      return {prefix,sql,cursor:valid,scope:true,...(cursor?{cursorScope:cursor.scope}:{})};
    });
    const rows=result.rows.slice(0,c.limit),last=rows.at(-1);
    const items=rows.map((r):ConversationInboxEntry=>({contact_ref:conversationReference(key,'contact',r),participant_label:r.participant_label,department_label:r.department_label,anchor_session_id:r.anchor_session_id,
      matching_topic_count:r.matching_topic_count,latest_activity_at:assertLocalDateTime(r.latest_activity_at),last_item_preview:r.last_item,unread_count:r.unread_count,source_badges:r.sources,additional_source_count:Math.max(0,r.source_count-r.sources.length),
      assignment_summary:r.owner_count===0?{kind:'UNASSIGNED',label:c.state==='ended'?'历史主题':'待接待'}:r.mine_count===r.session_count?{kind:'MINE',label:'我接待的'}:r.owner_count===1&&r.assigned_count===r.session_count?{kind:'SINGLE',label:r.owner_name??'工作人员'}:{kind:'MIXED',label:'多个主题由不同同事接待'},has_delivery_exception:r.has_delivery_exception}));
    return {items,next_cursor:result.rows.length>c.limit&&last?encode({v:2,binding:binding(auth,result.principal),criteria,scope:result.scope,at:last.latest_activity_at,anchor:last.anchor_session_id}):null};
  }
  async function related(auth:WorkbenchAuthContext,id:string,url:URL):Promise<ConversationRelatedPage>{
    guard();keys(url,['cursor','limit']);const limit=integer(url.searchParams.get('limit'),50,100),cursor=decode(url.searchParams.get('cursor')),criteria=digest(['related',id,limit],'RELATED_FILTER_V1');
    const result=await read<SessionRow>(auth,(p,v)=>{
      if(cursor&&(cursor.binding!==binding(auth,p)||cursor.criteria!==criteria))invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
      const base=relation(p,v),anchorId=v.add(id),boundary=cursor?` AND (r.last_activity_at,r.session_id)<(${v.add(cursor.at)},${v.add(cursor.anchor)})`:'';
      const anchor=`EXISTS(SELECT 1 FROM eligible WHERE session_id=${anchorId})`;
      const valid=cursor?`EXISTS(SELECT 1 FROM eligible c JOIN eligible a ON a.session_id=${anchorId}
        AND (c.provider,c.channel_account_id,c.participant_key)=(a.provider,a.channel_account_id,a.participant_key)
        WHERE c.session_id=${v.add(cursor.anchor)} AND c.last_activity_at=${v.add(cursor.at)})`:'TRUE';
      return {prefix:base,anchor,cursor:valid,scope:true,...(cursor?{cursorScope:cursor.scope}:{}),sql:`SELECT r.* FROM eligible r JOIN eligible anchor ON anchor.session_id=${anchorId}
        AND (r.provider,r.channel_account_id,r.participant_key)=(anchor.provider,anchor.channel_account_id,anchor.participant_key)
        WHERE TRUE ${boundary} ORDER BY r.last_activity_at DESC,r.session_id DESC LIMIT ${v.add(limit+1)}`};
    });
    const rows=result.rows.slice(0,limit),last=rows.at(-1);
    return {items:rows.map(r=>entry(r,result.principal)),next_cursor:result.rows.length>limit&&last?encode({v:2,binding:binding(auth,result.principal),criteria,scope:result.scope,at:last.last_activity_at,anchor:last.session_id}):null};
  }
  async function chatItems(auth:WorkbenchAuthContext,id:string,url:URL):Promise<ConversationChatItemPage>{
    guard();keys(url,['view','before_sequence','after_sequence','limit']);
    const before=url.searchParams.get('before_sequence'),after=url.searchParams.get('after_sequence'),limit=integer(url.searchParams.get('limit'),50,200);
    if(before!==null&&after!==null)invalid();
    for(const sequence of [before,after])if(sequence!==null&&(!/^(0|[1-9][0-9]{0,18})$/u.test(sequence)||BigInt(sequence)>9223372036854775807n))invalid();
    const result=await read<ConversationChatItemPage['items'][number]>(auth,(p,v)=>{
      const base=relation(p,v),boundary=before!==null?' AND item.sequence_no<'+v.add(before,'::bigint'):after!==null?' AND item.sequence_no>'+v.add(after,'::bigint'):'';
      const session=v.add(uuidP2016(id));
      return {prefix:base,anchor:`EXISTS(SELECT 1 FROM eligible WHERE session_id=${session})`,sql:`SELECT item.id::text AS item_id,item.sequence_no::text,item.item_type,item.sender_kind,item.visibility,
        COALESCE(item.text,CASE WHEN item.item_type='HANDOFF_EVENT' THEN CASE item.safe_content->>'event_type'
          WHEN 'HANDOFF_REQUESTED' THEN '已请求人工接待' WHEN 'HANDOFF_ACCEPTED' THEN '已接受人工接待'
          WHEN 'HANDOFF_RELEASED' THEN '已释放沟通责任' WHEN 'HANDOFF_CANCELLED' THEN '已取消人工接待请求'
          WHEN 'ASSIGNMENT_ASSIGNED' THEN '已领取沟通接待' WHEN 'ASSIGNMENT_TRANSFERRED' THEN '已转交沟通责任'
          WHEN 'ASSIGNMENT_RELEASED' THEN '已释放沟通责任' END END) AS text,
        to_char(item.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,
        CASE WHEN m.purpose='INTERNAL_NOTE' OR item.item_type='INTERNAL_NOTE' THEN COALESCE(mp.display_name,'工作人员（历史姓名未登记）')
          WHEN item.sender_kind='USER' THEN e.participant_label
          WHEN m.sender_kind='AGENT' THEN COALESCE(mp.display_name,'工作人员（历史姓名未登记）')
          WHEN confirmed.actor_id IS NOT NULL THEN COALESCE(hp.display_name,'工作人员（历史姓名未登记）')
          WHEN m.sender_system_code='RULE_FIRST_ORCHESTRATOR' THEN '医小修 · 自动'
          ELSE '医小修 · 系统' END AS sender_label,
        CASE WHEN m.purpose='INTERNAL_NOTE' OR item.item_type='INTERNAL_NOTE' THEN 'INTERNAL_NOTE' WHEN item.sender_kind='USER' THEN 'USER'
          WHEN m.sender_kind='AGENT' THEN 'HUMAN'
          WHEN confirmed.actor_id IS NOT NULL THEN 'HUMAN'
          WHEN m.sender_system_code='RULE_FIRST_ORCHESTRATOR' THEN 'AUTOMATED_RULE' ELSE 'SYSTEM' END AS sender_category,
        m.id::text AS communication_message_id,CASE WHEN item.sender_kind='USER' THEN CASE WHEN e.chat_type='group' THEN '群内原始消息' ELSE 'Bot 私聊' END
          WHEN m.purpose='INTERNAL_NOTE' THEN '内部记录' WHEN m.sender_kind='AGENT' AND m.visibility='EXTERNAL' THEN 'Bot 私聊回复'
          WHEN m.sender_system_code='RULE_FIRST_ORCHESTRATOR' THEN CASE WHEN EXISTS(SELECT 1 FROM communication.outbox co JOIN communication.delivery cd ON cd.outbox_id=co.id WHERE co.message_id=m.id AND cd.target_type='GROUP') THEN '群内规则回复' ELSE 'Bot 私聊规则回复' END
          ELSE '服务记录' END AS source_label,
        CASE WHEN m.message_type IN ('image','file','mixed') OR item.item_type IN ('ATTACHMENT','MEDIA_MESSAGE')
          OR item.safe_content->>'has_media'='true' OR item.safe_content->>'msg_type' IN ('image','mixed','voice','file','video')
          OR item.safe_content ? 'attachment_ids' OR item.safe_content ? 'media_id' THEN 'UNAVAILABLE' ELSE 'NOT_MEDIA' END AS media_availability
        FROM eligible e JOIN conversation.item item ON item.session_id=e.session_id::uuid
        LEFT JOIN conversation.item_source_binding binding ON binding.item_id=item.id AND binding.session_id=item.session_id
        LEFT JOIN communication.message m ON COALESCE(binding.source_type,item.source_type)='COMMUNICATION_MESSAGE'
          AND m.id::text=COALESCE(binding.source_id,item.source_id)
          AND m.session_id=item.session_id AND m.retention_until_epoch_ms>platform.physical_epoch_ms()
        LEFT JOIN pilot_ticket.pilot_principal mp ON mp.id=m.sender_principal_id
        LEFT JOIN LATERAL(SELECT min(review.resolved_by_principal_id::text)::uuid AS actor_id
          FROM intake.safe_action_suggestion a JOIN intake.deterministic_decision decision ON decision.id=a.decision_id
          JOIN intake.manual_review_item review ON review.resolution_decision_id=decision.id AND review.status='RESOLVED'
          WHERE m.sender_system_code='RULE_FIRST_ORCHESTRATOR' AND decision.status='HUMAN_OVERRIDDEN'
            AND ${RULE_ACTION_MESSAGE_JOIN_SQL}
          HAVING count(DISTINCT review.resolved_by_principal_id)=1) confirmed ON TRUE
        LEFT JOIN pilot_ticket.pilot_principal hp ON hp.id=confirmed.actor_id
        WHERE e.session_id=${session} AND item.retention_until>platform.local_now()
          AND item.item_type<>'DELIVERY_STATUS' AND COALESCE(binding.source_type,item.source_type)<>'DELIVERY'
          AND (item.visibility IN ('EXTERNAL','INTERNAL') OR 'ADMIN'=ANY($3::text[]))
          AND (COALESCE(binding.source_type,item.source_type)<>'COMMUNICATION_MESSAGE' OR m.id IS NOT NULL)
          ${boundary} ORDER BY item.sequence_no ${after!==null?'ASC':'DESC'} LIMIT ${v.add(limit+1)}`};
    });
    const items=result.rows.slice(0,limit);if(after===null)items.reverse();
    return {session_id:id,items,before_sequence:items[0]?.sequence_no??null,after_sequence:items.at(-1)?.sequence_no??null,has_more:result.rows.length>limit};
  }
  async function chatDeliveries(auth:WorkbenchAuthContext,id:string,url:URL):Promise<ConversationChatDeliveryPage>{
    guard();keys(url,['view','message_ids','cursor','limit']);const limit=integer(url.searchParams.get('limit'),100,100),raw=url.searchParams.get('message_ids');
    const ids=raw===null?[]:raw.split(',').map(uuidP2016);if(ids.length>50||raw!==null&&ids.length===0||new Set(ids).size!==ids.length)invalid();ids.sort();
    const cursor=decode(url.searchParams.get('cursor')),criteria=digest(['deliveries',id,ids,limit],'DELIVERY_FILTER_V1');
    const result=await read<ConversationWorkspaceDelivery>(auth,(p,v)=>{
      if(cursor&&(cursor.binding!==binding(auth,p)||cursor.criteria!==criteria))invalid(WORKBENCH_ERROR_CODES.cursorInvalid);
      const prefix=relation(p,v),session=v.add(uuidP2016(id));
      const messages=ids.length?' AND m.id=ANY('+v.add(ids,'::uuid[]')+')':'';
      const eligible=`FROM eligible e JOIN communication.message m ON m.session_id=e.session_id::uuid
        JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
        WHERE e.session_id=${session} AND m.visibility='EXTERNAL' AND m.retention_until_epoch_ms>platform.physical_epoch_ms()${messages}`;
      return {prefix,anchor:`EXISTS(SELECT 1 FROM eligible WHERE session_id=${session})`,scope:true,...(cursor?{cursorScope:cursor.scope}:{}),
        cursor:cursor?`EXISTS(SELECT 1 ${eligible} AND d.id=${v.add(cursor.anchor,'::uuid')})`:'TRUE',
        sql:`SELECT m.id::text AS message_id,m.purpose,d.id::text AS delivery_id,d.status,d.side_effect_state,d.provider AS channel,d.attempt_count,d.last_error_code,
        CASE WHEN d.sent_at IS NOT NULL THEN to_char(d.sent_at,'YYYY-MM-DD HH24:MI:SS') END AS sent_at,to_char(m.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at
        ${eligible} ${cursor?'AND d.id<'+v.add(cursor.anchor,'::uuid'):''}
        ORDER BY d.id DESC LIMIT ${v.add(limit+1)}`};
    });
    const rows=result.rows.slice(0,limit),last=rows.at(-1);
    return {items:rows,next_cursor:result.rows.length>limit&&last?encode({v:2,binding:binding(auth,result.principal),criteria,scope:result.scope,at:last.created_at,anchor:last.delivery_id}):null};
  }
  return {enabled,detail,inbox,related,chatItems,chatDeliveries};
}
