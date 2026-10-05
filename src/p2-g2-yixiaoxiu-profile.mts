import type {WeComOAuthServerOptions} from './p2-g2-wecom-oauth-server.mjs';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {WeComOAuth} from './p2-g2-wecom-web-oauth.mjs';
import type {YxxMemberExtensionOptions} from './p2-g2-yixiaoxiu-server.mjs';
import type {YxxSelfServiceExtensionOptions} from './yxx-self-service-runtime.mjs';
import type {P2012RuntimeOptions} from './p2-012-workbench-assembly.mjs';
type MemberProfileOptions = YxxMemberExtensionOptions & {listenPort?:number;yxxSelfService?:{featureFlags?:YxxSelfServiceExtensionOptions['featureFlags'];pollMilliseconds?:number|undefined}};
export type OAuthOnlyProfileOptions = {profile?:'OAUTH_ONLY';listenPort?:number;oauth:WeComOAuth;publicOrigin:string|undefined;pool?:MemberProfileOptions['pool']|undefined;reporterMemberEntry?:unknown;identityMapping?:MemberProfileOptions['identityMapping'];reporterHmacSecret?:string|undefined;yxxSelfService?:MemberProfileOptions['yxxSelfService']};
export type ReadonlyProfileOptions = MemberProfileOptions & {profile:'MEMBER_TICKET_READONLY'};
export type SelfServiceProfileOptions = MemberProfileOptions & Pick<YxxSelfServiceExtensionOptions,'ruleEngine'|'serviceCatalog'> & {profile:'MEMBER_SELF_SERVICE'};
export type FullServiceProfileOptions = P2012RuntimeOptions & {profile:'FULL_SERVICE_LOOP';listenPort?:number;reporterPolicy:'MEMBER_REQUIRED'};
export type YxxProfileOptions = OAuthOnlyProfileOptions|ReadonlyProfileOptions|SelfServiceProfileOptions|FullServiceProfileOptions;
type HttpProfile<Name extends string,SelfService> = {server:Server;selfService:SelfService;start():Promise<{profile:Name;port:number}>;stop():Promise<void>};
export type YxxProfileLifecycle = {start():Promise<unknown>;stop():Promise<unknown>};
import {once} from 'node:events';
import {createWeComOAuthServer} from './p2-g2-wecom-oauth-server.mjs';
import {createYxxReadonlyServer} from './p2-g2-yixiaoxiu-server.mjs';
import {createP2012Runtime} from './p2-012-workbench-assembly.mjs';
import {failYxx} from './p2-g2-yixiaoxiu-contract.mjs';
import {createYxxMemberExtension} from './p2-g2-yixiaoxiu-server.mjs';
import {createYxxSelfServiceExtension} from './yxx-self-service-runtime.mjs';

// The caller owns credentials and any supplied pool. Profile selection never opens another role.
export function createYxxProfile(options:OAuthOnlyProfileOptions): HttpProfile<'OAUTH_ONLY',null>;
export function createYxxProfile(options:ReadonlyProfileOptions): HttpProfile<'MEMBER_TICKET_READONLY',null>;
export function createYxxProfile(options:SelfServiceProfileOptions): HttpProfile<'MEMBER_SELF_SERVICE',ReturnType<typeof createYxxSelfServiceExtension>>;
export function createYxxProfile(options:FullServiceProfileOptions): ReturnType<typeof createP2012Runtime>;
export function createYxxProfile(options:YxxProfileOptions): YxxProfileLifecycle;
export function createYxxProfile({profile='OAUTH_ONLY',listenPort=0,...options}:YxxProfileOptions){
  if(!['OAUTH_ONLY','MEMBER_TICKET_READONLY','MEMBER_SELF_SERVICE','FULL_SERVICE_LOOP'].includes(profile)
    ||!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)failYxx('CONFIG_INVALID');
  if(profile==='FULL_SERVICE_LOOP'){
    if((options as Partial<FullServiceProfileOptions>).reporterPolicy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
    return createP2012Runtime({...options,listenPort} as P2012RuntimeOptions);
  }
  let selfService:ReturnType<typeof createYxxSelfServiceExtension>|null=null,member:ReturnType<typeof createYxxMemberExtension>|null=null;
  if(profile==='MEMBER_SELF_SERVICE'){
    selfService=createYxxSelfServiceExtension({...options,profile,featureFlags:(options as MemberProfileOptions).yxxSelfService?.featureFlags??{},pollMilliseconds:(options as MemberProfileOptions).yxxSelfService?.pollMilliseconds} as YxxSelfServiceExtensionOptions);
    member=createYxxMemberExtension(options as YxxMemberExtensionOptions);
  }
  const server=selfService?createWeComOAuthServer({oauth:(options as MemberProfileOptions).oauth,publicOrigin:(options as MemberProfileOptions).publicOrigin,profile,
    memberHandler:async context=>(await selfService.handler(context))||(member as NonNullable<typeof member>).handler(context)} as WeComOAuthServerOptions):
    profile==='OAUTH_ONLY'?createWeComOAuthServer({oauth:(options as MemberProfileOptions).oauth,publicOrigin:(options as MemberProfileOptions).publicOrigin}):createYxxReadonlyServer(options as YxxMemberExtensionOptions);
  let started=false,stopping:Promise<void>|undefined;
  return Object.freeze({server,selfService,
    async start(){if(started||stopping)failYxx('UNAVAILABLE');started=true;server.listen(listenPort,'127.0.0.1');await once(server,'listening');selfService?.start();return {profile,port:(server.address() as AddressInfo).port};},
    stop(){return stopping??=(async()=>{await selfService?.close();member?.close();((options as MemberProfileOptions).oauth as {close?:()=>void}).close?.();if(!server.listening)return;
      await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});})();},
  });
}
