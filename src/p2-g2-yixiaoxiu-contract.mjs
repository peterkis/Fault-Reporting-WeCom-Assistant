import {exactP2016,publicP2016} from './p2-016-domain-contracts.mjs';

export const YXX_ERROR_STATUS=Object.freeze({CONFIG_INVALID:503,DISABLED:503,IDENTITY_NAMESPACE_UNVERIFIED:503,
  AUTH_REQUIRED:401,MEMBER_REQUIRED:403,NOT_FOUND:404,INPUT_INVALID:400,ORIGIN_INVALID:403,
  LEGACY_EXCHANGE_DISABLED:403,UNAVAILABLE:503,BUSY:503});
export class YxxEntryError extends Error {
  constructor(code){
    const selected=Object.hasOwn(YXX_ERROR_STATUS,code)?code:'UNAVAILABLE';
    super('YXX_ENTRY_'+selected);this.code=this.message;this.status=YXX_ERROR_STATUS[selected];
  }
}
export const failYxx=code=>{throw new YxxEntryError(code);};
export function exactYxx(value,keys,required=keys){try{return exactP2016(value,keys,required);}catch{failYxx('INPUT_INVALID');}}
export function publicRefYxx(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(value))failYxx('INPUT_INVALID');return value;}
export function reporterAccessPolicy(value='LEGACY_BOUND_GRANT'){
  if(!['LEGACY_BOUND_GRANT','MEMBER_REQUIRED'].includes(value))failYxx('CONFIG_INVALID');return value;
}
export function validateYxxEntryConfig(value={}){
  let c;try{c=exactP2016(value,['enabled','identityMode','memberIdsConfirmed','proofRef','proofKind','corpId','agentId','botId','validationProfile','reporterUserIds'],[]);}catch{failYxx('CONFIG_INVALID');}
  c={enabled:false,identityMode:'UNVERIFIED',memberIdsConfirmed:false,proofRef:null,proofKind:null,
    corpId:null,agentId:null,botId:null,validationProfile:'DEPLOYMENT',...c};
  if(typeof c.enabled!=='boolean'||typeof c.memberIdsConfirmed!=='boolean'
    ||!['UNVERIFIED','VERIFIED_SAME_NAMESPACE','VERIFIED_DELEGATED_MAPPING'].includes(c.identityMode)
    ||!['DEPLOYMENT','ISOLATED_TEST'].includes(c.validationProfile))failYxx('CONFIG_INVALID');
  if(c.enabled&&(typeof c.corpId!=='string'||!c.corpId||c.corpId.length>128
    ||typeof c.agentId!=='string'||!/^\d{1,20}$/u.test(c.agentId)
    ||typeof c.botId!=='string'||!c.botId||c.botId.length>128))failYxx('CONFIG_INVALID');
  if(c.identityMode!=='UNVERIFIED'){
    if(!c.memberIdsConfirmed||typeof c.proofRef!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$/u.test(c.proofRef)
      ||!['LIVE','SYNTHETIC'].includes(c.proofKind)||c.proofKind==='SYNTHETIC'&&c.validationProfile!=='ISOLATED_TEST')failYxx('CONFIG_INVALID');
  }else if(c.memberIdsConfirmed||c.proofRef!==null||c.proofKind!==null)failYxx('CONFIG_INVALID');
  if(c.identityMode==='VERIFIED_DELEGATED_MAPPING'){
    if(!Array.isArray(c.reporterUserIds)||c.reporterUserIds.length<1||c.reporterUserIds.length>32
      ||c.reporterUserIds.some(id=>!validYxxUserId(id))
      ||new Set(c.reporterUserIds.map(id=>id.toLowerCase())).size!==c.reporterUserIds.length)failYxx('CONFIG_INVALID');
  }else if(c.reporterUserIds!==undefined)failYxx('CONFIG_INVALID');
  return publicP2016(c);
}
export const validYxxUserId=id=>typeof id==='string'&&id.length>0&&Buffer.byteLength(id)<=64&&!/[\\/\s\x00-\x1f\x7f]/u.test(id);
