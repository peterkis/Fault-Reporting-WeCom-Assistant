import type {WorkbenchActivityCommand,WorkbenchActivityField,WorkbenchActivityTarget,WorkbenchActivityView,WorkbenchActivityReceipt,WorkbenchActivityMode,WorkbenchActivityPerson,WorkbenchActivityBatchView} from '../../../contracts/workbench_activity_contracts.js';
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
/** ADR-0057: 1..100 targets, each validated like the single view; duplicates collapse in request order. */
export const WORKBENCH_ACTIVITY_BATCH_MAX_TARGETS=100;
export function activityBatchRequest(value:unknown):WorkbenchActivityTarget[]{
  const v=exactP2016(value,['schema_version','targets']);
  if(v.schema_version!==1||!Array.isArray(v.targets)||v.targets.length<1||v.targets.length>WORKBENCH_ACTIVITY_BATCH_MAX_TARGETS)failP2016();
  const unique=new Map<string,WorkbenchActivityTarget>();
  for(const raw of v.targets as unknown[]){const target=activityTarget(raw),key=targetKey(target);if(!unique.has(key))unique.set(key,target);}
  return [...unique.values()];
}
const targetKey=(target:WorkbenchActivityTarget)=>target.kind+':'+target.id;
const errorStatus=(error:unknown)=>error&&typeof error==='object'&&'status' in error?error.status:null;
/** Single-App, bounded, ephemeral hints. No persistent or business command port. */
export function createWorkbenchActivity({enabled=false,now=Date.now,authorize,wakeup=()=>{}}:WorkbenchActivityOptions){
  if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
  const leases=new Map<string,Lease>();let closed=false,generation=0;
  // ADR-0057: one integer, bumped on every visible presence change, folded into each SSE signature.
  let version=0;
  const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)failP2016();return value;};
  const ready=()=>{if(!enabled||closed)failP2016('DISABLED',503);};
  const notify=()=>{try{wakeup();}catch{/* Existing SSE recovery catches a missed hint. */}};
  function expire(){const at=clock();let changed=false;for(const [key,lease] of leases)if(lease.expires<=at||at-lease.viewedAt>=WORKBENCH_ACTIVITY_LIMITS.viewing_idle_ms){leases.delete(key);changed=true;}if(changed){version++;notify();}}
  function erase(predicate:(lease:Lease)=>boolean){let changed=false;for(const [key,lease] of leases)if(predicate(lease)){leases.delete(key);changed=true;}generation++;if(changed){version++;notify();}}
  /** The field view() would show for one person on one target, from stored lease state. */
  function editingWinner(principal:string,target:WorkbenchActivityTarget){
    let winner:Lease|null=null;
    for(const lease of leases.values())if(lease.identity.principal_id===principal&&targetKey(lease.target)===targetKey(target)&&lease.mode==='EDITING'&&lease.field!==null&&(!winner||(lease.editedAt??0)>(winner.editedAt??0)))winner=lease;
    return winner?.field??null;
  }
  async function authority(authContext:unknown,target:WorkbenchActivityTarget,field:WorkbenchActivityField|null){
    try{return await authorize(authContext,target,field);}
    catch(error){erase(lease=>sameAuthentication(lease.authContext,authContext)&&targetKey(lease.target)===targetKey(target));throw error;}
  }
  async function current(lease:Lease):Promise<Lease|null>{
    if(leases.get(lease.key)!==lease)return null;
    try {
      const identity=await authorize(lease.authContext,lease.target,lease.mode==='EDITING'?lease.field:null);
      if(identity.binding!==lease.identity.binding||identity.principal_id!==lease.identity.principal_id){if(leases.get(lease.key)===lease){leases.delete(lease.key);version++;}return null;}
      if(leases.get(lease.key)!==lease||lease.expires<=clock())return null;
      const editing=lease.mode==='EDITING'&&lease.editedAt!==null&&clock()-lease.editedAt<WORKBENCH_ACTIVITY_LIMITS.editing_idle_ms;
      return {...lease,identity,mode:editing?'EDITING':'VIEWING'};
    }catch(error){
      const code=errorStatus(error);
      if(code!==401&&code!==403&&code!==404)throw error;
      if(leases.get(lease.key)===lease){leases.delete(lease.key);version++;}return null;
    }
  }
  async function view(authContext:unknown,target:WorkbenchActivityTarget):Promise<WorkbenchActivityView>{
    ready();expire();const viewer=await authority(authContext,target,null),people=new Map<string,{display_name:string;mode:WorkbenchActivityMode;field:WorkbenchActivityField|null;editedAt:number;expires:number}>();
    for(const lease of [...leases.values()].filter(value=>targetKey(value.target)===targetKey(target))){
      const live=await current(lease);if(!live||live.identity.principal_id===viewer.principal_id)continue;
      const old=people.get(live.identity.principal_id),expires=Math.max(old?.expires??0,live.expires);
      // ADR-0057 A1: one person per principal; EDITING wins and the most recently edited field is shown.
      const editing=live.mode==='EDITING'&&live.field!==null&&(!old||old.mode!=='EDITING'||(live.editedAt??0)>old.editedAt);
      people.set(live.identity.principal_id,editing
        ?{display_name:live.identity.display_name,mode:'EDITING',field:live.field,editedAt:live.editedAt??0,expires}
        :old?{...old,display_name:live.identity.display_name,expires}:{display_name:live.identity.display_name,mode:'VIEWING',field:null,editedAt:0,expires});
    }
    // Fence the response against a viewer whose authority changed while colleagues were read.
    const fresh=await authority(authContext,target,null);if(fresh.binding!==viewer.binding)failP2016('FORBIDDEN',403);
    const at=clock();
    return {schema_version:1,people:[...people.values()].filter(person=>person.expires>at)
      .sort((a,b)=>(a.mode===b.mode?0:a.mode==='EDITING'?-1:1)||a.display_name.localeCompare(b.display_name))
      .slice(0,WORKBENCH_ACTIVITY_LIMITS.max_leases_per_object)
      .map(({display_name,mode,field,expires}):WorkbenchActivityPerson=>({display_name,mode,field,expires_epoch_ms:String(expires)}))};
  }
  /**
   * ADR-0057 A2: one in-memory pass over at most 128 leases finds targets that hold another
   * principal's lease; only those reuse view(), sequentially. Empty targets cost no authorization.
   */
  async function batchView(authContext:unknown,body:unknown):Promise<WorkbenchActivityBatchView>{
    ready();const targets=activityBatchRequest(body);expire();
    const viewerId=authContext&&typeof authContext==='object'?Object.getOwnPropertyDescriptor(authContext,'principal_id')?.value as unknown:undefined;
    const occupied=new Set<string>();
    for(const lease of leases.values())if(lease.identity.principal_id!==viewerId)occupied.add(targetKey(lease.target));
    const items:WorkbenchActivityBatchView['items']=[];let lastFenced:string|null=null;
    for(const target of targets){
      if(!occupied.has(targetKey(target)))continue;
      // 404 is item-level (hidden or gone): skip only that target. 401/403 is principal/session-level
      // revocation and must not return projections collected before it, so it fails the request.
      try{const projection=await view(authContext,target);lastFenced=targetKey(target);if(projection.people.length)items.push({kind:target.kind,id:target.id,people:projection.people});}
      catch(error){if(errorStatus(error)!==404)throw error;lastFenced=null;}
    }
    // Each view() fenced only its own reads. Re-check every earlier item after all later awaits; the item
    // whose view() was the last awaited operation is already fenced.
    const fenced:WorkbenchActivityBatchView['items']=[];
    for(const item of items){
      if(targetKey(item)!==lastFenced){
        try{await authority(authContext,{kind:item.kind,id:item.id},null);}
        catch(error){if(errorStatus(error)!==404)throw error;continue;}
      }
      fenced.push(item);
    }
    return {schema_version:1,items:fenced};
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
      const field=mode==='EDITING'?command.field:null,winner=editingWinner(identity.principal_id,command.target);
      const expires=at+15000;leases.set(key,{key,browser:command.browser_id,target:command.target,authContext,identity,mode,field,viewedAt:command.active?at:old?.viewedAt??at,editedAt,expires});
      // A newer edit in another tab of the same person can change the merged field without changing this lease.
      if(!old||old.mode!==mode||old.field!==field||winner!==editingWinner(identity.principal_id,command.target))version++;
      notify();
      return {schema_version:1,accepted:true,expires_epoch_ms:String(expires)};
    },
    view,
    batchView,
    /** Global presence version (ADR-0057 A3) prefixes the caller's own-object signature. */
    async signature(authContext:unknown){
      ready();expire();const values:string[]=[];
      const targets=new Map<string,WorkbenchActivityTarget>();
      for(const lease of leases.values())if(sameAuthentication(lease.authContext,authContext))targets.set(targetKey(lease.target),lease.target);
      for(const target of targets.values()){const projection=await view(authContext,target);values.push(JSON.stringify([targetKey(target),projection.people.map(person=>[person.display_name,person.mode,person.field]) ]));}
      return String(version)+'#'+values.sort().join('|');
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
