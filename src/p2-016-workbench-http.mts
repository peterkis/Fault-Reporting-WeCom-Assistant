import type { IncomingMessage } from 'node:http';
import type { WorkbenchHttpOptions } from './p2-006-workbench-http.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { createP2016TicketCommandFacade } from './p2-016-ticket-command-facade.mjs';
import type { createP2016DeliveryControl } from './p2-016-delivery-control.mjs';
import type { LedgerResult, LedgerSuccess } from './p2-016-ticket-command-ledger.mjs';
type HttpContext = Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
interface ReviewPort { listManualReviews: (input: { authContext: unknown; status: string; priority: string | null; cursor: string | null; limit: string | null }) => Promise<unknown>; getManualReviewDetail: (input: { authContext: unknown; reviewId: string }) => Promise<unknown>; journey: (input: { authContext: unknown; journeyId: string; part: string | null }) => Promise<unknown>; resolveManualReview: (input: { authContext: unknown; reviewId: string; body: unknown }) => Promise<LedgerResult<LedgerSuccess>> }
interface HttpOptions { query: P2016TicketQuery; tickets: ReturnType<typeof createP2016TicketCommandFacade>; reviews: ReviewPort; deliveryControl: ReturnType<typeof createP2016DeliveryControl>; enabled?: boolean }

import { failP2016,guardP2016,exactP2016 } from './p2-016-domain-contracts.mjs';
function checkVersion(request: IncomingMessage,value: unknown) {
  const raw=request.headers['if-match'],text=typeof raw==='string'?raw.replace(/^W\//u,'').replace(/^"|"$/gu,''):'';
  if(!/^[1-9][0-9]{0,18}$/u.test(text)||text!==String(value))failP2016('VERSION_CONFLICT',409);
}
function queryKeys(url: URL,allowed: readonly string[]) {if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))failP2016();}
function status(result: LedgerResult<LedgerSuccess>) {return result.ok===false?/FORBIDDEN|PERMITTED/u.test(result.error.code)?403:/FAILED|UNAVAILABLE/u.test(result.error.code)?503:409:200;}
export function createP2016WorkbenchHttp({query,tickets,reviews,deliveryControl,enabled=false}: HttpOptions) {
  return async({request,response,url,authContext,readJson,validateWriteRequest,json}: HttpContext)=>{
    const matched=/^\/api\/(tickets(?:\/|$)|manual-reviews(?:\/|$)|contact-journeys(?:\/|$)|lifecycle\/bootstrap$)/u.test(url.pathname)
      ||/^\/api\/conversations\/[^/]+\/takeover-and-accept-ticket$/u.test(url.pathname);
    if(!matched)return false;guardP2016(enabled);
    if(request.method==='GET'){
      if(url.pathname==='/api/lifecycle/bootstrap'){queryKeys(url,[]);const principal=await query.principal(authContext);
        json(response,200,{principal_id:principal.principal_id,display_name:principal.display_name,csrf_token:authContext.auth_method==='COOKIE'?authContext.csrf_token:null,
          internal_beta:true,ai_enabled:false,roles:principal.roles,polling_interval_ms:5000});return true;}
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
      const ticket=/^\/api\/tickets\/([0-9a-f-]{36})\/(queue|accept|start|request-information|wait-vendor|resume|resolve|confirm|reopen|cancel|notes|transfer)$/iu.exec(url.pathname);
      if(ticket){checkVersion(request,body.expected_version);
        exactP2016(body,['client_command_id','expected_version','reason_code','note','external_visible','target_principal_id','resolver_team_id'],
          ['client_command_id','expected_version','reason_code']);
        const result=await tickets.perform({authContext,command:{...body,ticket_id:ticket[1],action:ticket[2]==='notes'?'add-note':ticket[2]==='transfer'?'transfer-assignment':ticket[2]}});
        json(response,status(result),result);return true;
      }
    }
    failP2016('NOT_FOUND',404);
  };
}
