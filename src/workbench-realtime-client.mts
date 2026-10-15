import type {WorkbenchRealtimeCapability,WorkbenchRealtimeStatus} from '../contracts/workbench_realtime_contracts.js';
import type {RealtimeEventType} from '../contracts/conversation_realtime_contracts.js';
export const WORKBENCH_REALTIME_EVENT_TYPES:readonly RealtimeEventType[]=[
  'conversation.session.created','conversation.session.updated','conversation.item.created','conversation.timeline.rebuilt','conversation.mode.changed','conversation.assigned','conversation.handoff.requested','conversation.handoff.accepted','conversation.read_cursor.changed','communication.delivery.changed','ticket.updated','incident.updated','incident.candidate.review_started','incident.candidate.rejected','incident.candidate.expired','incident.candidate.confirmed','incident.confirmed','incident.status.changed','incident.scope.changed','incident.primary_ticket.changed','incident.report.linked','incident.report.unlinked','incident.report.recovered','incident.subscription.changed','incident.notification.changed','gateway.connection.changed','manual_review.created','manual_review.resolved','ticket.command.committed','ticket.status.changed','ticket.assignment.changed','ticket.notification.created','ticket.notification.delivery_changed',
];
const aggregates=new Set(['CONVERSATION_SESSION','CONVERSATION_ITEM','CONVERSATION_TIMELINE','COMMUNICATION_DELIVERY','TICKET','CONVERSATION_HANDOFF','CONVERSATION_READ_CURSOR','INCIDENT','INCIDENT_CANDIDATE','GATEWAY_CONNECTION','MANUAL_REVIEW']);
const publicFields=['event_id','event_type','aggregate_type','aggregate_id','aggregate_version','visibility_scope','payload','occurred_at','created_at'];
function decimal(value:unknown){return typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/u.test(value)&&BigInt(value)<=9223372036854775807n;}
function safeJson(value:unknown,depth:number,state:{nodes:number}):boolean{
  if(++state.nodes>4096||depth>6)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string')return value.length<=4096;
  if(Array.isArray(value))return value.length<=100&&value.every(item=>safeJson(item,depth+1,state));
  if(typeof value!=='object')return false;
  const entries=Object.entries(value);return entries.length<=64&&entries.every(([key,item])=>!['__proto__','constructor','prototype'].includes(key)&&key.length<=4096&&safeJson(item,depth+1,state));
}
/** Decode only a safe public hint. The payload is deliberately never returned. */
export function decodeWorkbenchRealtimeHint(raw:unknown,name:string):{event_id:string;event_type:RealtimeEventType}|null{
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>70000)return null;
  try{
    const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const v=value as Record<string,unknown>;
    if(Object.keys(v).length!==9||publicFields.some(key=>!Object.hasOwn(v,key))||!decimal(v.event_id)||v.event_id==='0'||v.event_type!==name||!WORKBENCH_REALTIME_EVENT_TYPES.some(type=>type===name)
      ||typeof v.aggregate_type!=='string'||!aggregates.has(v.aggregate_type)||typeof v.aggregate_id!=='string'||v.aggregate_id.length<1||v.aggregate_id.length>256||/[\u0000-\u001f\u007f]/u.test(v.aggregate_id)
      ||!(v.aggregate_version===null||decimal(v.aggregate_version))||!['WORKBENCH','RESTRICTED_ADMIN'].includes(String(v.visibility_scope))
      ||!v.payload||typeof v.payload!=='object'||Array.isArray(v.payload)||!safeJson(v.payload,0,{nodes:0})||new TextEncoder().encode(JSON.stringify(v.payload)).length>65536
      ||[v.occurred_at,v.created_at].some(time=>typeof time!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(time)))return null;
    return {event_id:v.event_id as string,event_type:name as RealtimeEventType};
  }catch{return null;}
}
export interface RealtimeTransport {
  state(): number;
  listen(name:string,listener:(event:{data?:unknown;lastEventId?:string})=>void):()=>void;
  close():void;
}
export interface RealtimeClientOptions {
  capability:WorkbenchRealtimeCapability;
  connect:(endpoint:string)=>RealtimeTransport;
  refresh:(signal:AbortSignal)=>Promise<{available:boolean}>;
  onHint?:()=>void;
  authorizationDenied:(error:unknown)=>boolean;
  report:(state:{status:WorkbenchRealtimeStatus;lastReadAt:number|null})=>void;
  now:()=>number;
  schedule:(callback:()=>void,delay:number)=>unknown;
  cancel:(handle:unknown)=>void;
}
// Public transport boundary, independent of React and business commands.
export function createWorkbenchRealtimeClient(options:RealtimeClientOptions){
  const interval=options.capability.polling_interval_ms;
  if(!Number.isInteger(interval)||interval<1000||interval>300000||options.capability.sse_endpoint!==(options.capability.realtime_sse_enabled?'/api/realtime/events?scope=workbench':null))throw new TypeError('WORKBENCH_REALTIME_CAPABILITY_INVALID');
  let disposed=false,blocked=false,online=true,visible=true,available=options.capability.realtime_sse_available;
  let source:RealtimeTransport|null=null,sourceEpoch=0,unlisten:(()=>void)[]=[],timer:unknown=null,request:AbortController|null=null;
  let running=false,pending=false,replacementAllowed=false,lastReadAt:number|null=null,status:WorkbenchRealtimeStatus=options.capability.realtime_sse_enabled?'connecting':'disabled';
  const alive=()=>!disposed&&!blocked&&online&&visible&&options.capability.realtime_sse_enabled;
  const report=(next:WorkbenchRealtimeStatus)=>{status=next;options.report({status,lastReadAt});};
  const cancelTimer=()=>{if(timer!==null)options.cancel(timer);timer=null;};
  function closeSource(){sourceEpoch++;for(const remove of unlisten)remove();unlisten=[];const old=source;source=null;old?.close();}
  function schedule(delay=interval){cancelTimer();if(alive())timer=options.schedule(()=>{timer=null;replacementAllowed=true;refresh();},delay);}
  function openSource(){
    if(!alive()||!available||source)return;
    replacementAllowed=false;
    const current=options.connect(options.capability.sse_endpoint as string),epoch=++sourceEpoch;source=current;
    const valid=()=>alive()&&source===current&&epoch===sourceEpoch;
    unlisten=[current.listen('open',()=>{if(valid()){report('live');refresh();}}),current.listen('error',()=>{if(valid()){report(current.state()===2?'polling':'reconnecting');refresh();}}),
      ...WORKBENCH_REALTIME_EVENT_TYPES.map(name=>current.listen(name,event=>{if(valid()){if(decodeWorkbenchRealtimeHint(event.data,name))options.onHint?.();refresh();}})),current.listen('message',()=>{if(valid()){options.onHint?.();refresh();}})];
    report('connecting');
  }
  function refresh(){
    if(!alive())return;
    if(running){pending=true;return;}running=true;pending=false;cancelTimer();
    const cycle=new AbortController();request=cycle;
    let expired=false;
    const deadline=new Promise<never>((_resolve,reject)=>{timer=options.schedule(()=>{timer=null;expired=true;cycle.abort();if(alive())report('offline');reject(new Error('WORKBENCH_REFRESH_TIMED_OUT'));},interval);});
    void Promise.race([options.refresh(cycle.signal),deadline]).then(result=>{
      if(!alive()||cycle.signal.aborted)return;
      available=result.available;lastReadAt=options.now();
      if(!available){closeSource();report('polling');}
      else if(!source||source.state()===2&&replacementAllowed){closeSource();openSource();}
      else report(source.state()===2?'polling':source.state()===1?'live':'reconnecting');
    }).catch(error=>{
      if(disposed||cycle.signal.aborted)return;
      if(options.authorizationDenied(error)){blocked=true;closeSource();cancelTimer();report('auth-blocked');}
      else report('offline');
    }).finally(()=>{
      cancelTimer();
      if(request===cycle)request=null;running=false;
      if(!alive())return;
      if(pending&&!expired){pending=false;refresh();}else {pending=false;schedule(expired?0:interval);}
    });
  }
  options.report({status,lastReadAt});
  if(options.capability.realtime_sse_enabled){if(available)openSource();else report('polling');schedule();}
  return {
    dispose(){if(disposed)return;disposed=true;pending=false;cancelTimer();closeSource();request?.abort();},
    setEnvironment(nextOnline:boolean,nextVisible:boolean){
      if(disposed||online===nextOnline&&visible===nextVisible)return;
      online=nextOnline;visible=nextVisible;
      if(!alive()){cancelTimer();closeSource();pending=false;request?.abort();if(!online)report('offline');}
      else refresh();
    },
  };
}
