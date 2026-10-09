import type { IncomingMessage } from 'node:http';
import type { WorkbenchHttpOptions } from './p2-006-workbench-http.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { createP2016TicketCommandFacade } from './p2-016-ticket-command-facade.mjs';
import type { createP2016DeliveryControl } from './p2-016-delivery-control.mjs';
import type { LedgerResult, LedgerSuccess } from './p2-016-ticket-command-ledger.mjs';
import type {createTicketSelfHandlingService} from './workbench-ticket-self-handling.mjs';
import type {createTicketStaffCompletionService} from './workbench-ticket-completion.mjs';
import type {createTicketConversationHandlingService} from './workbench-ticket-conversation-handling.mjs';
import type {createTicketAssignmentService} from './workbench-ticket-assignment.mjs';
import {normalizeTicketAssignmentCommand} from './workbench-ticket-assignment.mjs';
import {createHash} from 'node:crypto';
import {RealtimeScopeUnavailable} from './p2-006-workbench-authorization.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
type HttpContext = Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
interface ReviewPort { manualReviewReceipt:(input:{authContext:unknown;reviewId:unknown;commandId:unknown})=>Promise<unknown>;listManualReviews: (input: { authContext: unknown; status: string; priority: string | null; cursor: string | null; limit: string | null }) => Promise<unknown>; getManualReviewDetail: (input: { authContext: unknown; reviewId: string }) => Promise<unknown>; journey: (input: { authContext: unknown; journeyId: string; part: string | null }) => Promise<unknown>; resolveManualReview: (input: { authContext: unknown; reviewId: string; body: unknown }) => Promise<LedgerResult<LedgerSuccess>> }
interface HttpOptions { assignment?:ReturnType<typeof createTicketAssignmentService>|null;staffCompletion?:ReturnType<typeof createTicketStaffCompletionService>|null;conversationHandling?:ReturnType<typeof createTicketConversationHandlingService>|null;workbenchConversationsEnabled?:boolean;workbenchManualReportsEnabled?:boolean;workbenchRealtimeEnabled?:boolean;realtimeAuthorization?:(principal:WorkbenchPrincipal)=>Promise<unknown>;workbenchManualReviewEnabled?:boolean;selfHandling?:ReturnType<typeof createTicketSelfHandlingService>|null; query: P2016TicketQuery; tickets: ReturnType<typeof createP2016TicketCommandFacade>; reviews: ReviewPort; deliveryControl: ReturnType<typeof createP2016DeliveryControl>; enabled?: boolean;sourceGroupDirectoryEnabled?:boolean;workbenchInternalNotesEnabled?:boolean;workbenchDraftRecoveryEnabled?:boolean;logoutReady?:()=>boolean }

import { failP2016,guardP2016,exactP2016 } from './p2-016-domain-contracts.mjs';
function checkVersion(request: IncomingMessage,value: unknown) {
  const raw=request.headers['if-match'],text=typeof raw==='string'?raw.replace(/^W\//u,'').replace(/^"|"$/gu,''):'';
  if(!/^[1-9][0-9]{0,18}$/u.test(text)||text!==String(value))failP2016('VERSION_CONFLICT',409);
}
function queryKeys(url: URL,allowed: readonly string[]) {if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))failP2016();}
function status(result: LedgerResult<LedgerSuccess>) {return result.ok===false?result.error.code==='P2_016_NOT_FOUND'?404:/FORBIDDEN|PERMITTED|TARGET_INVALID/u.test(result.error.code)?403:/FAILED|UNAVAILABLE/u.test(result.error.code)?503:409:200;}
export function createP2016WorkbenchHttp({query,tickets,reviews,deliveryControl,enabled=false,workbenchManualReviewEnabled=false,workbenchManualReportsEnabled=false,sourceGroupDirectoryEnabled=false,workbenchInternalNotesEnabled=false,selfHandling=null,conversationHandling=null,assignment=null,staffCompletion=null,workbenchDraftRecoveryEnabled=false,workbenchConversationsEnabled=false,workbenchRealtimeEnabled=false,realtimeAuthorization,logoutReady=()=>false}: HttpOptions) {
  return async({request,response,url,authContext,readJson,validateWriteRequest,json}: HttpContext)=>{
    const matched=/^\/api\/(tickets(?:\/|$)|manual-reviews(?:\/|$)|contact-journeys(?:\/|$)|lifecycle\/bootstrap$)/u.test(url.pathname)
      ||/^\/api\/conversations\/[^/]+\/takeover-and-accept-ticket$/u.test(url.pathname);
    if(!matched)return false;guardP2016(enabled);
    if(request.method==='GET'){
      const assignmentReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/assignment\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(assignmentReceipt){if(!assignment)failP2016('DISABLED',503);guardP2016(workbenchDraftRecoveryEnabled);queryKeys(url,[]);json(response,200,await assignment.acknowledgement({authContext,ticketId:assignmentReceipt[1],commandId:assignmentReceipt[2]}));return true;}
      const reviewReceipt=/^\/api\/manual-reviews\/([0-9a-f-]{36})\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(reviewReceipt){guardP2016(workbenchManualReviewEnabled&&workbenchDraftRecoveryEnabled);queryKeys(url,[]);
        json(response,200,await reviews.manualReviewReceipt({authContext,reviewId:reviewReceipt[1],commandId:reviewReceipt[2]}));return true;}
      const conversationAck=/^\/api\/tickets\/([0-9a-f-]{36})\/conversation-handling-commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(conversationAck){if(!conversationHandling)failP2016('DISABLED',503);guardP2016(workbenchDraftRecoveryEnabled);queryKeys(url,[]);
        json(response,200,await conversationHandling.acknowledgement({authContext,ticketId:conversationAck[1],commandId:conversationAck[2]}));return true;}
      const completionReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/completion\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(completionReceipt){if(!staffCompletion)failP2016('DISABLED',503);guardP2016(workbenchDraftRecoveryEnabled);queryKeys(url,[]);json(response,200,await staffCompletion.receipt({authContext,ticketId:completionReceipt[1],commandId:completionReceipt[2]}));return true;}
      const noteReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/internal-notes\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(noteReceipt){guardP2016(workbenchInternalNotesEnabled&&workbenchDraftRecoveryEnabled);queryKeys(url,[]);
        json(response,200,await tickets.internalNoteReceipt({authContext,ticketId:noteReceipt[1],commandId:noteReceipt[2]}));return true;}
      if(url.pathname==='/api/lifecycle/bootstrap'){queryKeys(url,[]);const principal=await query.principal(authContext);
        const realtimeEnabled=workbenchRealtimeEnabled&&authContext.auth_method==='COOKIE';let realtimeAvailable=false;
        if(realtimeEnabled&&realtimeAuthorization)try{realtimeAvailable=Boolean(await realtimeAuthorization(principal));}catch(error){if(!(error instanceof RealtimeScopeUnavailable))throw error;}
        json(response,200,{principal_id:principal.principal_id,display_name:principal.display_name,csrf_token:authContext.auth_method==='COOKIE'?authContext.csrf_token:null,
          realtime_sse_enabled:realtimeEnabled,realtime_sse_available:realtimeAvailable,sse_endpoint:realtimeEnabled?'/api/realtime/events?scope=workbench':null,expires_epoch_ms:authContext.expires_epoch_ms,
          authorization_revision:realtimeEnabled?createHash('sha256').update(JSON.stringify([principal.principal_id,principal.roles,principal.team_ids])).digest('hex'):null,
          internal_beta:true,ai_enabled:false,manual_reports_enabled:workbenchManualReportsEnabled,manual_report_draft_recovery_enabled:workbenchManualReportsEnabled&&workbenchDraftRecoveryEnabled,manual_review_enabled:workbenchManualReviewEnabled,manual_review_draft_recovery_enabled:workbenchManualReviewEnabled&&workbenchDraftRecoveryEnabled,roles:principal.roles,polling_interval_ms:5000,source_group_directory_enabled:sourceGroupDirectoryEnabled,internal_notes_enabled:workbenchInternalNotesEnabled,ticket_assignment_enabled:assignment!==null,ticket_assignment_draft_recovery_enabled:assignment!==null&&workbenchDraftRecoveryEnabled,ticket_self_handling_enabled:selfHandling!==null,ticket_staff_completion_enabled:staffCompletion!==null,ticket_conversation_self_handling_enabled:conversationHandling!==null,ticket_conversation_draft_recovery_enabled:conversationHandling!==null&&workbenchDraftRecoveryEnabled,draft_recovery_enabled:workbenchInternalNotesEnabled&&workbenchDraftRecoveryEnabled,conversation_workspace_enabled:enabled&&workbenchConversationsEnabled,conversation_draft_recovery_enabled:enabled&&workbenchConversationsEnabled&&workbenchDraftRecoveryEnabled,staff_completion_draft_recovery_enabled:staffCompletion!==null&&workbenchDraftRecoveryEnabled,logout_enabled:logoutReady()&&authContext.auth_method==='COOKIE'&&typeof authContext.csrf_token==='string'&&authContext.csrf_token.length>0});return true;}
      const related=/^\/api\/tickets\/([0-9a-f-]{36})\/related-conversations$/iu.exec(url.pathname);
      const assignmentTargets=/^\/api\/tickets\/([0-9a-f-]{36})\/assignment-targets$/iu.exec(url.pathname);
      if(assignmentTargets){if(!assignment)failP2016('DISABLED',503);queryKeys(url,['resolver_team_id','target_principal_id']);json(response,200,await query.assignmentTargets({authContext,ticketId:assignmentTargets[1],resolverTeamId:url.searchParams.get('resolver_team_id'),targetPrincipalId:url.searchParams.get('target_principal_id')}));return true;}
      if(related){if(!conversationHandling&&!assignment)failP2016('DISABLED',503);queryKeys(url,['cursor','limit']);json(response,200,await query.relatedConversations({authContext,ticketId:related[1],cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;}
      if(url.pathname==='/api/tickets'){queryKeys(url,['state','cursor','limit']);json(response,200,await query.list({authContext,state:url.searchParams.get('state')??'queued',cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;}
      if(url.pathname==='/api/manual-reviews'){queryKeys(url,['status','priority','cursor','limit']);json(response,200,await reviews.listManualReviews({authContext,status:url.searchParams.get('status')??'PENDING',priority:url.searchParams.get('priority'),cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;}
      const ticket=/^\/api\/tickets\/([0-9a-f-]{36})(?:\/(events|responsibility|deliveries|eligible-principals|reporter-contact))?$/iu.exec(url.pathname);
      if(ticket){
        queryKeys(url,ticket[2]==='events'?['cursor','limit']:[]);
        const input={authContext,ticketId:ticket[1] as string},part=ticket[2]==='eligible-principals'?'eligiblePrincipals':ticket[2]==='reporter-contact'?'reporterContact':ticket[2]??'detail';
        const result=await query[part as 'events' | 'responsibility' | 'deliveries' | 'eligiblePrincipals' | 'reporterContact' | 'detail'](part==='events'?{...input,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}:input);
        json(response,200,result,part==='detail'?{etag:'"'+(result as { version: number }).version+'"'}:{});return true;
      }
      const review=/^\/api\/manual-reviews\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(review){queryKeys(url,[]);json(response,200,await reviews.getManualReviewDetail({authContext,reviewId:review[1] as string}));return true;}
      const journey=/^\/api\/contact-journeys\/([0-9a-f-]{36})(?:\/(legs|decisions))?$/iu.exec(url.pathname);
      if(journey){queryKeys(url,[]);json(response,200,await reviews.journey({authContext,journeyId:journey[1] as string,part:journey[2]??null}));return true;}
    }
    if(request.method==='POST'){
      queryKeys(url,[]);
      const body=await readJson(request);validateWriteRequest(request,authContext,body,{sessionMutation:false});
      const assignmentRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/(assign|transfer-assignment)$/iu.exec(url.pathname);
      if(assignmentRoute){if(!assignment)failP2016('DISABLED',503);exactP2016(body,['client_command_id','expected_version','reason_code','target_principal_id','resolver_team_id','communication_choice','sessions']);const command=normalizeTicketAssignmentCommand({...body,action:assignmentRoute[2],ticket_id:assignmentRoute[1]});checkVersion(request,command.expected_version);const result=await assignment.perform({authContext,command});json(response,status(result),result);return true;}
      const conversationHandlingRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/(take-and-start-with-conversations|accept-for-later-with-conversations)$/iu.exec(url.pathname);
      if(conversationHandlingRoute){
        if(!conversationHandling)failP2016('DISABLED',503);checkVersion(request,body.expected_version);
        exactP2016(body,['client_command_id','expected_version','reason_code','resolver_team_id','communication_choice','sessions']);
        const result=await conversationHandling.perform({authContext,command:{...body,ticket_id:conversationHandlingRoute[1],action:conversationHandlingRoute[2]}});
        json(response,status(result),result);return true;
      }
      const completion=/^\/api\/tickets\/([0-9a-f-]{36})\/complete$/iu.exec(url.pathname);
      if(completion){if(!staffCompletion)failP2016('DISABLED',503);checkVersion(request,body.expected_version);exactP2016(body,['client_command_id','expected_version','reason_code','handling_cycle_id','internal_process','external_summary','external_summary_confirmed']);const result=await staffCompletion.perform({authContext,command:{...body,action:'complete',ticket_id:completion[1]}});json(response,status(result),result);return true;}
      const handling=/^\/api\/tickets\/([0-9a-f-]{36})\/(take-and-start|accept-for-later)$/iu.exec(url.pathname);
      if(handling){
        if(!selfHandling)failP2016('DISABLED',503);checkVersion(request,body.expected_version);
        exactP2016(body,['client_command_id','expected_version','reason_code','resolver_team_id']);
        const result=await selfHandling.perform({authContext,command:{...body,ticket_id:handling[1],action:handling[2]}});
        json(response,status(result),result);return true;
      }
      const delivery=/^\/api\/tickets\/([0-9a-f-]{36})\/deliveries\/([0-9a-f-]{36})\/(retry|reconcile)$/iu.exec(url.pathname);
      if(delivery){const result=await deliveryControl.perform({authContext,ticketId:delivery[1] as string,deliveryId:delivery[2] as string,action:delivery[3] as string,body});json(response,status(result),result);return true;}
      const review=/^\/api\/manual-reviews\/([0-9a-f-]{36})\/resolve$/iu.exec(url.pathname);
      if(review){checkVersion(request,body.expected_row_version);const result=await reviews.resolveManualReview({authContext,reviewId:review[1] as string,body});json(response,status(result),result);return true;}
      const combined=/^\/api\/conversations\/([0-9a-f-]{36})\/takeover-and-accept-ticket$/iu.exec(url.pathname);
      if(combined){
        checkVersion(request,body.expected_session_row_version);
        const {ticket_id,expected_ticket_version,...rest}=body;
        const result=await tickets.perform({authContext,command:{...rest,ticket_id,expected_version:expected_ticket_version,session_id:combined[1],action:'takeover-and-accept-ticket'}});
        json(response,status(result),result);return true;
      }
      const ticket=/^\/api\/tickets\/([0-9a-f-]{36})\/(queue|accept|start|request-information|wait-vendor|resume|resolve|confirm|reopen|cancel|notes|internal-notes|transfer)$/iu.exec(url.pathname);
      if(ticket){checkVersion(request,body.expected_version);
        if(ticket[2]==='internal-notes'){
          guardP2016(workbenchInternalNotesEnabled);
          exactP2016(body,['client_command_id','expected_version','reason_code','note','external_visible']);
          if(body.external_visible!==false||typeof body.note!=='string'||body.note.trim().length===0||body.note.length>2000)failP2016();
        }
        exactP2016(body,['client_command_id','expected_version','reason_code','note','external_visible','target_principal_id','resolver_team_id'],
          ['client_command_id','expected_version','reason_code']);
        const result=await tickets.perform({authContext,internalNote:ticket[2]==='internal-notes',command:{...body,ticket_id:ticket[1],action:['notes','internal-notes'].includes(ticket[2]??'')?'add-note':ticket[2]==='transfer'?'transfer-assignment':ticket[2]}});
        json(response,status(result),result);return true;
      }
    }
    failP2016('NOT_FOUND',404);
  };
}
