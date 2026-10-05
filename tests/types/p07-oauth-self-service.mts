import type {OAuthState,BrowserToken,SessionToken,InternalReturnPath,InternalMemberId,OpenMemberId,EnabledWeComOAuth} from '../../src/p2-g2-wecom-web-oauth.mjs';
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
const memberId:InternalMemberId=resolved.userid;
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
