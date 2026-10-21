interface Work {priority:number;signal:AbortSignal;start:()=>Promise<Blob>;resolve:(blob:Blob)=>void;reject:(reason:unknown)=>void;abort:()=>void}
/** Per-page bounded queue: user reads precede thumbnails that have not started. */
export function createMaterialQueue(){
 let pending:Work[]=[],active:Work|null=null,disposed=false;
 const playback=new Set<string>();
 const drain=()=>{
  if(disposed||active)return;
  const index=pending.findIndex(work=>work.priority===0||playback.size===0);if(index<0)return;
  const work=pending.splice(index,1)[0];if(!work)return;active=work;
  void work.start().then(work.resolve,work.reject).finally(()=>{work.signal.removeEventListener('abort',work.abort);active=null;drain();});
 };
 const schedule=(priority:0|1,signal:AbortSignal,start:()=>Promise<Blob>)=>new Promise<Blob>((resolve,reject)=>{
  if(disposed||signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
  if(pending.length>=8){reject(new Error('MEDIA_QUEUE_FULL'));return;}
  const work:Work={priority,signal,start,resolve,reject,abort:()=>{
   const index=pending.indexOf(work);if(index>=0){pending.splice(index,1);signal.removeEventListener('abort',work.abort);reject(new DOMException('Aborted','AbortError'));}
  }};
  signal.addEventListener('abort',work.abort,{once:true});pending.push(work);pending.sort((left,right)=>left.priority-right.priority);drain();
 });
 return {schedule,setPlayback:(id:string,playing:boolean)=>{if(playing)playback.add(id);else playback.delete(id);drain();},dispose:()=>{
  disposed=true;for(const work of pending){work.signal.removeEventListener('abort',work.abort);work.reject(new DOMException('Aborted','AbortError'));}pending=[];playback.clear();
 }};
}
