import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import type {H5Media} from '../contracts/yxx_h5_v2_contracts.js';
import type {ReporterDirectoryPort} from '../contracts/p2_015_contracts.js';
import type {H5ProfileEnricherOptions} from './yxx-h5-v2-profile-enricher.mjs';
import {isAbsolute} from 'node:path';
import {createYxxH5Lifecycle} from './yxx-h5-v2-lifecycle.mjs';
import {createYxxH5Profile} from './yxx-h5-v2-profile.mjs';
import {createYxxH5ProfileEnricher} from './yxx-h5-v2-profile-enricher.mjs';
import {createYxxH5Media} from './yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from './yxx-h5-media-store.mjs';
import {createYxxH5MediaWeCom} from './yxx-h5-media-wecom.mjs';
import {createYxxH5MediaFFmpegTranscoder} from './yxx-h5-media-transcode.mjs';
import {failYxx} from './p2-g2-yixiaoxiu-contract.mjs';

/** Explicit resource injection. This option never changes the existing member write flags. */
export interface YxxH5RuntimeOptions {
  enabled?:boolean;
  privateRoot?:string;
  key?:Uint8Array;
  ffmpegPath?:string;
  ffprobePath?:string;
  accessTokenProvider?:WeComAccessTokenProvider;
  fetchImpl?:typeof fetch;
  workbenchProgressEnabled?:boolean;
}
interface RuntimeBase {
  pool:PostgresPool;
  scopeSecret:string;
  options?:YxxH5RuntimeOptions|null;
  sourceScope?:string;
  directoryPort?:ReporterDirectoryPort|null;
  verifyCurrentMember?:H5ProfileEnricherOptions['verifyCurrentMember'];
  onUrge?:NonNullable<Parameters<typeof createYxxH5Lifecycle>[0]>['onUrge'];
  onPublicProgress?:NonNullable<Parameters<typeof createYxxH5Lifecycle>[0]>['onPublicProgress'];
}
type RuntimeInput=RuntimeBase&({role?:'APP';publicOrigin:string;corpId:string;agentId:string}|{role:'WORKER';publicOrigin?:never;corpId?:never;agentId?:never});
const absolutePath=(value:unknown)=>typeof value==='string'&&isAbsolute(value)&&!/[\x00-\x1f\x7f]/u.test(value);
export function validateYxxH5RuntimeOptions(options:YxxH5RuntimeOptions|null|undefined,role:'APP'|'WORKER'='APP') {
  if(options===null||options===undefined)return false;
  if(!options||typeof options!=='object'||Array.isArray(options)||options.enabled!==undefined&&typeof options.enabled!=='boolean'
    ||options.workbenchProgressEnabled!==undefined&&typeof options.workbenchProgressEnabled!=='boolean')failYxx('CONFIG_INVALID');
  if(options.enabled!==true){if(options.workbenchProgressEnabled===true)failYxx('CONFIG_INVALID');return false;}
  if(!absolutePath(options.privateRoot)||!(options.key instanceof Uint8Array)||options.key.byteLength!==32
    ||options.accessTokenProvider!==undefined&&typeof options.accessTokenProvider!=='function'
    ||options.fetchImpl!==undefined&&typeof options.fetchImpl!=='function'
    ||(options.ffmpegPath!==undefined||options.ffprobePath!==undefined||role==='WORKER')
      &&(!absolutePath(options.ffmpegPath)||!absolutePath(options.ffprobePath)))failYxx('CONFIG_INVALID');
  return true;
}

/** Reuses the supplied pool and the role's existing runOnce; creates no timer or directory. */
export function createYxxH5Runtime({pool,scopeSecret,publicOrigin,corpId,agentId,options=null,role='APP',sourceScope='FORMAL',directoryPort=null,verifyCurrentMember=null,onUrge=null,onPublicProgress=null}:RuntimeInput) {
  const enabled=validateYxxH5RuntimeOptions(options,role);
  if(enabled&&role==='APP'&&(typeof publicOrigin!=='string'||typeof corpId!=='string'||!corpId||typeof agentId!=='string'||!agentId))failYxx('CONFIG_INVALID');
  const lifecycle=enabled?createYxxH5Lifecycle({pool,scopeSecret,enabled:true,onUrge,onPublicProgress}):null;
  const profile=enabled?createYxxH5Profile({pool,scopeSecret,enabled:true,sourceScope}):null;
  const profileEnricher=enabled&&role==='WORKER'&&directoryPort?createYxxH5ProfileEnricher({pool,scopeSecret,directoryPort,verifyCurrentMember,enabled:true}):null;
  const selected=enabled?options:null;
  const store=selected?createYxxH5MediaPrivateStore({root:selected.privateRoot as string,key:selected.key as Uint8Array}):null;
  const wecom=selected?.accessTokenProvider&&role==='APP'?createYxxH5MediaWeCom({
    accessTokenProvider:selected.accessTokenProvider,publicOrigin:publicOrigin as string,corpId:corpId as string,agentId:agentId as string,
    ...(selected.fetchImpl?{fetchImpl:selected.fetchImpl}:{}),
  }):null;
  const transcoder=selected&&role==='WORKER'?createYxxH5MediaFFmpegTranscoder({
    ffmpegPath:selected.ffmpegPath as string,ffprobePath:selected.ffprobePath as string,temporaryRoot:selected.privateRoot as string,
  }):null;
  const media=store?createYxxH5Media({pool,store,wecom,transcoder,enabled:true}):null;
  const sdk=Object.freeze({enabled:wecom!==null,corp_id:wecom?corpId as string:null,agent_id:wecom?agentId as string:null});
  let stopped=false;
  let running:Promise<void>|null=null;
  let closing:Promise<void>|null=null;
  let nextCleanupEpochMs=0;
  async function runOnce() {
    if(stopped||role!=='WORKER'||!media||running)return;
    const task=(async()=>{
      await profileEnricher?.runOnce({limit:1});
      if(stopped)return;
      if(Date.now()>=nextCleanupEpochMs){await media.cleanupExpired();nextCleanupEpochMs=Date.now()+60_000;}
      if(!stopped)await media.processNextTranscode();
    })();
    running=task;
    try{await task;}finally{running=null;}
  }
  async function close() {
    if(closing)return closing;
    stopped=true;
    closing=(async()=>{await media?.close();await running;})();
    return closing;
  }
  return Object.freeze({enabled,lifecycle,profile,profileEnricher,media,wecom,sdk,runOnce,close,
    workbenchProgressEnabled:enabled&&options?.workbenchProgressEnabled===true,
    async ready() {
      if(!enabled)return true;
      try{return (await pool.query("SELECT migration_id FROM platform.schema_migration WHERE migration_id IN ('064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media')")).rowCount===2;}
      catch{return false;}
    },
    async queryMedia({transaction,scope,requestRef}: {transaction:import('./platform/postgres-pool.mjs').PostgresTransaction;scope:YxxMemberScope;requestRef:string}):Promise<H5Media[]> {
      if(!media)return [];
      const assets=await media.listForRequestInTransaction({transaction,scope,requestRef});
      return assets.map(asset=>({...asset,url:'/api/yixiaoxiu/requests/'+encodeURIComponent(requestRef)+'/media/'+encodeURIComponent(asset.media_ref)}));
    },
  });
}
export type YxxH5Runtime=ReturnType<typeof createYxxH5Runtime>;

/** One Provider qualification per HTTP request, including overlapping bootstrap reads. */
export function createYxxH5RequestAuthentication<Request extends object,Context>({authenticate,recheck}:{authenticate:(request:Request)=>Context|Promise<Context>;recheck:(request:Request)=>Context|Promise<Context>}) {
  const pending=new WeakMap<Request,Promise<Context>>();
  return Object.freeze({
    authenticate(request:Request) {
      const ready=pending.get(request);
      if(ready)return ready.then(()=>recheck(request));
      const first=Promise.resolve().then(()=>authenticate(request));
      pending.set(request,first);
      return first;
    },
    release(request:Request){pending.delete(request);},
  });
}
