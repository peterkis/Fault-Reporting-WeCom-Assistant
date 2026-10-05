import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {YxxEntryConfig,YxxProfile} from '../src/p2-g2-yixiaoxiu-contract.mjs';
export interface YxxProfileLifecycle {start():Promise<unknown>;stop():Promise<unknown>}
// P08 profile factory is consumed only for the lifecycle used by this launcher.
type ProfileFactoryInput = {profile:YxxProfile;pool:PostgresPool|undefined;oauth:ReturnType<typeof createWeComWebOAuth>;publicOrigin:string|undefined;listenPort:number;reporterMemberEntry:YxxEntryConfig|undefined;identityMapping:Awaited<ReturnType<typeof createYxxDelegatedIdentityMapping>>|null;reporterHmacSecret:string|undefined;yxxSelfService:{featureFlags:Record<string,boolean>}};
type ProfileFactory = (options:ProfileFactoryInput)=>YxxProfileLifecycle;
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createWeComAppTokenProvider} from '../src/p2-g2-wecom-app-token.mjs';
import {createWeComOAuthCodeResolver} from '../src/p2-g2-wecom-oauth-provider.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {validateYxxEntryConfig,failYxx} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {readYxxSelfServiceFlags} from '../src/p2-g2-yixiaoxiu-g2-config.mjs';

export async function main(argv:string[]=process.argv.slice(2),env:NodeJS.ProcessEnv=process.env){
  if(argv.length===1&&argv[0]==='--help'){
    console.log('Usage: node scripts/p2-g2-yixiaoxiu-serve.mjs --check|--serve\nYIXIAOXIU_RUNTIME_PROFILE=OAUTH_ONLY|MEMBER_TICKET_READONLY|MEMBER_SELF_SERVICE; full App uses the existing separately approved G2 process runner. Check never connects to DB or Provider.');return;
  }
  if(argv.length!==1||!['--check','--serve'].includes(argv[0] as string))failYxx('CONFIG_INVALID');
  const profile=env.YIXIAOXIU_RUNTIME_PROFILE??'OAUTH_ONLY',publicOrigin=env.WECOM_WEB_OAUTH_ORIGIN;
  if(!['OAUTH_ONLY','MEMBER_TICKET_READONLY','MEMBER_SELF_SERVICE'].includes(profile)||!['true','false',undefined].includes(env.WECOM_WEB_OAUTH_ENABLED)
    ||!['true','false',undefined].includes(env.YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED))failYxx('CONFIG_INVALID');
  const enabled=env.WECOM_WEB_OAUTH_ENABLED==='true',listenPort=Number(env.WECOM_WEB_OAUTH_PORT??43123);
  if(!Number.isInteger(listenPort)||listenPort<1024||listenPort>65535)failYxx('CONFIG_INVALID');
  const featureFlags=readYxxSelfServiceFlags(env);
  let reporterMemberEntry:YxxEntryConfig|undefined;
  if(profile!=='OAUTH_ONLY'){
    if(!enabled||env.YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED!=='true')failYxx('CONFIG_INVALID');
    const data: {reporterMemberEntry?:unknown}=JSON.parse(readFileSync(env.YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG as string,'utf8'));
    reporterMemberEntry=validateYxxEntryConfig(data.reporterMemberEntry);
    if(!reporterMemberEntry.enabled||reporterMemberEntry.validationProfile!=='DEPLOYMENT'
      ||reporterMemberEntry.corpId!==env.CORP_ID||reporterMemberEntry.agentId!==env.APP_ID)failYxx('CONFIG_INVALID');
    if(!['VERIFIED_SAME_NAMESPACE','VERIFIED_DELEGATED_MAPPING'].includes(reporterMemberEntry.identityMode))failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
    if(profile==='MEMBER_SELF_SERVICE'&&reporterMemberEntry.identityMode!=='VERIFIED_DELEGATED_MAPPING')failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
    let database;try{database=new URL(env.PILOT_DATABASE_URL as string);}catch{failYxx('CONFIG_INVALID');}
    if(!['postgres:','postgresql:'].includes(database.protocol)||!database.pathname||database.pathname==='/'
      ||typeof env.P2_G2_REPORTER_HMAC_SECRET!=='string'||Buffer.byteLength(env.P2_G2_REPORTER_HMAC_SECRET)<32)failYxx('CONFIG_INVALID');
  }
  const accessTokenProvider=enabled?createWeComAppTokenProvider({corpId:env.CORP_ID,appSecret:env.APP_SECRET}):null;
  const oauth=createWeComWebOAuth({enabled,publicOrigin,corpId:env.CORP_ID,agentId:env.APP_ID,
    ...(enabled?{resolveCode:createWeComOAuthCodeResolver({accessTokenProvider:accessTokenProvider as NonNullable<typeof accessTokenProvider>})}:{})});
  if(argv[0]==='--check'){
    new URL(publicOrigin as string);(oauth as {close?:()=>void}).close?.();console.log(JSON.stringify({ok:true,profile,configured:true,database_connections:0,provider_calls:0,listener_started:false,live_authorized:false}));return;
  }
  let pool:PostgresPool|undefined,runtime:YxxProfileLifecycle|undefined;
  try{
    const identityMapping=reporterMemberEntry?.identityMode==='VERIFIED_DELEGATED_MAPPING'
      ?await createYxxDelegatedIdentityMapping({config:reporterMemberEntry,accessTokenProvider:accessTokenProvider as NonNullable<typeof accessTokenProvider>}):null;
    if(profile!=='OAUTH_ONLY'){
      const {createPostgresPool}=await import('../src/platform/postgres-pool.mjs');
      pool=createPostgresPool({connectionString:env.PILOT_DATABASE_URL,max:4,connectionTimeoutMillis:2000,application_name:'yixiaoxiu_member_readonly'});
    }
    runtime=(createYxxProfile as ProfileFactory)({profile:profile as YxxProfile,pool,oauth,publicOrigin,listenPort,reporterMemberEntry,identityMapping,reporterHmacSecret:env.P2_G2_REPORTER_HMAC_SECRET,yxxSelfService:{featureFlags}});
    await runtime.start();console.log(JSON.stringify({event:'YXX_ENTRY_LISTENING',profile}));
    let stopping:Promise<void>|undefined;const stop=()=>stopping??=(async()=>{await (runtime as YxxProfileLifecycle).stop();await pool?.end();})();
    process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
  }catch(error){(oauth as {close?:()=>void}).close?.();await runtime?.stop();await pool?.end();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(error=>{
  console.error(/^YXX_ENTRY_[A-Z_]+$/u.test((error as {code?:string}|null)?.code??'')?(error as {code:string}).code:'YXX_ENTRY_CONFIG_INVALID');process.exitCode=1;
});
