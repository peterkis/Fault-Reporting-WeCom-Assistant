import {H5_MEDIA_LIMITS,mediaFail,H5MediaError} from './yxx-h5-media-format.mjs';

interface Requirement {disk:boolean;read:boolean;bytes:number}
interface Reservation {releaseDisk():void;release():void}
interface Waiter {requirement:Requirement;signal:AbortSignal;resolve(value:Reservation):void;reject(reason:unknown):void;abort():void}

/** A late read may complete in PostgreSQL, but cannot retain a cancelled output lease. */
export async function awaitYxxH5MediaRead<T>(signal:AbortSignal,run:()=>Promise<T>):Promise<T>{
 signal.throwIfAborted();let cancel=()=>{};
 const cancelled=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new H5MediaError('YXX_MEDIA_UPLOAD_CANCELLED',408));signal.addEventListener('abort',cancel,{once:true});});
 try{return await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return run();}),cancelled]);}
 finally{signal.removeEventListener('abort',cancel);}
}

/** One FIFO for disk work, two HTTP leases and the aggregate plaintext budget. */
export function createYxxH5MediaBudget(){
 let disk=0,reads=0,bytes=0,closed=false;
 const waiting:Waiter[]=[];
 function fits(r:Requirement){return (!r.disk||disk===0)&&(!r.read||reads<H5_MEDIA_LIMITS.readLeases)&&bytes+r.bytes<=H5_MEDIA_LIMITS.plaintext;}
 function grant(r:Requirement):Reservation {
  let diskHeld=r.disk,released=false;if(r.disk)disk++;if(r.read)reads++;bytes+=r.bytes;
  return {releaseDisk(){if(released||!diskHeld)return;diskHeld=false;disk--;drain();},release(){if(released)return;released=true;if(diskHeld)disk--;if(r.read)reads--;bytes-=r.bytes;drain();}};
 }
 function drain(){while(waiting.length){const next=waiting[0];if(!next)return;if(next.signal.aborted){waiting.shift();next.signal.removeEventListener('abort',next.abort);next.reject(new H5MediaError('YXX_MEDIA_UPLOAD_CANCELLED',408));continue;}if(!fits(next.requirement))return;waiting.shift();next.signal.removeEventListener('abort',next.abort);next.resolve(grant(next.requirement));}}
 return Object.freeze({
  async acquire(requirement:Requirement,signal:AbortSignal):Promise<Reservation>{
   if(closed)mediaFail('YXX_MEDIA_STORAGE_UNAVAILABLE',503);signal.throwIfAborted();
   if(!Number.isSafeInteger(requirement.bytes)||requirement.bytes<0||requirement.bytes>H5_MEDIA_LIMITS.plaintext)mediaFail('YXX_MEDIA_OVERSIZED',413);
   if(!waiting.length&&fits(requirement))return grant(requirement);
   if(waiting.length>=H5_MEDIA_LIMITS.waiting)mediaFail('YXX_MEDIA_BUSY',429);
   return new Promise<Reservation>((resolve,reject)=>{
    const waiter:Waiter={requirement,signal,resolve,reject,abort(){const at=waiting.indexOf(waiter);if(at<0)return;waiting.splice(at,1);signal.removeEventListener('abort',waiter.abort);reject(new H5MediaError('YXX_MEDIA_UPLOAD_CANCELLED',408));drain();}};
    waiting.push(waiter);signal.addEventListener('abort',waiter.abort,{once:true});if(signal.aborted)waiter.abort();
   });
  },
  close(){closed=true;for(const waiter of waiting.splice(0)){waiter.signal.removeEventListener('abort',waiter.abort);waiter.reject(new H5MediaError('YXX_MEDIA_STORAGE_UNAVAILABLE',503));}},
  snapshot:()=>({disk_operations:disk,read_leases:reads,plaintext_reserved_bytes:bytes,waiting:waiting.length}),
 });
}
