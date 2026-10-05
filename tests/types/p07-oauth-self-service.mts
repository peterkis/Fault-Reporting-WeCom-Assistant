import type {OAuthState,BrowserToken,SessionToken,InternalReturnPath,InternalMemberId,OpenMemberId,OAuthMemberId,EnabledWeComOAuth} from '../../src/p2-g2-wecom-web-oauth.mjs';
import {readWeComResponse,createWeComOAuthCodeResolver} from '../../src/p2-g2-wecom-oauth-provider.mjs';
import {createWeComAppTokenProvider} from '../../src/p2-g2-wecom-app-token.mjs';
import {createWeComOAuthServer} from '../../src/p2-g2-wecom-oauth-server.mjs';
import {createYxxSelfServiceAuthorization} from '../../src/yxx-self-service-authorization.mjs';
import type {IncomingMessage} from 'node:http';
declare const oauth:EnabledWeComOAuth, state:OAuthState,browser:BrowserToken,session:SessionToken;
oauth.complete({state,browserToken:browser,code:'synthetic'});
// @ts-expect-error -- OAuth state cannot substitute for a browser binding.
oauth.complete({state,browserToken:state,code:'synthetic'});
// @ts-expect-error -- Browser binding cannot be used as a member session.
oauth.authenticate(browser);
// @ts-expect-error -- Member session cannot be used as one-time OAuth state.
oauth.complete({state:session,browserToken:browser,code:'synthetic'});
declare const rawPath:string;
// @ts-expect-error -- Return path becomes internal only after the existing path guard.
const internalPath:InternalReturnPath=rawPath;
declare const openId:OpenMemberId;
// @ts-expect-error -- Open namespace requires verified delegated conversion.
const internalId:InternalMemberId=openId;
declare const response:Response,signal:AbortSignal;
const raw=await readWeComResponse(response,signal);
// @ts-expect-error -- Provider JSON remains unknown before the provider guards.
raw.userid;
// @ts-expect-error -- Provider access tokens are not public raw response properties.
raw.access_token;
const provider=createWeComAppTokenProvider({corpId:'synthetic',appSecret:'synthetic'});
// @ts-expect-error -- Provider secret remains private to its closure.
provider.appSecret;
const resolved=await createWeComOAuthCodeResolver({accessTokenProvider:provider})('synthetic');
const memberId:OAuthMemberId=resolved.userid;
// @ts-expect-error -- App-scoped OAuth identity cannot be used as a canonical internal member before mapping.
const prematureInternal:InternalMemberId=resolved.userid;
// @ts-expect-error -- Successful identity has no raw provider error or ticket payload.
resolved.errmsg;
createWeComOAuthServer({oauth,publicOrigin:'https://synthetic.invalid',profile:'OAUTH_ONLY'});
// @ts-expect-error -- OAuth-only server cannot mount member handler capabilities.
createWeComOAuthServer({oauth,publicOrigin:'https://synthetic.invalid',profile:'OAUTH_ONLY',memberHandler:async()=>true});
// @ts-expect-error -- A member profile requires its controlled member handler.
createWeComOAuthServer({oauth,publicOrigin:'https://synthetic.invalid',profile:'MEMBER_SELF_SERVICE'});
declare const authenticate:(request:IncomingMessage)=>unknown;
createYxxSelfServiceAuthorization({authenticate,recheck:Object.assign(authenticate,{localOnly:true as const})});
// @ts-expect-error -- Recheck must explicitly promise local-only behavior after DB reads.
createYxxSelfServiceAuthorization({authenticate,recheck:authenticate});
// @ts-expect-error -- Provider-backed scope resolvers cannot run inside member reads.
createYxxSelfServiceAuthorization({authenticate,recheck:Object.assign(authenticate,{localOnly:true as const}),scopeResolver:Object.assign(authenticate,{localOnly:false as const})});
void [internalPath,internalId,memberId];

import {WeComOAuthError} from '../../src/p2-g2-wecom-web-oauth.mjs';
import type {YxxMemberScope,YxxMemberContext} from '../../src/yxx-self-service-authorization.mjs';
import type {YxxRequestInput,YxxSupplementInput,ParsedYxxCommand,YxxAcceptResult,YxxStoreRead} from '../../src/yxx-self-service-store.mjs';
import {decodeYxxReportCursor,encodeYxxReportCursor} from '../../src/yxx-self-service-query.mjs';
import type {YxxReportCursorPayload,YxxQueryInput} from '../../src/yxx-self-service-query.mjs';
import type {YxxVerifiedWriteContext,YxxHttpCommandInput} from '../../src/yxx-self-service-command.mjs';
import type {YxxSelfServiceExtensionOptions} from '../../src/yxx-self-service-runtime.mjs';
import type {YxxOrchestratorOptions} from '../../src/yxx-self-service-orchestrator.mjs';
import type {YxxProfileLifecycle,main} from '../../scripts/p2-g2-yixiaoxiu-serve.mjs';
declare const providerOutcome:typeof resolved | WeComOAuthError;
if(providerOutcome instanceof WeComOAuthError){
 const failedStatus:number=providerOutcome.status;
 // @ts-expect-error -- Provider failure cannot establish an internal member identity.
 providerOutcome.userid;
 void failedStatus;
}else{
 const authenticatedMember:OAuthMemberId=providerOutcome.userid;
 // @ts-expect-error -- A successful member projection has no provider error payload.
 providerOutcome.errmsg;
 void authenticatedMember;
}
declare const memberA:YxxMemberScope<'A'>,memberB:YxxMemberScope<'B'>;
// @ts-expect-error -- Member A scope cannot be substituted for Member B query parameters.
const memberBRead:YxxStoreRead<'B'>={scope:memberA};
declare const requestInput:YxxRequestInput,supplementInput:YxxSupplementInput;
const submit:ParsedYxxCommand={kind:'SUBMIT',input:requestInput};
const supplementCommand:ParsedYxxCommand={kind:'SUPPLEMENT',input:supplementInput,requestRef:'opaque'};
// @ts-expect-error -- Submit cannot accept a parsed supplement without its initial request fields.
const wrongSubmit:ParsedYxxCommand={kind:'SUBMIT',input:supplementInput};
// @ts-expect-error -- Revision is an exact positive integer string, never a JS number.
const wrongRevision:YxxSupplementInput={...supplementInput,expected_input_revision:1};
declare const receiptResult:YxxAcceptResult;
if(receiptResult.replayed){const replayed:true=receiptResult.replayed;void replayed;}
// @ts-expect-error -- Command conflicts are errors and cannot be successful ACCEPTED receipts.
const conflicting:YxxAcceptResult={replayed:false,receipt:{...receiptResult.receipt,status:'COMMAND_CONFLICT'}};
declare const cursorPayload:YxxReportCursorPayload<'A'>;
const memberACursor=encodeYxxReportCursor(cursorPayload,'synthetic-secret');
decodeYxxReportCursor(memberACursor,'synthetic-secret',memberA.scopeHash,'WEB',memberA.sourceCorpScope,memberA.sourceAppScope);
// @ts-expect-error -- An HMAC cursor can only be decoded with the original member scope.
decodeYxxReportCursor(memberACursor,'synthetic-secret',memberB.scopeHash,'WEB',memberB.sourceCorpScope,memberB.sourceAppScope);
declare const memberContext:YxxMemberContext;
// @ts-expect-error -- Member context requires generation, flags, scope and bot-owner fields.
const partialContext:YxxMemberContext={profile:'MEMBER_SELF_SERVICE',scope:memberA};
// @ts-expect-error -- WEB/BOT queries cannot accept arbitrary integration sources.
const externalSource:YxxQueryInput={request:{} as IncomingMessage,source:'EXTERNAL'};
declare const writeContext:YxxVerifiedWriteContext;
// @ts-expect-error -- A verified write must carry the CSRF string validated at the command boundary.
const noCsrf:YxxVerifiedWriteContext={...writeContext,csrf_token:null};
// @ts-expect-error -- Readonly member profile cannot acquire the verified write capability.
const readonlyWrite:YxxVerifiedWriteContext={...writeContext,profile:'MEMBER_TICKET_READONLY'};
// @ts-expect-error -- HTTP writes require the request carrying Origin, CSRF and idempotency headers.
const noRequest:YxxHttpCommandInput={input:requestInput};
declare const extensionOptions:YxxSelfServiceExtensionOptions;
// @ts-expect-error -- Self-service extension cannot be mounted in an OAuth-only runtime.
const oauthWrite:YxxSelfServiceExtensionOptions={...extensionOptions,profile:'OAUTH_ONLY'};
declare const ports:YxxOrchestratorOptions;
// @ts-expect-error -- Orchestrator uses the existing Ticket Core command port.
const secondCore:YxxOrchestratorOptions={...ports,ticketCore:{createAlternateTicket:async()=>null}};
// @ts-expect-error -- Decision port must retain both record and action marking capabilities.
const missingActionPort:YxxOrchestratorOptions={...ports,decisionStore:{record:(ports.decisionStore as NonNullable<YxxOrchestratorOptions['decisionStore']>).record}};
// @ts-expect-error -- Review port must provide the existing enqueue contract.
const missingReviewPort:YxxOrchestratorOptions={...ports,manualReviewStore:{}};
declare const profileLifecycle:YxxProfileLifecycle;
// @ts-expect-error -- P08 profile seam exposes only launcher lifecycle capabilities.
profileLifecycle.createTicket;
declare const checkResult:Awaited<ReturnType<typeof main>>;
// @ts-expect-error -- Serve/check launcher does not publicly return a database or provider capability.
checkResult.pool;
void [memberBRead,submit,supplementCommand,wrongSubmit,wrongRevision,conflicting,partialContext,externalSource,noCsrf,readonlyWrite,noRequest,oauthWrite,secondCore,missingActionPort,missingReviewPort,memberContext];

import type {YxxIdentityMapping} from '../../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
declare const verifiedMapping:YxxIdentityMapping;
const mappedInternal:InternalMemberId|null=verifiedMapping.resolve(resolved.userid);
// @ts-expect-error -- Canonical bot identity cannot masquerade as a delegated OAuth lookup key.
verifiedMapping.resolve(mappedInternal as InternalMemberId);
void [prematureInternal,mappedInternal];

import {validateYxxEntryConfig} from '../../src/p2-g2-yixiaoxiu-contract.mjs';
const disabledConfig=validateYxxEntryConfig({enabled:false,corpId:{unexpected:true}});
if(disabledConfig.enabled){const validatedCorp:string=disabledConfig.corpId;void validatedCorp;}
else{
 // @ts-expect-error -- Disabled configurations retain unchecked identity fields as unknown.
 const uncheckedCorp:string=disabledConfig.corpId;
 void uncheckedCorp;
}
