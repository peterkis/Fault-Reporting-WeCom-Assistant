import {normalizeTakeoverCompletionCommand,createTicketTakeoverCompletionService} from './workbench-ticket-takeover-completion.mjs';
import {normalizeTicketTakeoverCommand} from './workbench-ticket-takeover.mjs';
import type {createTicketTakeoverService} from './workbench-ticket-takeover.mjs';
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
import type {createWorkbenchFollowUpSchedules} from './workbench-follow-up-schedules.mjs';
import {normalizeTicketAssignmentCommand} from './workbench-ticket-assignment.mjs';
import {createTicketUnassignService,normalizeTicketUnassignCommand} from './workbench-ticket-unassign.mjs';
import {createTicketReturnToDispatchService,normalizeReturnToDispatchCommand} from './workbench-ticket-return-to-dispatch.mjs';
import {createHash} from 'node:crypto';
import {RealtimeScopeUnavailable} from './p2-006-workbench-authorization.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {WaitingAction} from '../contracts/workbench_waiting_contracts.js';
type HttpContext = Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
interface HttpOptions {notificationExceptionsEnabled?:boolean;workbenchAssignmentHistoryEnabled?:boolean;ticketWaitingActionsEnabled?:boolean;workbenchPersonalReadEnabled?:boolean;workbenchFollowUpSchedulesEnabled?:boolean;followUpSchedules?:ReturnType<typeof createWorkbenchFollowUpSchedules>|null}
// Preserve the original HTTP port for existing consumers. The new dedicated ACK
// adapter is optional here and fail-closed; the real runtime facade always supplies it.
type TicketHttpPort=Pick<ReturnType<typeof createP2016TicketCommandFacade>,'perform'|'internalNoteReceipt'>&Partial<Pick<ReturnType<typeof createP2016TicketCommandFacade>,'reopenReceipt'|'waitingAcknowledgement'>>;
interface ReviewPort { manualReviewReceipt:(input:{authContext:unknown;reviewId:unknown;commandId:unknown})=>Promise<unknown>;listManualReviews: (input: { authContext: unknown; status: string; priority: string | null; cursor: string | null; limit: string | null }) => Promise<unknown>; getManualReviewDetail: (input: { authContext: unknown; reviewId: string }) => Promise<unknown>; journey: (input: { authContext: unknown; journeyId: string; part: string | null }) => Promise<unknown>; resolveManualReview: (input: { authContext: unknown; reviewId: string; body: unknown }) => Promise<LedgerResult<LedgerSuccess>> }
interface HttpOptions { ticketRoundNotificationsEnabled?:boolean;ticketReopenRoundsEnabled?:boolean;returnToDispatchAcknowledgement?:ReturnType<typeof createTicketReturnToDispatchService>['acknowledgement']|null;returnToDispatch?:ReturnType<typeof createTicketReturnToDispatchService>|null;unassign?:ReturnType<typeof createTicketUnassignService>|null;assignment?:ReturnType<typeof createTicketAssignmentService>|null;takeover?:ReturnType<typeof createTicketTakeoverService>|null;takeoverCompletion?:ReturnType<typeof createTicketTakeoverCompletionService>|null;workbenchManualReviewEnabled?:boolean;workbenchManualReportsEnabled?:boolean;workbenchReporterCandidatesEnabled?:boolean;workbenchRealtimeEnabled?:boolean;realtimeAuthorization?:(principal:WorkbenchPrincipal)=>Promise<unknown>;staffCompletion?:ReturnType<typeof createTicketStaffCompletionService>|null;conversationHandling?:ReturnType<typeof createTicketConversationHandlingService>|null;selfHandling?:ReturnType<typeof createTicketSelfHandlingService>|null; query: P2016TicketQuery; tickets: TicketHttpPort; reviews: ReviewPort; deliveryControl: ReturnType<typeof createP2016DeliveryControl>; enabled?: boolean;sourceGroupDirectoryEnabled?:boolean;workbenchInternalNotesEnabled?:boolean;workbenchDraftRecoveryEnabled?:boolean;workbenchConversationsEnabled?:boolean;incidentPublicProgressEnabled?:boolean;incidentPublicProgressDraftRecoveryEnabled?:boolean;incidentInternalNotesEnabled?:boolean;incidentInternalNoteDraftRecoveryEnabled?:boolean;incidentCandidateWorkspaceEnabled?:boolean;incidentCandidateDraftRecoveryEnabled?:boolean;logoutReady?:()=>boolean }

import { failP2016,guardP2016,exactP2016 } from './p2-016-domain-contracts.mjs';
function checkVersion(request: IncomingMessage,value: unknown) {
  const raw=request.headers['if-match'],text=typeof raw==='string'?raw.replace(/^W\//u,'').replace(/^"|"$/gu,''):'';
  if(!/^[1-9][0-9]{0,18}$/u.test(text)||text!==String(value))failP2016('VERSION_CONFLICT',409);
}
function queryKeys(url: URL,allowed: readonly string[]) {if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))failP2016();}
function status(result: LedgerResult<LedgerSuccess>) {return result.ok===false?result.error.code==='P2_016_NOT_FOUND'?404:/FORBIDDEN|PERMITTED|TARGET_INVALID/u.test(result.error.code)?403:/FAILED|UNAVAILABLE/u.test(result.error.code)?503:409:200;}
export function createP2016WorkbenchHttp({notificationExceptionsEnabled=false,workbenchAssignmentHistoryEnabled=false,query,tickets,reviews,deliveryControl,enabled=false,ticketWaitingActionsEnabled=false,workbenchPersonalReadEnabled=false,workbenchFollowUpSchedulesEnabled=false,followUpSchedules=null,ticketRoundNotificationsEnabled=false,ticketReopenRoundsEnabled=false,workbenchManualReviewEnabled=false,workbenchManualReportsEnabled=false,workbenchReporterCandidatesEnabled=false,sourceGroupDirectoryEnabled=false,workbenchInternalNotesEnabled=false,selfHandling=null,conversationHandling=null,takeover=null,takeoverCompletion=null,assignment=null,unassign=null,returnToDispatch=null,returnToDispatchAcknowledgement=null,staffCompletion=null,workbenchDraftRecoveryEnabled=false,workbenchConversationsEnabled=false,workbenchRealtimeEnabled=false,realtimeAuthorization,incidentPublicProgressEnabled=false,incidentPublicProgressDraftRecoveryEnabled=false,incidentInternalNotesEnabled=false,incidentInternalNoteDraftRecoveryEnabled=false,incidentCandidateWorkspaceEnabled=false,incidentCandidateDraftRecoveryEnabled=false,logoutReady=()=>false}: HttpOptions) {
  return async({request,response,url,authContext,readJson,validateWriteRequest,json}: HttpContext)=>{
    const matched=/^\/api\/(tickets(?:\/|$)|manual-reviews(?:\/|$)|contact-journeys(?:\/|$)|lifecycle\/bootstrap$)/u.test(url.pathname)
      ||/^\/api\/conversations\/[^/]+\/takeover-and-accept-ticket$/u.test(url.pathname);
    if(!matched)return false;guardP2016(enabled);
    if(request.method==='GET'){
      const waitingReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/(request-information|wait-vendor|resume|cancel)\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(waitingReceipt){if(!tickets.waitingAcknowledgement)failP2016('DISABLED',503);queryKeys(url,[]);json(response,200,await tickets.waitingAcknowledgement({authContext,ticketId:waitingReceipt[1],action:waitingReceipt[2]?.toLowerCase() as WaitingAction,commandId:waitingReceipt[3]}));return true;}
      const returnReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/return-to-dispatch\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(returnReceipt){if(!returnToDispatchAcknowledgement)failP2016('DISABLED',503);queryKeys(url,[]);json(response,200,await returnToDispatchAcknowledgement({authContext,ticketId:returnReceipt[1],commandId:returnReceipt[2]}));return true;}
      const takeoverReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/takeover\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(takeoverReceipt){if(!takeover)failP2016('DISABLED',503);guardP2016(workbenchDraftRecoveryEnabled);queryKeys(url,[]);json(response,200,await takeover.acknowledgement({authContext,ticketId:takeoverReceipt[1],commandId:takeoverReceipt[2]}));return true;}
      const completionTargets=/^\/api\/tickets\/([0-9a-f-]{36})\/takeover-completion-targets$/iu.exec(url.pathname);
      const takeoverCompletionReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/takeover-completion\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(takeoverCompletionReceipt){if(!takeoverCompletion)failP2016('DISABLED',503);guardP2016(workbenchDraftRecoveryEnabled);queryKeys(url,[]);json(response,200,await takeoverCompletion.acknowledgement({authContext,ticketId:takeoverCompletionReceipt[1],commandId:takeoverCompletionReceipt[2]}));return true;}
      if(completionTargets){if(!takeoverCompletion)failP2016('DISABLED',503);queryKeys(url,['resolver_team_id']);if(url.searchParams.getAll('resolver_team_id').length>1)failP2016();json(response,200,await takeoverCompletion.targets({authContext,ticketId:completionTargets[1],resolverTeamId:url.searchParams.get('resolver_team_id')}));return true;}
      const takeoverTargets=/^\/api\/tickets\/([0-9a-f-]{36})\/takeover-targets$/iu.exec(url.pathname);
      if(takeoverTargets){if(!takeover)failP2016('DISABLED',503);queryKeys(url,['resolver_team_id']);json(response,200,await takeover.targets({authContext,ticketId:takeoverTargets[1],resolverTeamId:url.searchParams.get('resolver_team_id')}));return true;}
      const followUpReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/follow-up-schedule\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(followUpReceipt){if(!followUpSchedules)failP2016('DISABLED',503);queryKeys(url,[]);json(response,200,await followUpSchedules.acknowledgement({authContext,ticketId:followUpReceipt[1],commandId:followUpReceipt[2]}));return true;}
      const followUpView=/^\/api\/tickets\/([0-9a-f-]{36})\/follow-up-schedule$/iu.exec(url.pathname);
      if(followUpView){if(!followUpSchedules)failP2016('DISABLED',503);queryKeys(url,[]);json(response,200,await followUpSchedules.view({authContext,ticketId:followUpView[1]}));return true;}
      const reopenReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/reopen\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(reopenReceipt){if(!tickets.reopenReceipt)failP2016('DISABLED',503);queryKeys(url,[]);json(response,200,await tickets.reopenReceipt({authContext,ticketId:reopenReceipt[1],commandId:reopenReceipt[2]}));return true;}
      const unassignTargets=/^\/api\/tickets\/([0-9a-f-]{36})\/unassign\/communication-targets$/iu.exec(url.pathname);
      if(unassignTargets){if(!unassign)failP2016('DISABLED',503);queryKeys(url,['target_principal_id']);json(response,200,await unassign.communicationTargets({authContext,ticketId:unassignTargets[1],targetPrincipalId:url.searchParams.get('target_principal_id')}));return true;}
      const unassignReceipt=/^\/api\/tickets\/([0-9a-f-]{36})\/unassign\/commands\/([0-9a-f-]{36})$/iu.exec(url.pathname);
      if(unassignReceipt){if(!unassign)failP2016('DISABLED',503);queryKeys(url,[]);json(response,200,await unassign.acknowledgement({authContext,ticketId:unassignReceipt[1],commandId:unassignReceipt[2]}));return true;}
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
        json(response,200,{notification_exceptions_enabled:notificationExceptionsEnabled,principal_id:principal.principal_id,display_name:principal.display_name,csrf_token:authContext.auth_method==='COOKIE'?authContext.csrf_token:null,
          realtime_sse_enabled:realtimeEnabled,realtime_sse_available:realtimeAvailable,sse_endpoint:realtimeEnabled?'/api/realtime/events?scope=workbench':null,expires_epoch_ms:authContext.expires_epoch_ms,
          authorization_revision:realtimeEnabled?createHash('sha256').update(JSON.stringify([principal.principal_id,principal.roles,principal.team_ids])).digest('hex'):null,
          internal_beta:true,ai_enabled:false,ticket_waiting_actions_enabled:ticketWaitingActionsEnabled,ticket_waiting_action_draft_recovery_enabled:ticketWaitingActionsEnabled&&workbenchDraftRecoveryEnabled,assignment_history_enabled:workbenchAssignmentHistoryEnabled,personal_read_enabled:workbenchPersonalReadEnabled,follow_up_schedules_enabled:workbenchFollowUpSchedulesEnabled,follow_up_schedule_receipt_enabled:followUpSchedules!==null,follow_up_schedule_draft_recovery_enabled:workbenchFollowUpSchedulesEnabled&&workbenchDraftRecoveryEnabled,manual_reports_enabled:workbenchManualReportsEnabled,reporter_candidates_enabled:workbenchManualReportsEnabled&&workbenchReporterCandidatesEnabled,manual_report_draft_recovery_enabled:workbenchManualReportsEnabled&&workbenchDraftRecoveryEnabled,manual_review_enabled:workbenchManualReviewEnabled,manual_review_draft_recovery_enabled:workbenchManualReviewEnabled&&workbenchDraftRecoveryEnabled,roles:principal.roles,polling_interval_ms:5000,source_group_directory_enabled:sourceGroupDirectoryEnabled,internal_notes_enabled:workbenchInternalNotesEnabled,ticket_return_to_dispatch_enabled:returnToDispatch!==null,ticket_return_to_dispatch_draft_recovery_enabled:returnToDispatch!==null&&workbenchDraftRecoveryEnabled,ticket_unassign_enabled:unassign!==null,ticket_unassign_draft_recovery_enabled:unassign!==null&&workbenchDraftRecoveryEnabled,ticket_assignment_enabled:assignment!==null,ticket_assignment_draft_recovery_enabled:assignment!==null&&workbenchDraftRecoveryEnabled,ticket_takeover_completion_enabled:takeoverCompletion!==null,ticket_takeover_completion_draft_recovery_enabled:takeoverCompletion!==null&&workbenchDraftRecoveryEnabled,ticket_takeover_enabled:takeover!==null,ticket_takeover_draft_recovery_enabled:takeover!==null&&workbenchDraftRecoveryEnabled,ticket_self_handling_enabled:selfHandling!==null,ticket_round_notifications_enabled:ticketRoundNotificationsEnabled,ticket_reopen_rounds_enabled:ticketReopenRoundsEnabled,ticket_reopen_draft_recovery_enabled:ticketReopenRoundsEnabled&&workbenchDraftRecoveryEnabled,ticket_staff_completion_enabled:staffCompletion!==null,ticket_conversation_self_handling_enabled:conversationHandling!==null,ticket_conversation_draft_recovery_enabled:conversationHandling!==null&&workbenchDraftRecoveryEnabled,draft_recovery_enabled:workbenchInternalNotesEnabled&&workbenchDraftRecoveryEnabled,staff_completion_draft_recovery_enabled:staffCompletion!==null&&workbenchDraftRecoveryEnabled,conversation_workspace_enabled:enabled&&workbenchConversationsEnabled,conversation_draft_recovery_enabled:enabled&&workbenchConversationsEnabled&&workbenchDraftRecoveryEnabled,incident_public_progress_enabled:incidentPublicProgressEnabled,incident_public_progress_draft_recovery_enabled:incidentPublicProgressDraftRecoveryEnabled,incident_internal_notes_enabled:incidentInternalNotesEnabled,incident_internal_note_draft_recovery_enabled:incidentInternalNoteDraftRecoveryEnabled,incident_candidate_workspace_enabled:incidentCandidateWorkspaceEnabled,incident_candidate_draft_recovery_enabled:incidentCandidateDraftRecoveryEnabled,logout_enabled:logoutReady()&&authContext.auth_method==='COOKIE'&&typeof authContext.csrf_token==='string'&&authContext.csrf_token.length>0});return true;}
      const history=/^\/api\/tickets\/([0-9a-f-]{36})\/assignment-history$/iu.exec(url.pathname);
      if(history){guardP2016(workbenchAssignmentHistoryEnabled);queryKeys(url,['cursor','limit']);if(['cursor','limit'].some(key=>url.searchParams.getAll(key).length>1))failP2016();json(response,200,await query.assignmentHistory({authContext,ticketId:history[1],cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;}
      const related=/^\/api\/tickets\/([0-9a-f-]{36})\/related-conversations$/iu.exec(url.pathname);
      const assignmentTargets=/^\/api\/tickets\/([0-9a-f-]{36})\/assignment-targets$/iu.exec(url.pathname);
      if(assignmentTargets){if(!assignment)failP2016('DISABLED',503);queryKeys(url,['resolver_team_id','target_principal_id']);json(response,200,await query.assignmentTargets({authContext,ticketId:assignmentTargets[1],resolverTeamId:url.searchParams.get('resolver_team_id'),targetPrincipalId:url.searchParams.get('target_principal_id')}));return true;}
      if(related){if(!conversationHandling&&!assignment&&!takeover&&!takeoverCompletion&&!unassign&&!returnToDispatch)failP2016('DISABLED',503);queryKeys(url,['cursor','limit']);json(response,200,await query.relatedConversations({authContext,ticketId:related[1],cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')}));return true;}
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
      const followUpCommand=/^\/api\/tickets\/([0-9a-f-]{36})\/follow-up-schedule$/iu.exec(url.pathname);
      if(followUpCommand){if(!followUpSchedules)failP2016('DISABLED',503);checkVersion(request,body.expected_version);const result=await followUpSchedules.perform({authContext,ticketId:followUpCommand[1],input:body});json(response,status(result),result);return true;}
      const takeoverCompletionRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/takeover-and-complete$/iu.exec(url.pathname);
      if(takeoverCompletionRoute){if(!takeoverCompletion)failP2016('DISABLED',503);exactP2016(body,['client_command_id','expected_version','reason_code','resolver_team_id','handling_cycle_id','communication_choice','sessions','internal_process','external_summary','external_summary_confirmed']);const command=normalizeTakeoverCompletionCommand({...body,action:'takeover-and-complete',ticket_id:takeoverCompletionRoute[1]});if(request.headers['if-match']!=='"'+command.expected_version+'"')failP2016('VERSION_CONFLICT',409);const result=await takeoverCompletion.perform({authContext,command});json(response,status(result),result);return true;}
      const takeoverRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/(takeover|takeover-and-start)$/iu.exec(url.pathname);
      if(takeoverRoute){if(!takeover)failP2016('DISABLED',503);exactP2016(body,['client_command_id','expected_version','reason_code','resolver_team_id','communication_choice','sessions']);const command=normalizeTicketTakeoverCommand({...body,action:takeoverRoute[2],ticket_id:takeoverRoute[1]});checkVersion(request,command.expected_version);const result=await takeover.perform({authContext,command});json(response,status(result),result);return true;}
      const assignmentRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/(assign|transfer-assignment)$/iu.exec(url.pathname);
      const returnRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/return-to-dispatch$/iu.exec(url.pathname);
      if(returnRoute){if(!returnToDispatch)failP2016('DISABLED',503);exactP2016(body,['client_command_id','expected_version','reason_code','reason','unfinished_work','communication_choice','communication_target_principal_id','sessions']);const command=normalizeReturnToDispatchCommand({...body,action:'return-to-dispatch',ticket_id:returnRoute[1]});checkVersion(request,command.expected_version);const result=await returnToDispatch.perform({authContext,command});json(response,status(result),result);return true;}
      const unassignRoute=/^\/api\/tickets\/([0-9a-f-]{36})\/unassign$/iu.exec(url.pathname);
      if(unassignRoute){if(!unassign)failP2016('DISABLED',503);exactP2016(body,['client_command_id','expected_version','reason_code','reason','communication_choice','communication_target_principal_id','sessions']);const command=normalizeTicketUnassignCommand({...body,action:'unassign',ticket_id:unassignRoute[1]});checkVersion(request,command.expected_version);const result=await unassign.perform({authContext,command});json(response,status(result),result);return true;}
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
        if(ticketWaitingActionsEnabled&&['request-information','wait-vendor','resume','cancel'].includes(ticket[2]??'')){
          exactP2016(body,['client_command_id','expected_version','reason_code','note','external_visible']);
          if(body.external_visible!==false||typeof body.note!=='string'||!body.note.trim()||body.note.length>2000)failP2016();
        }
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
