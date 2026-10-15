import type {WorkbenchActivityCommand,WorkbenchActivityField,WorkbenchActivityTarget,WorkbenchActivityView,WorkbenchActivityReceipt,WorkbenchActivityMode} from '../contracts/workbench_activity_contracts.js';
import {exactP2016,failP2016,uuidP2016} from './p2-016-domain-contracts.mjs';

export const WORKBENCH_ACTIVITY_LIMITS=Object.freeze({lease_ttl_ms:15000,heartbeat_ms:5000,viewing_idle_ms:60000,editing_idle_ms:10000,max_objects_per_browser:2,max_browsers_per_principal:4,max_browsers:64,max_leases:128,max_leases_per_object:16} as const);
export interface ActivityIdentity {principal_id:string;display_name:string;binding:string}
export interface WorkbenchActivityOptions {
  enabled?:boolean;
  now?:()=>number;
  authorize:(authContext:unknown,target:WorkbenchActivityTarget,field:WorkbenchActivityField|null)=>Promise<ActivityIdentity>;
  wakeup?:()=>unknown;
}
interface Lease {key:string;browser:string;target:WorkbenchActivityTarget;authContext:unknown;identity:ActivityIdentity;mode:WorkbenchActivityMode;field:WorkbenchActivityField|null;viewedAt:number;editedAt:number|null;expires:number}
const fields=new Set(['internal-note','ticket-handling','ticket-completion','manual-review']);
export function activityTarget(value:unknown):WorkbenchActivityTarget {
  const v=exactP2016(value,['kind','id']);
  if(v.kind!=='ticket'&&v.kind!=='review'&&v.kind!=='intake')failP2016();
  return {kind:v.kind,id:uuidP2016(v.id)};
}
export function activityCommand(value:unknown):WorkbenchActivityCommand {
  const v=exactP2016(value,['schema_version','browser_id','action','target','visible','active','mode','field'],['schema_version','browser_id','action']);
  if(v.schema_version!==1)failP2016();
  const browser_id=uuidP2016(v.browser_id);
  if(v.action==='RELEASE_BROWSER'){exactP2016(v,['schema_version','browser_id','action']);return {schema_version:1,browser_id,action:v.action};}
  if(v.action==='RELEASE'){exactP2016(v,['schema_version','browser_id','action','target']);return {schema_version:1,browser_id,action:v.action,target:activityTarget(v.target)};}
  exactP2016(v,['schema_version','browser_id','action','target','visible','active','mode','field']);
  if(v.action!=='RENEW'||v.visible!==true||typeof v.active!=='boolean')failP2016();
  const base={schema_version:1 as const,browser_id,action:'RENEW' as const,target:activityTarget(v.target),visible:true as const,active:v.active};
  if(v.mode==='VIEWING'&&v.field===null)return {...base,mode:'VIEWING',field:null};
  if(v.mode==='EDITING'&&typeof v.field==='string'&&fields.has(v.field))return {...base,mode:'EDITING',field:v.field as WorkbenchActivityField};
  failP2016();
}
const targetKey=(target:WorkbenchActivityTarget)=>target.kind+':'+target.id;
/** Single-App, bounded, ephemeral hints. No persistent or business command port. */
export function createWorkbenchActivity({enabled=false,now=Date.now,authorize,wakeup=()=>{}}:WorkbenchActivityOptions){
  if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
  const leases=new Map<string,Lease>();let closed=false,generation=0;
  const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)failP2016();return value;};
  const ready=()=>{if(!enabled||closed)failP2016('DISABLED',503);};
  const notify=()=>{try{wakeup();}catch{/* Existing SSE recovery catches a missed hint. */}};
  function expire(){const at=clock();let changed=false;for(const [key,lease] of leases)if(lease.expires<=at||at-lease.viewedAt>=WORKBENCH_ACTIVITY_LIMITS.viewing_idle_ms){leases.delete(key);changed=true;}if(changed)notify();}
  function erase(predicate:(lease:Lease)=>boolean){let changed=false;for(const [key,lease] of leases)if(predicate(lease)){leases.delete(key);changed=true;}generation++;if(changed)notify();}
  async function authority(authContext:unknown,target:WorkbenchActivityTarget,field:WorkbenchActivityField|null){
    try{return await authorize(authContext,target,field);}
    catch(error){erase(lease=>sameAuthentication(lease.authContext,authContext)&&targetKey(lease.target)===targetKey(target));throw error;}
  }
  async function current(lease:Lease):Promise<Lease|null>{
    if(leases.get(lease.key)!==lease)return null;
    try {
      const identity=await authorize(lease.authContext,lease.target,lease.mode==='EDITING'?lease.field:null);
      if(identity.binding!==lease.identity.binding||identity.principal_id!==lease.identity.principal_id){if(leases.get(lease.key)===lease)leases.delete(lease.key);return null;}
      if(leases.get(lease.key)!==lease||lease.expires<=clock())return null;
      const editing=lease.mode==='EDITING'&&lease.editedAt!==null&&clock()-lease.editedAt<WORKBENCH_ACTIVITY_LIMITS.editing_idle_ms;
      return {...lease,identity,mode:editing?'EDITING':'VIEWING'};
    }catch(error){
      const code=error&&typeof error==='object'&&'status' in error?error.status:null;
      if(code!==401&&code!==403&&code!==404)throw error;
      if(leases.get(lease.key)===lease)leases.delete(lease.key);return null;
    }
  }
  async function view(authContext:unknown,target:WorkbenchActivityTarget):Promise<WorkbenchActivityView>{
    ready();expire();const viewer=await authority(authContext,target,null),people=new Map<string,{display_name:string;mode:WorkbenchActivityMode;expires_epoch_ms:string}>();
    for(const lease of [...leases.values()].filter(value=>targetKey(value.target)===targetKey(target))){
      const live=await current(lease);if(!live||live.identity.principal_id===viewer.principal_id)continue;
      const old=people.get(live.identity.principal_id),mode=old?.mode==='EDITING'||live.mode==='EDITING'?'EDITING':'VIEWING',expires=Math.max(old?Number(old.expires_epoch_ms):0,live.expires);
      people.set(live.identity.principal_id,{display_name:live.identity.display_name,mode,expires_epoch_ms:String(expires)});
    }
    // Fence the response against a viewer whose authority changed while colleagues were read.
    const fresh=await authority(authContext,target,null);if(fresh.binding!==viewer.binding)failP2016('FORBIDDEN',403);
    return {schema_version:1,people:[...people.values()].filter(person=>BigInt(person.expires_epoch_ms)>BigInt(clock())).sort((a,b)=>a.display_name.localeCompare(b.display_name)).slice(0,WORKBENCH_ACTIVITY_LIMITS.max_leases_per_object)};
  }
  return Object.freeze({
    limits:WORKBENCH_ACTIVITY_LIMITS,
    async perform({authContext,body}:{authContext:unknown;body:unknown}):Promise<WorkbenchActivityReceipt>{
      ready();expire();const command=activityCommand(body);
      // Releases require a current identity at the HTTP boundary and only erase this binding.
      if(command.action==='RELEASE_BROWSER'){
        erase(lease=>lease.browser===command.browser_id&&sameAuthentication(lease.authContext,authContext));
        return {schema_version:1,accepted:true,expires_epoch_ms:null};
      }
      const revision=generation,identity=await authority(authContext,command.target,command.action==='RENEW'&&command.mode==='EDITING'?command.field:null);
      if(closed||revision!==generation)failP2016('VERSION_CONFLICT',409);
      const key=identity.binding+':'+command.browser_id+':'+targetKey(command.target);
      if(command.action==='RELEASE'){erase(lease=>lease.key===key);return {schema_version:1,accepted:true,expires_epoch_ms:null};}
      const at=clock(),old=leases.get(key);
      if(!command.active&&(!old||at-old.viewedAt>=WORKBENCH_ACTIVITY_LIMITS.viewing_idle_ms)){if(old)erase(lease=>lease.key===key);return {schema_version:1,accepted:true,expires_epoch_ms:null};}
      const browsers=new Set([...leases.values()].map(lease=>lease.identity.binding+':'+lease.browser));
      const ownBrowsers=new Set([...leases.values()].filter(lease=>lease.identity.principal_id===identity.principal_id).map(lease=>lease.identity.binding+':'+lease.browser));
      const browser=identity.binding+':'+command.browser_id;
      if(!old&&(leases.size>=128||[...leases.values()].filter(lease=>targetKey(lease.target)===targetKey(command.target)).length>=16
        ||[...leases.values()].filter(lease=>lease.identity.binding===identity.binding&&lease.browser===command.browser_id).length>=2
        ||!browsers.has(browser)&&(browsers.size>=64||ownBrowsers.size>=4)))failP2016('DISABLED',503);
      const editedAt=command.mode==='EDITING'?(command.active?at:old?.editedAt??null):null;
      const mode=command.mode==='EDITING'&&editedAt!==null&&at-editedAt<10000?'EDITING':'VIEWING';
      const expires=at+15000;leases.set(key,{key,browser:command.browser_id,target:command.target,authContext,identity,mode,field:mode==='EDITING'?command.field:null,viewedAt:command.active?at:old?.viewedAt??at,editedAt,expires});notify();
      return {schema_version:1,accepted:true,expires_epoch_ms:String(expires)};
    },
    view,
    async signature(authContext:unknown){
      ready();expire();const values:string[]=[];
      const targets=new Map<string,WorkbenchActivityTarget>();
      for(const lease of leases.values())if(sameAuthentication(lease.authContext,authContext))targets.set(targetKey(lease.target),lease.target);
      for(const target of targets.values()){const projection=await view(authContext,target);values.push(JSON.stringify([targetKey(target),projection.people.map(person=>[person.display_name,person.mode]) ]));}
      return values.length?values.sort().join('|'):null;
    },
    releaseAuthentication(authContext:unknown){erase(lease=>sameAuthentication(lease.authContext,authContext));},
    close(){closed=true;erase(()=>true);},
  });
}
function sameAuthentication(left:unknown,right:unknown){
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  const value=(v:object,key:string)=>Object.getOwnPropertyDescriptor(v,key)?.value as unknown;
  return value(left,'principal_id')===value(right,'principal_id')&&value(left,'csrf_token')===value(right,'csrf_token')&&value(left,'session_id')===value(right,'session_id');
}
