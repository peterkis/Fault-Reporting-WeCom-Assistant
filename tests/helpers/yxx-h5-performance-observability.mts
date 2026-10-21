import type {IncomingMessage} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import type {ApplicationMemberVerificationEvent} from '../../src/wecom-application-member.mjs';

export interface PerformanceMemberVerificationOperation {
  operation_id:string;purpose:'BASE'|'H5_ENTRY';request_key:string|null;request_id:string|null;
  queued_at_ms:number;started_at_ms:number|null;settled_at_ms:number|null;
  queue_ms:number|null;active_ms:number|null;total_ms:number|null;outcome:'FULFILLED'|'REJECTED'|null;
}
export interface PerformanceMemberVerificationSnapshot {
  schema_version:1;enabled:boolean;scope:'ONE_SHARED_APP_MEMBER_VERIFIER';events:ApplicationMemberVerificationEvent[];operations:PerformanceMemberVerificationOperation[];
  observed_max:{active:number;base_active:number;h5_entry_active:number;pending:number};final:{active:number;base_active:number;pending:number};integrity_errors:string[];
  semantics:{queue_ms:string;active_ms:string;pending:string};
}

export interface PerformanceBatchContext {
  readonly batch_id:string;
  readonly phase:'shared'|'control';
  readonly participants:readonly string[];
  readonly participant_timings:readonly Readonly<{participant_id:string;queued_at_ms:number;sealed_at_ms:number}>[];
}
export interface PerformanceBatchTiming {
  readonly received_at_ms:number;
  readonly queued_at_ms?:number;
  readonly sealed_at_ms?:number;
  readonly sql_started_at_ms?:number;
  readonly sql_finished_at_ms?:number;
  readonly terminal_started_at_ms?:number;
  readonly terminal_finished_at_ms?:number;
  readonly closed_at_ms?:number;
  readonly outcome?:'queued'|'reading'|'terminal'|'committed'|'cancelled'|'rejected'|'failed';
}
export interface PerformanceReadDependency {statement_id:string;kind:'DIRECT'|'SHARED';batch_id:string|null;phase:'direct'|'initial'|'shared'|'final'}
export interface H5PerformanceTrace {
  id:string;trace_key:string;path:string;view:string|null;started_ms:number;elapsed_ms:number;sql:number;business_selects:number;sql_ms:number;
  provider_calls:number;provider_ms:number;provider_outcomes:{completed:number;aborted:number;error:number};
  member_verifications:PerformanceMemberVerificationOperation[];
  http_response_outcome:'PENDING'|'FINISHED'|'CLOSED';
  pool_wait_ms:number;pool_connections:number;other_ms:number;status:number;
  sql_errors:{sha256:string;code:string;statement_id:string;owner:'REQUEST'|'BATCH'|'SETUP'}[];
  sql_statement_ids:string[];shared_statement_ids:string[];read_dependencies:PerformanceReadDependency[];
  sql_shared_dependency_ms:number;pool_wait_shared_dependency_ms:number;batch_timing:PerformanceBatchTiming|null;measurement_errors:string[];
}
type SqlOwner={kind:'REQUEST'|'BATCH'|'SETUP';batch_id:string|null;phase:'direct'|'shared'|'control';participant_ids:string[];request_keys:string[];request_ids:string[]};
export interface PhysicalSqlStatement extends SqlOwner {
  statement_id:string;sha256:string;business_select:boolean;mode:'CONNECTED_CLIENT'|'POOL_QUERY_WITH_INTERNAL_CHECKOUT';
  started_ms:number;finished_ms:number|null;awaited_ms:number|null;outcome:'PENDING'|'SUCCEEDED'|'FAILED';error_code:string|null;
}
export interface PhysicalPoolCheckout extends SqlOwner {
  checkout_id:string;started_ms:number;finished_ms:number|null;wait_ms:number|null;outcome:'PENDING'|'SUCCEEDED'|'FAILED';error_code:string|null;
}
export interface PerformanceSqlLedgerSnapshot {
  schema_version:1;scope:'INSTRUMENTED_APP_POOL';statements:PhysicalSqlStatement[];pool_checkouts:PhysicalPoolCheckout[];integrity_errors:string[];
  semantics:{physical_statements:string;sql_ms:string;shared_dependency_ms:string;pool_wait_ms:string;batch_queue_ms:string};
}
function errorCode(error:unknown):string {
  return error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Za-z0-9_]{1,64}$/u.test(error.code)?error.code:'UNCLASSIFIED';
}

/** No request headers, scope values, SQL text, parameters or DTOs enter this ledger. */
export class H5PerformanceSqlLedger {
  private readonly traceRequests=new WeakMap<H5PerformanceTrace,IncomingMessage>();
  private readonly participants=new Map<string,H5PerformanceTrace>();
  private readonly traces=new Map<string,H5PerformanceTrace>();
  private readonly operationTraces=new WeakMap<object,readonly H5PerformanceTrace[]>();
  private readonly batches=new Map<string,readonly string[]>();
  private readonly statements:PhysicalSqlStatement[]=[];
  private readonly statementsById=new Map<string,PhysicalSqlStatement>();
  private readonly checkouts:PhysicalPoolCheckout[]=[];
  private readonly errors:string[]=[];
  private contextReader:()=>PerformanceBatchContext|undefined=()=>undefined;
  private timingReader:(request:IncomingMessage)=>PerformanceBatchTiming|undefined=()=>undefined;
  private participantReader:(request:IncomingMessage)=>string|undefined=()=>undefined;
  constructor(private readonly now:()=>number=()=>performance.now()){}
  setBatchReaders(context:()=>PerformanceBatchContext|undefined,timing:(request:IncomingMessage)=>PerformanceBatchTiming|undefined,participant:(request:IncomingMessage)=>string|undefined):void {this.contextReader=context;this.timingReader=timing;this.participantReader=participant;}
  createTrace(id:string,pathname:string,view:string|null=null):H5PerformanceTrace {
    const trace:H5PerformanceTrace={id,trace_key:'trace-'+(this.traces.size+1),path:pathname,view:view&&/^[a-z]{1,32}$/u.test(view)?view:null,started_ms:this.now(),elapsed_ms:0,sql:0,business_selects:0,sql_ms:0,provider_calls:0,provider_ms:0,provider_outcomes:{completed:0,aborted:0,error:0},member_verifications:[],http_response_outcome:'PENDING',pool_wait_ms:0,pool_connections:0,other_ms:0,status:0,sql_errors:[],sql_statement_ids:[],shared_statement_ids:[],read_dependencies:[],sql_shared_dependency_ms:0,pool_wait_shared_dependency_ms:0,batch_timing:null,measurement_errors:[]};
    this.traces.set(trace.trace_key,trace);return trace;
  }
  bindRequest(request:IncomingMessage,trace:H5PerformanceTrace):void {this.traceRequests.set(trace,request);}
  private owner(direct:H5PerformanceTrace|undefined):{owner:SqlOwner;traces:readonly H5PerformanceTrace[]} {
    const request=direct?this.traceRequests.get(direct):undefined,participant=request?this.participantReader(request):undefined;
    if(direct&&participant){const previous=this.participants.get(participant);if(previous&&previous!==direct)this.errors.push('PARTICIPANT_ID_REUSED');else this.participants.set(participant,direct);}
    const batch=this.contextReader();
    if(!batch)return {owner:{kind:direct?'REQUEST':'SETUP',batch_id:null,phase:'direct',participant_ids:participant?[participant]:[],request_keys:direct?[direct.trace_key]:[],request_ids:direct?[direct.id]:[]},traces:direct?[direct]:[]};
    // A batch takes precedence over the first HTTP's inherited asynchronous context.
    const batchId=/^[A-Za-z0-9_-]{1,128}$/u.test(batch.batch_id)?batch.batch_id:'INVALID_BATCH_ID';
    if(batchId!==batch.batch_id)this.errors.push('INVALID_BATCH_ID');
    const traces:H5PerformanceTrace[]=[];
    for(const id of batch.participants){const trace=this.participants.get(id);if(!trace){this.errors.push('UNMAPPED_BATCH_PARTICIPANT');continue;}if(traces.includes(trace)){this.errors.push('DUPLICATE_BATCH_PARTICIPANT');continue;}traces.push(trace);}
    const keys=traces.map(trace=>trace.trace_key),existing=this.batches.get(batchId);
    if(existing&&(existing.length!==keys.length||existing.some((key,index)=>key!==keys[index])))this.errors.push('SEALED_BATCH_PARTICIPANTS_CHANGED');else if(!existing)this.batches.set(batchId,keys);
    for(const participant of batch.participant_timings){
      if(!batch.participants.includes(participant.participant_id)||!Number.isFinite(participant.queued_at_ms)||!Number.isFinite(participant.sealed_at_ms)||participant.sealed_at_ms<participant.queued_at_ms)this.errors.push('INVALID_BATCH_PARTICIPANT_TIMING');
    }
    if(batch.participant_timings.length!==batch.participants.length||batch.participants.some(id=>batch.participant_timings.filter(item=>item.participant_id===id).length!==1))this.errors.push('MISSING_BATCH_PARTICIPANT_TIMING');
    return {owner:{kind:'BATCH',batch_id:batchId,phase:batch.phase,participant_ids:[...batch.participants],request_keys:keys,request_ids:traces.map(trace=>trace.id)},traces};
  }
  beginStatement(input:{sha256:string;business_select:boolean;mode:PhysicalSqlStatement['mode']},direct:H5PerformanceTrace|undefined):PhysicalSqlStatement {
    const {owner,traces}=this.owner(direct),statement:PhysicalSqlStatement={...owner,...input,statement_id:'sql-'+(this.statements.length+1),started_ms:this.now(),finished_ms:null,awaited_ms:null,outcome:'PENDING',error_code:null};
    this.statements.push(statement);this.statementsById.set(statement.statement_id,statement);this.operationTraces.set(statement,traces);
    for(const trace of traces){
      if(owner.kind==='BATCH'){
        trace.shared_statement_ids.push(statement.statement_id);
        if(input.business_select&&owner.phase==='shared')trace.read_dependencies.push({statement_id:statement.statement_id,kind:'SHARED',batch_id:owner.batch_id,phase:'shared'});
      }else{
        trace.sql++;trace.sql_statement_ids.push(statement.statement_id);
        if(input.business_select){trace.business_selects++;trace.read_dependencies.push({statement_id:statement.statement_id,kind:'DIRECT',batch_id:null,phase:'direct'});}
      }
    }
    return statement;
  }
  finishStatement(statement:PhysicalSqlStatement,error?:unknown):void {
    if(statement.finished_ms!==null){this.errors.push('DUPLICATE_STATEMENT_FINISH');return;}
    statement.finished_ms=this.now();statement.awaited_ms=statement.finished_ms-statement.started_ms;statement.outcome=error===undefined?'SUCCEEDED':'FAILED';statement.error_code=error===undefined?null:errorCode(error);
    for(const trace of this.operationTraces.get(statement)??[]){
      if(statement.kind==='BATCH')trace.sql_shared_dependency_ms+=statement.awaited_ms;else trace.sql_ms+=statement.awaited_ms;
      if(statement.error_code)trace.sql_errors.push({sha256:statement.sha256,code:statement.error_code,statement_id:statement.statement_id,owner:statement.kind});
    }
  }
  beginCheckout(direct:H5PerformanceTrace|undefined):PhysicalPoolCheckout {
    const {owner,traces}=this.owner(direct),checkout:PhysicalPoolCheckout={...owner,checkout_id:'checkout-'+(this.checkouts.length+1),started_ms:this.now(),finished_ms:null,wait_ms:null,outcome:'PENDING',error_code:null};
    this.checkouts.push(checkout);this.operationTraces.set(checkout,traces);if(owner.kind!=='BATCH')for(const trace of traces)trace.pool_connections++;return checkout;
  }
  finishCheckout(checkout:PhysicalPoolCheckout,error?:unknown):void {
    if(checkout.finished_ms!==null){this.errors.push('DUPLICATE_CHECKOUT_FINISH');return;}
    checkout.finished_ms=this.now();checkout.wait_ms=checkout.finished_ms-checkout.started_ms;checkout.outcome=error===undefined?'SUCCEEDED':'FAILED';checkout.error_code=error===undefined?null:errorCode(error);
    for(const trace of this.operationTraces.get(checkout)??[]){if(checkout.kind==='BATCH')trace.pool_wait_shared_dependency_ms+=checkout.wait_ms;else trace.pool_wait_ms+=checkout.wait_ms;}
  }
  finishTrace(request:IncomingMessage,trace:H5PerformanceTrace,status:number,complete=true):void {
    trace.elapsed_ms=this.now()-trace.started_ms;trace.status=status;trace.http_response_outcome=complete?'FINISHED':'CLOSED';
    this.refreshTiming(request,trace);
    // The legacy residual includes shared work and local admission; it is never renamed as a queue measurement.
    trace.other_ms=Math.max(0,trace.elapsed_ms-trace.sql_ms-trace.provider_ms-trace.pool_wait_ms);
  }
  private refreshTiming(request:IncomingMessage,trace:H5PerformanceTrace):void {
    const timing=this.timingReader(request);trace.batch_timing=timing?{...timing}:null;
    for(const dependency of trace.read_dependencies){
      if(dependency.kind!=='DIRECT'||timing?.queued_at_ms===undefined)continue;
      const statement=this.statementsById.get(dependency.statement_id);
      if(!statement||statement.finished_ms===null){trace.measurement_errors.push('UNFINISHED_REQUEST_STATEMENT');continue;}
      if(statement.finished_ms<=timing.queued_at_ms)dependency.phase='initial';
      else if(timing.terminal_started_at_ms!==undefined&&statement.started_ms>=timing.terminal_started_at_ms)dependency.phase='final';
    }
  }
  inspectRead(trace:H5PerformanceTrace,kind:'BATCHED_HOME_OR_DEPARTMENT'|'REQUEST'|'UNCONSTRAINED'){
    const request=this.traceRequests.get(trace);if(request)this.refreshTiming(request,trace);
    return inspectH5PerformanceRead(trace,kind,id=>this.statementsById.get(id));
  }
  statementViews(statement:PhysicalSqlStatement):string[]{return [...new Set(statement.request_keys.flatMap(key=>{const view=this.traces.get(key)?.view;return view?[view]:[];}))].sort();}
  snapshot():PerformanceSqlLedgerSnapshot {
    const errors=[...this.errors];
    for(const statement of this.statements)if(statement.finished_ms===null||statement.awaited_ms===null||!Number.isFinite(statement.awaited_ms)||statement.awaited_ms<0)errors.push('UNFINISHED_OR_INVALID_STATEMENT');
    for(const checkout of this.checkouts)if(checkout.finished_ms===null||checkout.wait_ms===null||!Number.isFinite(checkout.wait_ms)||checkout.wait_ms<0)errors.push('UNFINISHED_OR_INVALID_CHECKOUT');
    for(const trace of this.traces.values()){
      const request=this.traceRequests.get(trace);if(request)this.refreshTiming(request,trace);
      const direct=this.statements.filter(statement=>statement.kind==='REQUEST'&&statement.request_keys.includes(trace.trace_key));
      if(direct.length!==trace.sql||direct.filter(statement=>statement.business_select).length!==trace.business_selects)errors.push('DIRECT_SQL_COUNT_MISMATCH');
      const directMs=direct.reduce((sum,statement)=>sum+(statement.awaited_ms??0),0);if(Math.abs(directMs-trace.sql_ms)>.001)errors.push('DIRECT_SQL_DURATION_MISMATCH');
      if(new Set(trace.shared_statement_ids).size!==trace.shared_statement_ids.length||new Set(trace.read_dependencies.map(item=>item.statement_id)).size!==trace.read_dependencies.length)errors.push('DUPLICATE_REQUEST_SQL_DEPENDENCY');
      errors.push(...trace.measurement_errors);
    }
    return {schema_version:1,scope:'INSTRUMENTED_APP_POOL',statements:this.statements.map(item=>({...item,participant_ids:[...item.participant_ids],request_keys:[...item.request_keys],request_ids:[...item.request_ids]})),pool_checkouts:this.checkouts.map(item=>({...item,participant_ids:[...item.participant_ids],request_keys:[...item.request_keys],request_ids:[...item.request_ids]})),integrity_errors:errors,semantics:{physical_statements:'Every real instrumented query appears exactly once. A shared statement has one physical owner and explicit participant links.',sql_ms:'Only request-owned awaited query calls; pool.query includes its internal checkout, connected-client query does not.',shared_dependency_ms:'Inclusive awaited batch statements associated with each participant; never sum these replicated dependency times as physical SQL throughput.',pool_wait_ms:'Explicit real pool.connect checkout, distinct from SQL calls and batch admission.',batch_queue_ms:'Use actual product queued_at_ms to sealed_at_ms timestamps; no residual-based queue estimate.'}};
  }
}

/** One ledger for both purposes. Only QUEUED associates a real HTTP context. */
export class H5PerformanceMemberVerificationLedger {
  private readonly operations=new Map<string,PerformanceMemberVerificationOperation>();
  private readonly events:ApplicationMemberVerificationEvent[]=[];
  private readonly errors:string[]=[];
  private readonly maxima={active:0,base_active:0,h5_entry_active:0,pending:0};
  private last={active:0,base_active:0,pending:0};
  constructor(readonly enabled=true){}
  observe(event:ApplicationMemberVerificationEvent,context:H5PerformanceTrace|undefined):void {
    if(!this.enabled){this.errors.push('VERIFICATION_EVENT_WHILE_DISABLED');return;}
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(event.operation_id)){this.errors.push('INVALID_VERIFICATION_OPERATION_ID');return;}
    const common={operation_id:event.operation_id,purpose:event.purpose,at_ms:event.at_ms,queued_at_ms:event.queued_at_ms,active:event.active,base_active:event.base_active,pending:event.pending};
    const safe:ApplicationMemberVerificationEvent=event.phase==='QUEUED'?{...common,phase:'QUEUED'}:event.phase==='STARTED'?{...common,phase:'STARTED',started_at_ms:event.started_at_ms}:{...common,phase:'SETTLED',started_at_ms:event.started_at_ms,outcome:event.outcome};
    this.events.push(safe);this.last={active:event.active,base_active:event.base_active,pending:event.pending};
    const h5=event.active-event.base_active;
    for(const field of ['active','base_active','pending'] as const)if(!Number.isSafeInteger(event[field])||event[field]<0)this.errors.push('INVALID_VERIFICATION_COUNTER');
    if(event.active>2||event.base_active>1||h5<0||h5>2||event.pending>32||event.active>event.pending)this.errors.push('VERIFICATION_SHARED_CAP_EXCEEDED');
    this.maxima.active=Math.max(this.maxima.active,event.active);this.maxima.base_active=Math.max(this.maxima.base_active,event.base_active);this.maxima.h5_entry_active=Math.max(this.maxima.h5_entry_active,h5);this.maxima.pending=Math.max(this.maxima.pending,event.pending);
    if(!Number.isFinite(event.at_ms)||!Number.isFinite(event.queued_at_ms)||event.at_ms<event.queued_at_ms)this.errors.push('INVALID_VERIFICATION_EVENT_TIME');
    let operation=this.operations.get(event.operation_id);
    if(event.phase==='QUEUED'){
      if(operation){this.errors.push('DUPLICATE_VERIFICATION_QUEUED');return;}
      operation={operation_id:event.operation_id,purpose:event.purpose,request_key:context?.trace_key??null,request_id:context?.id??null,queued_at_ms:event.queued_at_ms,started_at_ms:null,settled_at_ms:null,queue_ms:null,active_ms:null,total_ms:null,outcome:null};
      this.operations.set(event.operation_id,operation);if(context)context.member_verifications.push(operation);else this.errors.push('UNBOUND_VERIFICATION_QUEUED');
    }else{
      if(!operation){this.errors.push('VERIFICATION_EVENT_WITHOUT_QUEUED');return;}
      if(operation.purpose!==event.purpose||operation.queued_at_ms!==event.queued_at_ms)this.errors.push('VERIFICATION_IDENTITY_CHANGED');
      if(event.phase==='STARTED'){
        if(operation.started_at_ms!==null||operation.settled_at_ms!==null)this.errors.push('DUPLICATE_OR_LATE_VERIFICATION_STARTED');
        operation.started_at_ms=event.started_at_ms;operation.queue_ms=event.started_at_ms-operation.queued_at_ms;
        if(!Number.isFinite(event.started_at_ms)||event.started_at_ms<operation.queued_at_ms||event.started_at_ms>event.at_ms)this.errors.push('INVALID_VERIFICATION_STARTED_TIME');
      }else{
        if(operation.settled_at_ms!==null)this.errors.push('DUPLICATE_VERIFICATION_SETTLED');
        if(operation.started_at_ms!==event.started_at_ms)this.errors.push('VERIFICATION_SETTLED_START_MISMATCH');
        operation.settled_at_ms=event.at_ms;operation.total_ms=event.at_ms-operation.queued_at_ms;operation.active_ms=operation.started_at_ms===null?null:event.at_ms-operation.started_at_ms;operation.outcome=event.outcome;
        if(operation.active_ms!==null&&operation.active_ms<0)this.errors.push('INVALID_VERIFICATION_SETTLED_TIME');
      }
    }
    const live=[...this.operations.values()].filter(item=>item.settled_at_ms===null),active=live.filter(item=>item.started_at_ms!==null),base=active.filter(item=>item.purpose==='BASE');
    if(event.pending!==live.length||event.active!==active.length||event.base_active!==base.length)this.errors.push('VERIFICATION_EVENT_COUNTER_MISMATCH');
  }
  inspectTrace(trace:H5PerformanceTrace,purpose:'H5_ENTRY'|'UNCONSTRAINED'){
    const operations=trace.member_verifications,errors:string[]=[];
    if(purpose==='H5_ENTRY'){
      if(!this.enabled)errors.push('CURRENT_VERIFICATION_OBSERVER_REQUIRED');
      if(operations.length!==1||operations.some(item=>item.purpose!=='H5_ENTRY'))errors.push('ONE_H5_ENTRY_VERIFICATION_REQUIRED');
      if(operations.some(item=>item.started_at_ms===null||item.settled_at_ms===null||item.outcome!=='FULFILLED'||item.queue_ms===null||item.queue_ms<0||item.active_ms===null||item.active_ms<0))errors.push('COMPLETED_H5_ENTRY_VERIFICATION_REQUIRED');
    }
    return {status:this.enabled&&operations.length?'OBSERVED':'NOT_RUN',operation_count:operations.length,purposes:operations.map(item=>item.purpose),operation_ids:operations.map(item=>item.operation_id),queue_ms:operations.length&&operations.every(item=>item.queue_ms!==null)?operations.reduce((sum,item)=>sum+(item.queue_ms??0),0):null,active_ms:operations.length&&operations.every(item=>item.active_ms!==null)?operations.reduce((sum,item)=>sum+(item.active_ms??0),0):null,total_ms:operations.length&&operations.every(item=>item.total_ms!==null)?operations.reduce((sum,item)=>sum+(item.total_ms??0),0):null,integrity_errors:errors};
  }
  snapshot():PerformanceMemberVerificationSnapshot {
    const errors=[...this.errors];for(const operation of this.operations.values())if(operation.settled_at_ms===null)errors.push('UNSETTLED_VERIFICATION_OPERATION');
    if(this.last.active!==0||this.last.base_active!==0||this.last.pending!==0)errors.push('VERIFICATION_FINAL_COUNTER_NOT_ZERO');
    return {schema_version:1,enabled:this.enabled,scope:'ONE_SHARED_APP_MEMBER_VERIFIER',events:this.events.map(item=>({...item})),operations:[...this.operations.values()].map(item=>({...item})),observed_max:{...this.maxima},final:{...this.last},integrity_errors:errors,semantics:{queue_ms:'Actual STARTED.started_at_ms minus QUEUED.queued_at_ms; never HTTP residual. Null when cancelled before STARTED.',active_ms:'Actual SETTLED.at_ms minus STARTED.started_at_ms; retains slots until the underlying lookup truly settles and includes token/read/parse work, distinct from the fixed fetch delay.',pending:'One shared App population including active, queued and caller-expired lookups whose underlying work has not settled; not independent per-purpose capacities.'}};
  }
}

/** Logical dependency counts and physical executions are deliberately separate. */
export function inspectH5PerformanceRead(trace:H5PerformanceTrace,kind:'BATCHED_HOME_OR_DEPARTMENT'|'REQUEST'|'UNCONSTRAINED',statement:(id:string)=>Readonly<PhysicalSqlStatement>|undefined){
  const direct=trace.read_dependencies.filter(item=>item.kind==='DIRECT'),shared=trace.read_dependencies.filter(item=>item.kind==='SHARED');
  const phases={initial:direct.filter(item=>item.phase==='initial').length,shared:shared.length,final:direct.filter(item=>item.phase==='final').length,other:direct.filter(item=>item.phase==='direct').length};
  const errors=[...trace.measurement_errors],timing=trace.batch_timing;
  if(trace.business_selects!==direct.length)errors.push('DIRECT_READ_COUNT_MISMATCH');
  if(kind==='REQUEST'&&(direct.length!==6||shared.length!==0))errors.push('REQUEST_SIX_DIRECT_READS_REQUIRED');
  if(kind==='BATCHED_HOME_OR_DEPARTMENT'){
    if(direct.length!==2||shared.length!==1||phases.initial!==1||phases.final!==1||phases.other!==0)errors.push('INITIAL_SHARED_FINAL_READS_REQUIRED');
    if(!timing||timing.queued_at_ms===undefined||timing.sealed_at_ms===undefined||timing.sql_started_at_ms===undefined||timing.sql_finished_at_ms===undefined||timing.terminal_started_at_ms===undefined||timing.terminal_finished_at_ms===undefined||timing.closed_at_ms===undefined||timing.outcome!=='committed')errors.push('COMMITTED_BATCH_TIMING_REQUIRED');
    else if(![timing.received_at_ms,timing.queued_at_ms,timing.sealed_at_ms,timing.sql_started_at_ms,timing.sql_finished_at_ms,timing.terminal_started_at_ms,timing.terminal_finished_at_ms,timing.closed_at_ms].every((value,index,values)=>Number.isFinite(value)&&(index===0||value>=(values[index-1]??Infinity))))errors.push('NON_MONOTONIC_BATCH_TIMING');
    const initial=direct.find(item=>item.phase==='initial'),final=direct.find(item=>item.phase==='final');
    if(!initial||!final||statement(initial.statement_id)?.sha256!==statement(final.statement_id)?.sha256)errors.push('INITIAL_FINAL_PROOF_STATEMENT_MISMATCH');
  }
  for(const dependency of trace.read_dependencies){const physical=statement(dependency.statement_id);if(!physical||!physical.business_select||physical.outcome==='PENDING'||!physical.request_keys.includes(trace.trace_key))errors.push('INVALID_PHYSICAL_READ_LINK');else if(dependency.kind==='SHARED'&&(physical.kind!=='BATCH'||physical.phase!=='shared'||physical.batch_id!==dependency.batch_id||physical.outcome!=='SUCCEEDED'))errors.push('INVALID_SHARED_READ_OWNER');}
  return {direct_business_selects:direct.length,shared_business_selects:shared.length,read_participations:direct.length+shared.length,phases,
    batch_queue_ms:timing?.queued_at_ms!==undefined&&timing.sealed_at_ms!==undefined?timing.sealed_at_ms-timing.queued_at_ms:null,
    batch_shared_checkout_ms:trace.pool_wait_shared_dependency_ms,sql_direct_awaited_ms:trace.sql_ms,sql_shared_dependency_ms:trace.sql_shared_dependency_ms,
    statement_ids:trace.read_dependencies.map(item=>item.statement_id),failed_sql_dependencies:trace.read_dependencies.filter(item=>statement(item.statement_id)?.outcome==='FAILED').map(item=>({statement_id:item.statement_id,error_code:statement(item.statement_id)?.error_code??null})),integrity_errors:errors};
}

export async function recordH5PerformanceProviderDelay(context:Pick<H5PerformanceTrace,'provider_calls'|'provider_ms'|'provider_outcomes'>|undefined,signal?:AbortSignal):Promise<void> {
  const started=performance.now();if(context)context.provider_calls++;let outcome:'completed'|'aborted'|'error'='completed';
  try{await delay(100,undefined,{signal});}catch(error){outcome=signal?.aborted?'aborted':'error';throw error;}
  finally{if(context){context.provider_ms+=performance.now()-started;context.provider_outcomes[outcome]++;}}
}
