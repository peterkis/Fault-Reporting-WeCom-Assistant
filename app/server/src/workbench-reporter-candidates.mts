import type {ManualReporterDirectoryOptions,WorkbenchReporterCandidate,WorkbenchReporterCandidates,ManualReporterSelection,ManualReporterVerificationEnvelope} from '../../../contracts/workbench_reporter_candidates_contracts.js';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import {exactP2016,failP2016,guardP2016,publicP2016,P2016_ERROR_CODES} from './p2-016-domain-contracts.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
import {parseReporterVerification,reporterVerificationAuthority} from './workbench-reporter-verification.mjs';

const MAX_PAGE_BYTES=16*1024,DEADLINE_MS=2000,WINDOW_MS=60_000;
function label(value:unknown,maximum=100):string{
  if(typeof value!=='string'||!value.trim()||[...value].length>maximum||/[\u0000-\u001f\u007f]/u.test(value))failP2016();
  return value;
}
function opaque(value:unknown,minimum:number,maximum:number):string{
  if(typeof value!=='string'||value.length<minimum||value.length>maximum||!/^[A-Za-z0-9_-]+$/u.test(value))failP2016();
  return value;
}
function query(params:URLSearchParams){
  for(const key of params.keys())if(!['q','limit','cursor'].includes(key)||params.getAll(key).length!==1)failP2016();
  const rawText=params.get('q');if(rawText===null||/[\u0000-\u001f\u007f]/u.test(rawText))failP2016();
  const text=rawText.trim();if(!text||[...text].length<2)failP2016();label(text);
  const rawLimit=params.get('limit');if(rawLimit!==null&&!/^[1-9][0-9]?$/u.test(rawLimit))failP2016('LIMIT_INVALID');
  const limit=rawLimit===null?10:Number(rawLimit);if(limit>20)failP2016('LIMIT_INVALID');
  const cursor=params.get('cursor');return {query:text,limit,cursor:cursor===null?null:opaque(cursor,1,512)};
}
function page(input:unknown,limit:number):WorkbenchReporterCandidates{
  const value=exactP2016(input,['schema_version','candidates','next_cursor','manual_fallback_available']);
  if(value.schema_version!==1||value.manual_fallback_available!==true||!Array.isArray(value.candidates)||value.candidates.length>limit)failP2016();
  const candidates:WorkbenchReporterCandidate[]=value.candidates.map((input:unknown)=>{
    const row=exactP2016(input,['candidate_ref','candidate_version','display_name','departments','profile_source','binding_verified','message_reachability']);
    if(typeof row.candidate_version!=='string'||!/^[a-f0-9]{64}$/u.test(row.candidate_version)||row.binding_verified!==true
      ||!Array.isArray(row.departments)||row.departments.length>20)failP2016();
    if(row.profile_source!=='WECOM_DIRECTORY'&&row.profile_source!=='THIRD_PARTY_STAFF_DIRECTORY')failP2016();
    if(row.message_reachability!=='REACHABLE'&&row.message_reachability!=='UNREACHABLE'&&row.message_reachability!=='UNKNOWN')failP2016();
    const departments:string[]=row.departments.map((value:unknown)=>label(value));if(new Set(departments).size!==departments.length)failP2016();
    return {candidate_ref:opaque(row.candidate_ref,32,256),candidate_version:row.candidate_version,display_name:label(row.display_name),
      departments,profile_source:row.profile_source,binding_verified:true,message_reachability:row.message_reachability};
  });
  const result=publicP2016({schema_version:1 as const,candidates,next_cursor:value.next_cursor===null?null:opaque(value.next_cursor,1,512),manual_fallback_available:true as const});
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>MAX_PAGE_BYTES)failP2016();return result;
}

/** The configured Port owns object filtering and opaque cursor scope/version/5min validity. */
export function createWorkbenchReporterCandidates({enabled=false,directory=null}:{enabled?:boolean;directory?:ManualReporterDirectoryOptions|null}={}){
  if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
  const configured=enabled&&directory?directory:null;
  const application=configured?.application?Object.freeze({sourceCorpScope:configured.application.sourceCorpScope,sourceAppScope:configured.application.sourceAppScope}):null;
  const sourceScope=configured?.directorySourceScope;
  const search=configured?.port&&typeof configured.port.searchAuthorizedCandidates==='function'?configured.port.searchAuthorizedCandidates.bind(configured.port):null;
  const verify=configured?.port&&typeof configured.port.verifyAuthorizedCandidate==='function'?configured.port.verifyAuthorizedCandidate.bind(configured.port):null;
  const verificationAuthority=configured?.verificationAuthority?Object.freeze({...configured.verificationAuthority}):null;
  const rates=new Map<string,{started:number;count:number}>();
  let inFlight:Promise<unknown>|null=null;
  async function bounded<Input,T>(principalId:string,start:(signal:AbortSignal)=>Promise<Input>,decode:(input:Input)=>T):Promise<T>{
      const started=Date.now();
      for(const [key,value] of rates)if(started-value.started>=WINDOW_MS)rates.delete(key);
      const rate=rates.get(principalId);
      if(inFlight||(rate&&rate.count>=10)||(!rate&&rates.size>=128))failP2016('ACTION_FAILED',503);
      rates.set(principalId,rate?{...rate,count:rate.count+1}:{started,count:1});
      const controller=new AbortController();
      const task=Promise.resolve().then(()=>start(controller.signal));
      inFlight=task;
      // A timed-out adapter that ignores abort cannot open a second request. Its
      // one outstanding operation stays fenced until it actually settles.
      const settled=task.finally(()=>{if(inFlight===task)inFlight=null;});
      let timer:ReturnType<typeof setTimeout>|undefined;
      const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{const error=new WorkbenchError('P2_016_ACTION_FAILED',503);controller.abort(error);reject(error);},DEADLINE_MS);});
      try{
        let raw:Input;
        try{raw=await Promise.race([settled,deadline]);}
        catch(error){
          if(error instanceof WorkbenchError&&P2016_ERROR_CODES.includes(error.code)&&[400,403,409,503].includes(error.status))throw error;
          throw failP2016('ACTION_FAILED',503);
        }
        try{const result=decode(raw);if(Date.now()-started>=DEADLINE_MS)failP2016();return result;}
        catch(error){if(error instanceof WorkbenchError&&[403,409,503].includes(error.status))throw error;throw failP2016('ACTION_FAILED',503);}
      }finally{if(timer!==undefined)clearTimeout(timer);}
  }
  function configuration(){
    if(!application||typeof sourceScope!=='string')failP2016('ACTION_FAILED',503);
    try{label(application.sourceCorpScope,128);label(application.sourceAppScope,128);label(sourceScope,128);}catch{failP2016('ACTION_FAILED',503);}
    return {application,directory_source_scope:sourceScope};
  }
  return Object.freeze({
    fence(principalId:string,selection:ManualReporterSelection,envelope:ManualReporterVerificationEnvelope,target:YxxMemberScope|null){
      guardP2016(enabled);const scope=configuration(),authority=reporterVerificationAuthority(verificationAuthority),signal=new AbortController().signal;
      const request=target===null?{principal_id:principalId,...scope,selection,signal,purpose:'ADMISSION' as const,committed_target_scope:null}
        :{principal_id:principalId,...scope,selection,signal,purpose:'READ_COMMITTED' as const,committed_target_scope:target};
      return parseReporterVerification(envelope,request,authority);
    },
    async search(principalId:string,params:URLSearchParams):Promise<WorkbenchReporterCandidates>{
      guardP2016(enabled);const fields=query(params),scope=configuration();if(!search)failP2016('ACTION_FAILED',503);
      return bounded(principalId,signal=>search({principal_id:principalId,...scope,...fields,signal}),raw=>page(raw,fields.limit));
    },
    async verify(principalId:string,selection:ManualReporterSelection,committedTarget:YxxMemberScope|null):Promise<ManualReporterVerificationEnvelope>{
      guardP2016(enabled);const scope=configuration(),authority=reporterVerificationAuthority(verificationAuthority);if(!verify)failP2016('ACTION_FAILED',503);
      return bounded(principalId,async signal=>{
        const request=committedTarget===null?{principal_id:principalId,...scope,selection,signal,purpose:'ADMISSION' as const,committed_target_scope:null}
          :{principal_id:principalId,...scope,selection,signal,purpose:'READ_COMMITTED' as const,committed_target_scope:publicP2016(committedTarget)};
        return {request,raw:await verify(request)};
      },value=>{
        // The request was produced locally; the untrusted payload is only its raw member.
        return parseReporterVerification(value.raw,value.request,authority);
      });
    },
  });
}
