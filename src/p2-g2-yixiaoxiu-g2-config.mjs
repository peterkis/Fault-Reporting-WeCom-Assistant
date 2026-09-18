import {createHash} from 'node:crypto';
import {validateYxxEntryConfig,failYxx} from './p2-g2-yixiaoxiu-contract.mjs';

export const YXX_G2_ENV_KEYS=Object.freeze(['YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED','YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG_JSON',
  'WECOM_WEB_OAUTH_ENABLED','CORP_ID','APP_ID','APP_SECRET']);
export const YXX_SELF_SERVICE_ENV_KEYS=Object.freeze(['YIXIAOXIU_SELF_SERVICE_ENABLED','YIXIAOXIU_MY_REPORTS_ENABLED']);
export function readYxxSelfServiceFlags(env){
  for(const key of YXX_SELF_SERVICE_ENV_KEYS)if(![undefined,'false','true'].includes(env[key]))failYxx('CONFIG_INVALID');
  return Object.freeze(Object.fromEntries(YXX_SELF_SERVICE_ENV_KEYS.map(key=>[key,env[key]==='true'])));
}
export function yxxSelfServiceRoleEnvironment(role,env){
  if(!['APP','WORKER','GATEWAY'].includes(role))failYxx('CONFIG_INVALID');
  const flags=readYxxSelfServiceFlags(env);
  return role==='GATEWAY'?{}:Object.fromEntries(YXX_SELF_SERVICE_ENV_KEYS.map(key=>[key,String(flags[key])]));
}
export function readYxxG2AppConfiguration({manifest,env}){
  if(manifest.scope.reporter_access_policy!=='MEMBER_REQUIRED'){
    if(manifest.mode==='live')failYxx('CONFIG_INVALID');return null;
  }
  if(env.YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED!=='true'||env.WECOM_WEB_OAUTH_ENABLED!=='true')failYxx('CONFIG_INVALID');
  let config;try{config=validateYxxEntryConfig(JSON.parse(env.YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG_JSON));}catch{failYxx('CONFIG_INVALID');}
  if(!config.enabled||!['VERIFIED_SAME_NAMESPACE','VERIFIED_DELEGATED_MAPPING'].includes(config.identityMode))failYxx('IDENTITY_NAMESPACE_UNVERIFIED');
  if(config.botId!==env.WECOM_BOT_ID||config.corpId!==env.CORP_ID||config.agentId!==env.APP_ID
    ||typeof env.APP_SECRET!=='string'||!env.APP_SECRET||env.APP_SECRET.length>512
    ||manifest.mode==='live'&&(config.validationProfile!=='DEPLOYMENT'||config.proofKind!=='LIVE'))failYxx('CONFIG_INVALID');
  const hash=createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if(hash!==manifest.scope.member_entry_config_sha256)failYxx('CONFIG_INVALID');
  return config;
}
