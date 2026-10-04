import type { TicketStatus } from './p1-005-pilot-ticket-core.mjs';
import type { SendTemplateCardMsgBody } from '@wecom/aibot-node-sdk';
export interface CardModel { public_ref: string; suffix: string; status: TicketStatus; occurred_at: string; version: number; notification_type: 'TICKET_CREATED' | 'TICKET_ACCEPTED' | 'TICKET_IN_PROGRESS' | 'WAITING_REQUESTER' | 'WAITING_VENDOR' | 'TICKET_RESOLVED' | 'TICKET_CLOSED' | 'TICKET_REOPENED' | 'TICKET_CANCELLED'; source: 'GROUP' | 'DIRECT' }
export type ReporterLinkMode = 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED';
interface LinkOptions { origin: string; allowedHosts: readonly string[]; token?: string | undefined; publicRef?: string | undefined; allowLocalHttp?: boolean; linkMode?: ReporterLinkMode }
export interface CardOptions extends Omit<LinkOptions, 'publicRef'> { model: unknown }

import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { exactP2016,failP2016,localP2016,publicP2016,versionP2016 } from './p2-016-domain-contracts.mjs';

export function validateP2016CardModel(input: unknown): CardModel {
  const v=exactP2016(input,['public_ref','suffix','status','occurred_at','version','notification_type','source']);
  if(typeof v.public_ref!=='string'||typeof v.suffix!=='string'||typeof v.status!=='string'
    ||!/^[A-Za-z0-9_-]{32}$/u.test(v.public_ref)||!/^[0-9]{4}$/u.test(v.suffix)
    ||!Object.hasOwn(EXTERNAL_TICKET_STATUS,v.status)||!['GROUP','DIRECT'].includes(v.source as string)
    ||!['TICKET_CREATED','TICKET_ACCEPTED','TICKET_IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','TICKET_RESOLVED','TICKET_CLOSED','TICKET_REOPENED','TICKET_CANCELLED'].includes(v.notification_type as string))failP2016('CARD_INVALID');
  versionP2016(v.version);localP2016(v.occurred_at);// Exact keys and all scalar/domain guards above establish the persisted model.
  return publicP2016(v) as CardModel & Record<string, unknown>;
}
export function reporterCardLinkP2016({origin,allowedHosts,token,publicRef,allowLocalHttp=false,linkMode='LEGACY_BOUND_GRANT'}: LinkOptions) {
  if(!['LEGACY_BOUND_GRANT','MEMBER_REQUIRED'].includes(linkMode)||typeof origin!=='string'||!Array.isArray(allowedHosts)
    ||(linkMode==='LEGACY_BOUND_GRANT'?(typeof token!=='string'||!/^[A-Za-z0-9_-]{64}$/u.test(token)):
      (typeof publicRef!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(publicRef))))failP2016('CARD_URL_INVALID');
  let url;try{url=new URL(origin);}catch{failP2016('CARD_URL_INVALID');}
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!allowedHosts.includes(url.host)
    ||(url.protocol!=='https:'&&!(allowLocalHttp===true&&url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname))))failP2016('CARD_URL_INVALID');
  return linkMode==='MEMBER_REQUIRED'?url.origin+'/wecom/yixiaoxiu/tickets/'+publicRef:url.origin+'/reporter/open#grant='+token;
}
export function buildP2016TemplateCard({model,origin,allowedHosts,token,allowLocalHttp=false,linkMode='LEGACY_BOUND_GRANT'}: CardOptions) {
  const v=validateP2016CardModel(model),url=reporterCardLinkP2016({origin,allowedHosts,token,publicRef:v.public_ref,allowLocalHttp,linkMode});
  return publicP2016<SendTemplateCardMsgBody>({msgtype:'template_card',template_card:{
    card_type:'text_notice',source:{desc:v.source==='GROUP'?'群聊报修':'主动单聊',desc_color:0},
    main_title:{title:v.notification_type==='TICKET_CREATED'?'工单已受理':v.notification_type==='TICKET_ACCEPTED'?'已有人员处理您的工单':v.notification_type==='TICKET_CLOSED'?'工单已处理完成':'工单状态更新'},
    emphasis_content:{title:v.suffix,desc:'工单尾号'},sub_title_text:'完整工单号与处理进度请通过下方入口查看。',
    horizontal_content_list:[{keyname:'状态',value:EXTERNAL_TICKET_STATUS[v.status]},{keyname:'更新时间',value:v.occurred_at}],
    jump_list:[{type:1,title:'查看处理进度',url}],card_action:{type:1,url},task_id:'ticket_'+v.public_ref+'_'+v.version,
  }});
}
