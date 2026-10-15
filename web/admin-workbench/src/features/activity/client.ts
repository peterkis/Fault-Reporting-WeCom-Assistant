import {ApiError,captureWorkbenchRead,readWorkbench} from '../../api/client';
import type {Principal} from '../../api/client';
import type {WorkbenchActivityCommand,WorkbenchActivityPerson,WorkbenchActivityTarget,WorkbenchActivityField,WorkbenchActivityReceipt,WorkbenchActivityView} from '../../../../../contracts/workbench_activity_contracts';
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function epoch(value:unknown){if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/u.test(value)||BigInt(value)>9223372036854775807n)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function view(value:unknown):WorkbenchActivityView{
  const v=record(value);if(Object.keys(v).length!==2||v.schema_version!==1||!Array.isArray(v.people)||v.people.length>16)throw new ApiError(502,'INVALID_RESPONSE');
  return {schema_version:1,people:v.people.map(value=>{const p=record(value);if(Object.keys(p).length!==3||typeof p.display_name!=='string'||!p.display_name.length||p.display_name.length>128||(p.mode!=='VIEWING'&&p.mode!=='EDITING'))throw new ApiError(502,'INVALID_RESPONSE');return {display_name:p.display_name,mode:p.mode,expires_epoch_ms:epoch(p.expires_epoch_ms)};})};
}
async function send(principal:Principal,command:WorkbenchActivityCommand,signal?:AbortSignal):Promise<WorkbenchActivityReceipt>{
  const controller=signal??new AbortController().signal,current=captureWorkbenchRead(controller);
  const response=await fetch('/api/workbench/activity',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller,headers:{'content-type':'application/json','x-csrf-token':principal.csrf_token??''},body:JSON.stringify(command)});
  current();if(!response.ok)throw new ApiError(response.status,'ACTIVITY_UNAVAILABLE');
  const v=record(await response.json());current();
  if(Object.keys(v).length!==3||v.schema_version!==1||v.accepted!==true)throw new ApiError(502,'INVALID_RESPONSE');
  return {schema_version:1,accepted:true,expires_epoch_ms:v.expires_epoch_ms===null?null:epoch(v.expires_epoch_ms)};
}
interface ActivityRegistration {target:WorkbenchActivityTarget;principal:Principal;visible:boolean;active:boolean;editActive:boolean;lastView:number;lastEdit:number;field:WorkbenchActivityField|null;generation:number;people:(people:WorkbenchActivityPerson[])=>void}
const mounted=new Set<ActivityRegistration>();
let browserId:string|null=null,live=false,identity='',generation=0;
const key=(principal:Principal)=>JSON.stringify([principal.principal_id,principal.csrf_token,principal.authorization_revision]);
export function activityTransport(principal:Principal|null,isLive:boolean){
  const next=principal?key(principal):'';
  if(next!==identity||!isLive){for(const entry of mounted){if(live)release(entry);else entry.people([]);entry.active=false;entry.editActive=false;entry.lastView=0;entry.lastEdit=0;entry.field=null;entry.generation++;}generation++;}
  if(next!==identity){browserId=principal?.activity_enabled?crypto.randomUUID():null;identity=next;}
  live=isLive&&principal?.activity_enabled===true;
}
function release(entry:ActivityRegistration){
  entry.people([]);entry.generation++;if(browserId&&entry.principal.csrf_token)void send(entry.principal,{schema_version:1,browser_id:browserId,action:'RELEASE',target:entry.target}).catch(()=>{});
}
export function registerActivity(registration:Omit<ActivityRegistration,'active'|'editActive'|'lastView'|'lastEdit'|'field'|'generation'>){
  const entry:ActivityRegistration={...registration,active:false,editActive:false,lastView:0,lastEdit:0,field:null,generation:0};
  if(mounted.size>=2||!entry.principal.activity_enabled)return {visible:(_visible:boolean)=>{},touch:(_field:WorkbenchActivityField|null)=>{},dispose(){}};
  mounted.add(entry);browserId??=crypto.randomUUID();
  return {
    visible(visible:boolean){if(entry.visible===visible)return;entry.visible=visible;if(!visible)release(entry);else if(live){entry.active=true;entry.lastView=performance.now();}},
    touch(field:WorkbenchActivityField|null){if(!live||!entry.visible||!navigator.onLine||document.visibilityState==='hidden')return;entry.active=true;entry.lastView=performance.now();if(field){entry.field=field;entry.lastEdit=entry.lastView;entry.editActive=true;}},
    dispose(){mounted.delete(entry);release(entry);},
  };
}
/** Called only by the existing T38 refresh cycle; owns no timer or EventSource. */
export async function flushActivity(principal:Principal,signal:AbortSignal,isLive:boolean){
  if(!isLive||!principal.activity_enabled||key(principal)!==identity||!live||!browserId)return;
  const epochGeneration=generation,at=performance.now(),browser=browserId;
  for(const entry of mounted){
    if(key(entry.principal)!==identity||!entry.visible||!entry.lastView||at-entry.lastView>=60000){release(entry);continue;}
    const version=entry.generation,active=entry.active,editing=entry.field!==null&&at-entry.lastEdit<10000&&(!active||entry.editActive);
    entry.active=false;entry.editActive=false;
    const body:WorkbenchActivityCommand=editing&&entry.field?{schema_version:1,browser_id:browser,action:'RENEW',target:entry.target,visible:true,active,mode:'EDITING',field:entry.field}:{schema_version:1,browser_id:browser,action:'RENEW',target:entry.target,visible:true,active,mode:'VIEWING',field:null};
    try{
      await send(principal,body,signal);
      if(epochGeneration!==generation||version!==entry.generation||!live||signal.aborted)continue;
      const result=await readWorkbench('/api/workbench/items/'+entry.target.kind+'/'+entry.target.id+'/activity',signal,view);
      if(epochGeneration===generation&&version===entry.generation&&live&&!signal.aborted)entry.people(result.people.filter(person=>BigInt(person.expires_epoch_ms)>BigInt(Date.now())));
    }catch{entry.people([]);entry.lastView=0;entry.lastEdit=0;entry.field=null;}
  }
}
