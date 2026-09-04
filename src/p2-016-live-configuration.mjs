import { reporterCardLinkP2016 } from './p2-016-template-card-builder.mjs';
import { createP2016InboundScope } from './p2-016-inbound-scope.mjs';

export const P2016_LIVE_FUSES=Object.freeze(['P2_016_LIVE_TEST_APPROVED','P2_016_TEST_SCOPE_CONFIGURED','P2_016_REAL_WECOM_SEND_APPROVED']);
export const P2016_TEST_FLAGS=Object.freeze({TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const fail=()=>{throw new Error('P2_016_LIVE_CONFIGURATION_INVALID');};
const list=(env,key)=>typeof env[key]==='string'?env[key].split(',').map(x=>x.trim()).filter(Boolean):[];
// Returned configuration is private process memory. Only the separate check summary may be logged.
export function readP2016LiveConfiguration(env,{requireApproval=true}={}){
  if(requireApproval&&P2016_LIVE_FUSES.some(k=>env[k]!=='true'))throw new Error('P2_016_LIVE_APPROVAL_REQUIRED');
  // Even an unrelated enabled integration/AI flag fails closed; the test harness explicitly injects its narrow flags.
  if(Object.entries(env).some(([k,v])=>k.endsWith('_ENABLED')&&v!=='false'))throw new Error('P2_016_BASE_FLAGS_MUST_REMAIN_FALSE');
  const principalIds=list(env,'P2_016_TEST_PRINCIPAL_IDS');
  const allowedHosts=list(env,'P2_016_REPORTER_ALLOWED_HOSTS');
  const inboundScope={bot_id:env.WECOM_BOT_ID,person_hashes:list(env,'P2_016_TEST_USER_TARGET_HASHES'),group_hashes:list(env,'P2_016_TEST_GROUP_TARGET_HASHES')};
  const scope=createP2016InboundScope(inboundScope);
  const listenPort=Number(env.P2_016_LISTEN_PORT??'43116');
  if(principalIds.length<2||principalIds.length>4||new Set(principalIds).size!==principalIds.length||!principalIds.every(x=>uuid.test(x))
    ||!Number.isInteger(listenPort)||listenPort<1024||listenPort>65535
    ||typeof env.PILOT_DATABASE_URL!=='string'||!env.PILOT_DATABASE_URL
    ||typeof env.PILOT_LOG_IDENTITY_HASH_KEY!=='string'||env.PILOT_LOG_IDENTITY_HASH_KEY.length<16
    ||typeof env.WECOM_BOT_SECRET!=='string'||!env.WECOM_BOT_SECRET
    ||typeof env.WECOM_WS_URL!=='string'||!env.WECOM_WS_URL.startsWith('wss://')
    ||typeof env.P2_016_REPORTER_HMAC_SECRET!=='string'||Buffer.byteLength(env.P2_016_REPORTER_HMAC_SECRET)<32)fail();
  reporterCardLinkP2016({origin:env.P2_016_REPORTER_ORIGIN,allowedHosts,token:'A'.repeat(64)});
  return {databaseUrl:env.PILOT_DATABASE_URL,identityHashKey:env.PILOT_LOG_IDENTITY_HASH_KEY,principalIds,listenPort,testAuthTtlMs:65*60000,
    reporterOrigin:env.P2_016_REPORTER_ORIGIN,reporterHmacSecret:env.P2_016_REPORTER_HMAC_SECRET,allowedHosts,inboundScope,
    allowedTargetHashes:scope.allowed_target_hashes,botId:env.WECOM_BOT_ID,secret:env.WECOM_BOT_SECRET,wsUrl:env.WECOM_WS_URL};
}
