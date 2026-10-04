import type { P2012LiveConfiguration } from './p2-012-live-configuration.mjs';
import { P2012_LIVE_FUSES } from './p2-012-live-configuration.mjs';
import { createP2G1ProcessCluster } from './p2-g1-process-cluster.mjs';

// Gate ownership stays with the live CLI. Tests use this same topology with both network switches false.
export function createP2012LiveCluster(configuration: Omit<P2012LiveConfiguration, 'reporterScopeMode'> & { reporterScopeMode?: P2012LiveConfiguration['reporterScopeMode'] },{gatewayEnabled=false,senderEnabled=false}={}){
  return createP2G1ProcessCluster({...configuration,gatewayEnabled,senderEnabled,
    roleScriptUrl:new URL('../scripts/p2-012-process-role.mjs',import.meta.url),
    roleEnvironment:role=>({
      ...Object.fromEntries(P2012_LIVE_FUSES.map(k=>[k,process.env[k]??'false'])),
      P2_012_REPORTER_ORIGIN:configuration.reporterOrigin,
      P2_012_REPORTER_ALLOWED_HOSTS:configuration.allowedHosts.join(','),
      P2_012_REPORTER_HMAC_SECRET:configuration.reporterHmacSecret,
      P2_012_SCOPE_BOT_ID:configuration.botId,
      P2_012_REPORTER_SCOPE_MODE:configuration.reporterScopeMode??'APPROVED_GROUP_PARTICIPANTS',
      P2_012_TEST_USER_TARGET_HASHES:configuration.inboundScope.person_hashes.join(','),
      P2_012_TEST_GROUP_TARGET_HASHES:configuration.inboundScope.group_hashes.join(','),
      ...(role==='WORKER'?{PILOT_LOG_IDENTITY_HASH_KEY:configuration.identityHashKey}:{}),
      ...(role==='GATEWAY'?{
        P2_012_LIVE_TEST_APPROVED:process.env.P2_012_LIVE_TEST_APPROVED??'false',
        P2_012_TEST_SCOPE_CONFIGURED:process.env.P2_012_TEST_SCOPE_CONFIGURED??'false',
        P2_012_REAL_WECOM_SEND_APPROVED:process.env.P2_012_REAL_WECOM_SEND_APPROVED??'false',
      }:{}),
    }),
  });
}
