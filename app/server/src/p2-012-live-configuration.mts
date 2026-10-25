import type { P2016LiveConfiguration } from './p2-016-live-configuration.mjs';
export type P2012LiveConfiguration = Omit<P2016LiveConfiguration, 'inboundScope'> & { reporterScopeMode: 'APPROVED_GROUP_PARTICIPANTS'; inboundScope: { bot_id: string; person_hashes: readonly string[]; group_hashes: readonly string[] } };
export interface P2012LiveCheckSummary { task: 'P2-012'; check_only: true; ok: boolean; approvals: Record<string, boolean>; network_started: false; listener_started: false; provider_calls: 0 }
import { readP2016LiveConfiguration } from './p2-016-live-configuration.mjs';
export const P2012_LIVE_FUSES=Object.freeze(['P2_012_LIVE_TEST_APPROVED','P2_012_TEST_SCOPE_CONFIGURED','P2_012_REAL_WECOM_SEND_APPROVED','P2_012_INCIDENT_PUBLIC_NOTICE_APPROVED','P2_012_INCIDENT_PRIVATE_NOTICE_APPROVED']);
export const P2012_TEST_FLAGS=Object.freeze({INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true});
export const P2012_REPORTER_SCOPE_MODE='APPROVED_GROUP_PARTICIPANTS';
const HASH=/^[a-f0-9]{64}$/u;
const SENTINEL='0'.repeat(64);
const list=(env: NodeJS.ProcessEnv,key: string)=>typeof env[key]==='string'?(env[key] as string).split(',').map(x=>x.trim()).filter(Boolean):[];
// Reuse the frozen identity/scope/HTTPS validation, without granting a previous task's approval.
export function readP2012LiveConfiguration(env: NodeJS.ProcessEnv,{requireApproval=true}={}): P2012LiveConfiguration{
  if(requireApproval&&P2012_LIVE_FUSES.some(k=>env[k]!=='true'))throw new Error('P2_012_LIVE_APPROVAL_REQUIRED');
  if(env.P2_012_REPORTER_SCOPE_MODE!==P2012_REPORTER_SCOPE_MODE)throw new Error('P2_012_LIVE_CONFIGURATION_INVALID');
  const personHashes=list(env,'P2_012_TEST_USER_TARGET_HASHES');
  if(personHashes.length>20||new Set(personHashes).size!==personHashes.length||personHashes.some(value=>!HASH.test(value)))throw new Error('P2_012_LIVE_CONFIGURATION_INVALID');
  const mapped={...env};
  for(const key of ['TEST_PRINCIPAL_IDS','TEST_USER_TARGET_HASHES','TEST_GROUP_TARGET_HASHES','REPORTER_ORIGIN','REPORTER_ALLOWED_HOSTS','REPORTER_HMAC_SECRET','LISTEN_PORT'])mapped['P2_016_'+key]=env['P2_012_'+key];
  mapped.P2_016_TEST_USER_TARGET_HASHES=personHashes.length?personHashes.join(','):SENTINEL;
  mapped.P2_016_LISTEN_PORT??='43112';
  try{
    const base=readP2016LiveConfiguration(mapped,{requireApproval:false});
    const inboundScope=Object.freeze({...base.inboundScope,person_hashes:Object.freeze(personHashes)});
    return Object.freeze({...base,reporterScopeMode:P2012_REPORTER_SCOPE_MODE,inboundScope,
      allowedTargetHashes:Object.freeze([...new Set([...personHashes,...inboundScope.group_hashes])])});
  }catch{throw new Error('P2_012_LIVE_CONFIGURATION_INVALID');}
}
