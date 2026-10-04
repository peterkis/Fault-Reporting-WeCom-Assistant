import type { P2016LiveConfiguration } from './p2-016-live-configuration.mjs';
import type { G1ClusterConfiguration } from './p2-g1-process-cluster.mjs';
export interface P2016LiveClusterConfiguration extends Omit<G1ClusterConfiguration, 'gatewayEnabled' | 'senderEnabled'> { reporterOrigin: string; reporterHmacSecret: string; allowedHosts: readonly string[]; inboundScope: Pick<P2016LiveConfiguration['inboundScope'], 'person_hashes' | 'group_hashes'> }
import { createP2G1ProcessCluster } from './p2-g1-process-cluster.mjs';

// Gate ownership stays with the live CLI. Tests use this same topology with both network switches false.
export function createP2016LiveCluster(configuration: P2016LiveClusterConfiguration,{gatewayEnabled=false,senderEnabled=false}={}){
  return createP2G1ProcessCluster({...configuration,gatewayEnabled,senderEnabled,
    roleScriptUrl:new URL('../scripts/p2-016-process-role.mjs',import.meta.url),
    roleEnvironment:role=>({
      P2_016_REPORTER_ORIGIN:configuration.reporterOrigin,
      P2_016_REPORTER_ALLOWED_HOSTS:configuration.allowedHosts.join(','),
      P2_016_REPORTER_HMAC_SECRET:configuration.reporterHmacSecret,
      ...(role==='WORKER'?{PILOT_LOG_IDENTITY_HASH_KEY:configuration.identityHashKey}:{}),
      ...(role==='GATEWAY'?{
        P2_016_LIVE_TEST_APPROVED:process.env.P2_016_LIVE_TEST_APPROVED??'false',
        P2_016_TEST_SCOPE_CONFIGURED:process.env.P2_016_TEST_SCOPE_CONFIGURED??'false',
        P2_016_REAL_WECOM_SEND_APPROVED:process.env.P2_016_REAL_WECOM_SEND_APPROVED??'false',
        P2_016_TEST_USER_TARGET_HASHES:configuration.inboundScope.person_hashes.join(','),
        P2_016_TEST_GROUP_TARGET_HASHES:configuration.inboundScope.group_hashes.join(','),
      }:{}),
    }),
  });
}
