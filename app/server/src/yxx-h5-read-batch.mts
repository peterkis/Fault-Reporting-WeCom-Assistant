import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {PostgresPool,PostgresPoolClient,PostgresTransaction,PostgresQueryRow} from './platform/postgres-pool.mjs';
import {buildH5BatchReadStatement,type H5BatchSqlInput,type H5BatchShape} from './yxx-h5-batch-sql.mjs';

export const H5_READ_BATCH_LIMITS=Object.freeze({participants:20,batch:10,inputBytes:256*1024,resultBytes:4*1024*1024,deadlineMs:5000});
type Outcome='queued'|'reading'|'terminal'|'committed'|'cancelled'|'rejected'|'failed';
export interface H5ReadBatchTiming {readonly received_at_ms:number;readonly queued_at_ms?:number;readonly sealed_at_ms?:number;readonly sql_started_at_ms?:number;readonly sql_finished_at_ms?:number;readonly terminal_started_at_ms?:number;readonly terminal_finished_at_ms?:number;readonly closed_at_ms?:number;readonly outcome?:Outcome}
export interface H5ReadBatchContext {readonly batch_id:string;readonly phase:'shared'|'control';readonly participants:readonly string[];readonly participant_timings:readonly {readonly participant_id:string;readonly queued_at_ms:number;readonly sealed_at_ms:number}[]}
const association=new AsyncLocalStorage<H5ReadBatchContext>();
const times=new WeakMap<IncomingMessage,H5ReadBatchTiming>();
const received=new WeakMap<IncomingMessage,{at:number;closed:boolean;id:string}>();
export const getH5ReadBatchContext=()=>association.getStore();
export const getH5ReadBatchTiming=(request:IncomingMessage)=>times.get(request);
export const getH5ReadParticipantId=(request:IncomingMessage)=>received.get(request)?.id;
export function beginH5Read(request:IncomingMessage){const before=received.get(request);if(!before||before.closed){const at=performance.now();received.set(request,{at,closed:false,id:randomUUID()});times.set(request,Object.freeze({received_at_ms:at}));}}
function failure(code='YXX_UNAVAILABLE',status=503){return Object.assign(new Error(code),{code,status});}
export function checkH5Read(request:IncomingMessage){const start=received.get(request);if(start&&performance.now()-start.at>=H5_READ_BATCH_LIMITS.deadlineMs)throw failure('YXX_READ_TIMEOUT');}
function timing(request:IncomingMessage,patch:Partial<H5ReadBatchTiming>){const prior=times.get(request);if(prior)times.set(request,Object.freeze({...prior,...patch}));}
export function finishH5Read(request:IncomingMessage,outcome:Outcome){const start=received.get(request);if(start)start.closed=true;timing(request,{closed_at_ms:performance.now(),outcome});}
export interface H5ReadBudget {readonly request:IncomingMessage;readonly signal:AbortSignal;readonly deadline:number;check():void;remaining():number;wait<T>(work:Promise<T>):Promise<T>;abort():void;finish(outcome:Outcome):void}
export function createH5ReadBudget(request:IncomingMessage):H5ReadBudget{
  beginH5Read(request);const start=received.get(request);if(!start)throw failure();const controller=new AbortController(),deadline=start.at+H5_READ_BATCH_LIMITS.deadlineMs;
  const cancel=()=>controller.abort(failure('YXX_REQUEST_ABORTED'));
  request.once('aborted',cancel);request.socket.once('close',cancel);
  const timer=setTimeout(()=>controller.abort(failure('YXX_READ_TIMEOUT')),Math.max(0,deadline-performance.now()));timer.unref();
  const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;checkH5Read(request);};
  if(request.aborted||request.socket.destroyed)cancel();
  return {request,signal:controller.signal,deadline,check,remaining:()=>Math.max(0,Math.floor(deadline-performance.now())),
    wait<T>(work:Promise<T>):Promise<T>{return new Promise<T>((resolve,reject)=>{const abort=()=>reject(controller.signal.reason);if(controller.signal.aborted){void work.catch(()=>undefined);reject(controller.signal.reason);return;}controller.signal.addEventListener('abort',abort,{once:true});work.then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort)).catch(()=>undefined);});},
    abort:cancel,finish(outcome){clearTimeout(timer);request.removeListener('aborted',cancel);request.socket.removeListener('close',cancel);start.closed=true;timing(request,{closed_at_ms:performance.now(),outcome});}};
}
interface Slot {readonly id:number;readonly budget:H5ReadBudget;readonly input:H5BatchSqlInput;readonly shape:H5BatchShape;readonly queued:number;readonly inputBytes:number;resultBytes:number;resolve:(row:H5BatchResult)=>void;reject:(error:unknown)=>void;outerDone:boolean;executing:boolean;released:boolean;abort:()=>void;payload:H5BatchResult|null}
export interface H5BatchResult {readonly proof:unknown;readonly data:unknown}
export interface H5ReadLease {readonly result:Promise<H5BatchResult>;release():void}
export function createH5ReadBatch({pool}:{pool:PostgresPool}){
  const slots=new Set<Slot>(),budgets=new Set<H5ReadBudget>(),finished=new Set<H5ReadBudget>(),work=new Map<H5ReadBudget,number>(),transactions=new Set<Promise<unknown>>();let queue:Slot[]=[],active:Promise<void>|null=null,closed=false,nextId=0,closing:Promise<void>|null=null,inputBytes=0,resultBytes=0;
  function retire(budget:H5ReadBudget){if(finished.has(budget)&&!work.get(budget)&&![...slots].some(slot=>slot.budget===budget)){finished.delete(budget);budgets.delete(budget);}}
  function track<T>(budget:H5ReadBudget,promise:Promise<T>):Promise<T>{work.set(budget,(work.get(budget)??0)+1);transactions.add(promise);void promise.finally(()=>{transactions.delete(promise);const left=(work.get(budget)??1)-1;if(left)work.set(budget,left);else work.delete(budget);retire(budget);}).catch(()=>undefined);return promise;}
  function drop(slot:Slot){if(slot.released||!slot.outerDone||slot.executing)return;slot.released=true;slot.payload=null;inputBytes-=slot.inputBytes;resultBytes-=slot.resultBytes;slot.resultBytes=0;slot.budget.signal.removeEventListener('abort',slot.abort);slots.delete(slot);retire(slot.budget);}
  async function discardUnusedClient(client:PostgresPoolClient){
    let removed=()=>{};const ended=new Promise<void>(resolve=>{removed=resolve;});
    const onRemove=(actual:PostgresPoolClient)=>{if(actual===client)removed();};
    pool.on('remove',onRemove);
    try{client.release(true);await ended;}finally{pool.removeListener('remove',onRemove);}
  }
  async function nativeTransaction<T>(budget:H5ReadBudget,run:(tx:PostgresTransaction)=>Promise<T>):Promise<T>{
    const client=await pool.connect();let destroyed=false;
    // A late checkout has not started server work and can be discarded. Once a
    // query starts, keep the native connection until the server acknowledges its
    // result/statement_timeout and the transaction is really rolled back.
    try{budget.check();}catch(error){await discardUnusedClient(client);throw error;}
    const tx:PostgresTransaction={query<R extends PostgresQueryRow=Record<string,unknown>>(text:string,values?:unknown[]){budget.check();return client.query<R>(text,values);}};
    try{
      budget.check();await client.query('BEGIN');budget.check();await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      budget.check();await client.query('SET LOCAL statement_timeout = '+Math.max(1,budget.remaining()));budget.check();
      const result=await run(tx);budget.check();await client.query('COMMIT');return result;
    }catch(error){
      try{await client.query('ROLLBACK');}catch{destroyed=true;client.release(true);}
      if(budget.signal.aborted)throw budget.signal.reason;throw error;
    }finally{if(!destroyed)client.release();}
  }
  function transaction<T>(budget:H5ReadBudget,run:(tx:PostgresTransaction)=>Promise<T>){budget.check();return budget.wait(track(budget,nativeTransaction(budget,run)));}
  function open(request:IncomingMessage){if(closed)throw failure();if(budgets.size>=H5_READ_BATCH_LIMITS.participants)throw failure('YXX_READ_BUSY',429);const acquireTimeout=pool.options.connectionTimeoutMillis;if(typeof acquireTimeout!=='number'||!Number.isSafeInteger(acquireTimeout)||acquireTimeout<=0||acquireTimeout>5000)throw failure('YXX_READ_POOL_UNBOUNDED');const budget=createH5ReadBudget(request);budgets.add(budget);return budget;}
  function finish(budget:H5ReadBudget,outcome:Outcome){budget.finish(outcome);finished.add(budget);retire(budget);}
  async function execute(batch:readonly Slot[]){
    const participantId=(slot:Slot)=>{const id=getH5ReadParticipantId(slot.budget.request);if(!id)throw failure('YXX_READ_PARTICIPANT_INVALID');return id;};
    const batchId=randomUUID(),sealed=performance.now(),participants=Object.freeze(batch.map(participantId)),participantTimings=Object.freeze(batch.map(slot=>Object.freeze({participant_id:participantId(slot),queued_at_ms:slot.queued,sealed_at_ms:sealed}))),context:H5ReadBatchContext=Object.freeze({batch_id:batchId,phase:'control',participants,participant_timings:participantTimings});
    for(const slot of batch){slot.executing=true;timing(slot.budget.request,{sealed_at_ms:sealed,outcome:'reading'});}
    await association.run(context,async()=>{
      let client:PostgresPoolClient|null=null,destroyed=false;
      const live=()=>batch.filter(slot=>!slot.budget.signal.aborted&&!slot.outerDone&&slot.budget.remaining()>0);
      const requireLive=()=>{const current=live();if(!current.length)throw failure('YXX_REQUEST_ABORTED');return current;};
      try{
        client=await pool.connect();
        if(!live().length){const unused=client;client=null;await discardUnusedClient(unused);throw failure('YXX_REQUEST_ABORTED');}
        requireLive();await client.query('BEGIN');requireLive();await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        requireLive();await client.query("SET LOCAL work_mem='16MB'");requireLive();await client.query('SET LOCAL hash_mem_multiplier=2');requireLive();await client.query('SET LOCAL max_parallel_workers_per_gather=0');
        await client.query('SET LOCAL statement_timeout = '+Math.max(1,Math.max(...requireLive().map(slot=>slot.budget.remaining()))));
        const remainingBytes=H5_READ_BATCH_LIMITS.resultBytes-resultBytes;if(remainingBytes<4096)throw failure('YXX_READ_BUSY',429);
        const statement=buildH5BatchReadStatement(batch[0]?.shape??'home',batch.map(slot=>({slot:slot.id,...slot.input})),remainingBytes);
        requireLive();
        const started=performance.now();for(const slot of batch)timing(slot.budget.request,{sql_started_at_ms:started});
        const result=await association.run(Object.freeze({...context,phase:'shared' as const}),()=>client?.query<{body:string}>(statement.text,statement.values));
        const ended=performance.now();for(const slot of batch)timing(slot.budget.request,{sql_finished_at_ms:ended});
        let body=result?.rows[0]?.body;if(typeof body!=='string'||Buffer.byteLength(body)>remainingBytes)throw failure('YXX_READ_RESPONSE_LIMIT');
        const value:unknown=JSON.parse(body);body=undefined;if(result)result.rows.length=0;if(!Array.isArray(value))throw failure('YXX_QUERY_ROW_INVALID');
        const rows:{slot:number;status:'READY'|'FORBIDDEN'|'TOO_LARGE';proof:unknown;data:unknown}[]=value.map((row:unknown)=>{if(!row||typeof row!=='object'||Array.isArray(row)||!('slot' in row)||typeof row.slot!=='number'||!('status' in row)||(row.status!=='READY'&&row.status!=='FORBIDDEN'&&row.status!=='TOO_LARGE')||!('proof' in row)||!('data' in row))throw failure('YXX_QUERY_ROW_INVALID');return {slot:row.slot,status:row.status,proof:row.proof,data:row.data};});
        if(rows.length!==batch.length||new Set(rows.map(row=>row.slot)).size!==batch.length||rows.some(row=>!batch.some(slot=>slot.id===row.slot)))throw failure('YXX_QUERY_ROW_INVALID');
        await client.query('COMMIT');client.release();client=null;
        for(const slot of batch){const row=rows.find(item=>item.slot===slot.id);if(!row)throw failure('YXX_QUERY_ROW_INVALID');if(slot.budget.signal.aborted||slot.outerDone)continue;
          if(row.status!=='READY'){slot.reject(failure(row.status==='FORBIDDEN'?'YXX_FORBIDDEN':'YXX_READ_RESPONSE_LIMIT',row.status==='FORBIDDEN'?403:503));continue;}
          const payload={proof:row.proof,data:row.data},bytes=Buffer.byteLength(JSON.stringify(payload));if(resultBytes+bytes>H5_READ_BATCH_LIMITS.resultBytes)throw failure('YXX_READ_RESPONSE_LIMIT');slot.resultBytes=bytes;resultBytes+=bytes;
          slot.payload=payload;timing(slot.budget.request,{outcome:'terminal'});association.exit(()=>slot.resolve(payload));}
        rows.length=0;
      }catch(error){if(client&&!destroyed)try{await client.query('ROLLBACK');}catch{destroyed=true;client.release(true);}for(const slot of batch)if(!slot.outerDone)association.exit(()=>slot.reject(error));}
      finally{if(client&&!destroyed)client.release();for(const slot of batch){slot.executing=false;drop(slot);}}
    });
  }
  function pump(){if(closed||active)return;queue=queue.filter(slot=>!slot.outerDone&&!slot.budget.signal.aborted);const first=queue[0];if(!first)return;const batch:Slot[]=[];while(queue[0]?.shape===first.shape&&batch.length<H5_READ_BATCH_LIMITS.batch){const slot=queue.shift();if(slot)batch.push(slot);}active=execute(Object.freeze(batch));void active.finally(()=>{active=null;pump();}).catch(()=>undefined);}
  function enqueue(budget:H5ReadBudget,shape:H5BatchShape,input:H5BatchSqlInput):H5ReadLease{
    budget.check();if(closed)throw failure();if(slots.size>=H5_READ_BATCH_LIMITS.participants)throw failure('YXX_READ_BUSY',429);
    const id=++nextId,bytes=Buffer.byteLength(JSON.stringify({slot:id,...input}))+1;if(inputBytes+bytes+1>H5_READ_BATCH_LIMITS.inputBytes)throw failure('YXX_READ_INPUT_LIMIT',429);
    let resolve!:(row:H5BatchResult)=>void,reject!:(error:unknown)=>void;const result=new Promise<H5BatchResult>((yes,no)=>{resolve=yes;reject=no;});
    const slot:Slot={id,budget,input,shape,inputBytes:bytes,resultBytes:0,queued:performance.now(),resolve,reject,outerDone:false,executing:false,released:false,payload:null,abort:()=>{reject(budget.signal.reason);queue=queue.filter(item=>item!==slot);drop(slot);}};
    inputBytes+=bytes;slots.add(slot);queue.push(slot);timing(budget.request,{queued_at_ms:slot.queued,outcome:'queued'});budget.signal.addEventListener('abort',slot.abort,{once:true});pump();
    return {result,release(){slot.outerDone=true;slot.payload=null;drop(slot);}};
  }
  async function close(){if(closing)return closing;closed=true;closing=(async()=>{for(const budget of budgets)budget.abort();for(const slot of slots){slot.outerDone=true;drop(slot);}queue=[];if(active)await active.catch(()=>undefined);await Promise.allSettled([...transactions]);for(const budget of budgets)budget.finish('cancelled');budgets.clear();})();return closing;}
  return Object.freeze({open,transaction,enqueue,finish,close,watch:<T,>(budget:H5ReadBudget,promise:Promise<T>)=>track(budget,promise),terminalStart:(budget:H5ReadBudget)=>timing(budget.request,{terminal_started_at_ms:performance.now(),outcome:'terminal'}),terminalEnd:(budget:H5ReadBudget)=>timing(budget.request,{terminal_finished_at_ms:performance.now()})});
}
