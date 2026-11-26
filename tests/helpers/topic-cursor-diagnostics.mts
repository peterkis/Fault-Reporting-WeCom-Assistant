// Test-side observer for the topic-history browser case. Cursor material and DB
// identities are private join keys. Only counts, comparisons and timings leave it.
import {createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../../app/server/src/p2-006-workbench-authorization.mjs';
import type {PostgresPool,PostgresPoolClient} from '../../app/server/src/platform/postgres-pool.mjs';
import type {T22Fixture} from './wbint-t22-fixture.mjs';

interface SessionFact {id:string;activity:string;state:string;chat_type:string;created_during_test:boolean;ttl_seconds:number;same_contact:boolean}
interface Snapshot {roles:readonly string[];teams:readonly string[];hash:string;sessions:Map<string,SessionFact>}
interface Boundary {anchor:string;at:string;scope:string}
interface ObservedCursorRead {cursor:Boundary;selected:string;proof:{rolesTeamsValid:boolean;selectedEligible:boolean;cursorValid:boolean;scopeMatchesCursor:boolean}|null}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null;
function boundary(token:string):Boundary|null{
  try{
    if(token.length>2048)return null;
    const v:unknown=JSON.parse(Buffer.from(token.split('.')[0]??'','base64url').toString());
    if(record(v)&&v.v===2&&typeof v.anchor==='string'&&typeof v.at==='string'&&typeof v.scope==='string')
      return {anchor:v.anchor,at:v.at,scope:v.scope};
  }catch{/* The endpoint owns validation. A malformed cursor is still observable. */}
  return null;
}

async function snapshot(pool:PostgresPool,reader:string,selected:string,started:number):Promise<Snapshot>{
  const auth=createPilotWorkbenchAuthorizationAdapter({pool});
  return transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await tx.query("SET LOCAL statement_timeout='2000ms'");
    const p=await auth.resolvePrincipal({principal_id:reader},{queryable:tx});
    const access=auth.sessionAccessPredicate(p,{ticketAlias:'tk',start:3});
    // relation()'s membership joins and its production READ predicate. The other
    // LEFT joins only decorate a row (PK, unique key, aggregate or LIMIT 1).
    const {rows}=await tx.query<SessionFact>(`SELECT s.id::text AS id,to_char(s.last_activity_at,'YYYY-MM-DD HH24:MI:SS') AS activity,
        s.status AS state,th.chat_type,s.created_at>=platform.local_from_epoch_ms($1::bigint) AS created_during_test,
        floor((i.retention_until_epoch_ms-platform.physical_epoch_ms())/1000.0)::integer AS ttl_seconds,
        EXISTS(SELECT 1 FROM conversation.session a JOIN conversation.thread t ON t.id=a.thread_id
          WHERE a.id=$2::uuid AND (t.provider,t.channel_account_id,a.participant_key)=(th.provider,th.channel_account_id,s.participant_key)) AS same_contact
      FROM conversation.session s JOIN conversation.thread th ON th.id=s.thread_id
      JOIN intake.service_intake i ON i.id=s.service_intake_id AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND i.source_provider=th.provider AND i.source_bot_id=th.channel_account_id AND i.reporter_wecom_userid=s.participant_key
      LEFT JOIN conversation.assignment a ON a.session_id=s.id LEFT JOIN pilot_ticket.ticket tk ON tk.source_intake_id=i.id
      WHERE ${access.sql} ORDER BY s.id::text`,[started,selected,...access.values]);
    // Same UTF-8 comma-separated, DB-sorted session IDs as readable_scope.
    return {roles:p?.roles??[],teams:p?.team_ids??[],hash:createHash('sha256').update(rows.map(r=>r.id).join(',')).digest('hex'),
      sessions:new Map(rows.map(r=>[r.id,r]))};
  });
}

const publicParts=new Set('api workbench conversations conversation-inbox summary items related-sessions read-cursor messages internal-notes commands presence heartbeat lifecycle bootstrap tickets actions assignment handoff takeover release refresh attachments realtime'.split(' '));
function routeTemplate(path:string){return path.split('/').map(part=>!part||publicParts.has(part)?part:':param').join('/');}

interface Write {operation:string;table:string;session?:string}
type ReadBrowser={evaluate:(expression:string)=>Promise<unknown>};
export class TopicCursorDiagnostics {
  private readonly start=performance.now();
  private readonly epoch=Math.floor(performance.timeOrigin+this.start);
  private readonly issued=new Map<string,{page:number;result:Promise<Snapshot|null>}>();
  private readonly pending=new Set<Promise<void>>();
  private readonly pages:Record<string,unknown>[]=[];
  private readonly checks:Record<string,unknown>[]=[];
  private readonly httpWrites:{ms:number;method:string;route:string}[]=[];
  private readonly writeBuckets=new Map<number,{firstMs:number;lastMs:number;statements:Record<string,number>}>();
  private readonly sessionUpserts=new Map<string,number>();
  private readonly pageStates:Record<string,unknown>[]=[];
  private readonly inFlight=new Set<ObservedCursorRead>();
  private nextPage=0;
  private stopped=false;
  private unavailable=0;
  private ms(){return Math.round(performance.now()-this.start);}
  private track(task:Promise<void>){
    const guarded=task.catch(()=>{this.unavailable++;});
    this.pending.add(guarded);void guarded.then(()=>this.pending.delete(guarded));
  }
  receipt(){return {cursorDiagnosticsUnavailable:this.unavailable,firstPages:this.pages,cursorCheck:this.checks,serverWrites:this.httpWrites,runtimeWrites:[...this.writeBuckets.values()],backPager:this.pageStates};}

  attach(f:T22Fixture){
    const reader=f.principals[0]?.id;
    const observe=(req:IncomingMessage,res:ServerResponse)=>{
      const url=URL.parse(req.url??'',f.origin);if(!url)return;
      if(req.method==='POST'||req.method==='PUT'||req.method==='PATCH')this.httpWrites.push({ms:this.ms(),method:req.method,route:routeTemplate(url.pathname)});
      const selected=/^\/api\/workbench\/conversations\/([0-9a-f-]{36})\/related-sessions$/iu.exec(url.pathname)?.[1];
      if(!selected||req.method!=='GET'||!reader)return;
      const token=url.searchParams.get('cursor'),baseline=token===null?undefined:this.issued.get(token);
      const decoded=token?boundary(token):null;
      const read:ObservedCursorRead|null=decoded?{cursor:decoded,selected,proof:null}:null;
      if(read){this.inFlight.add(read);res.once('close',()=>this.inFlight.delete(read));}
      const end=res.end;
      // This JSON endpoint uses end(string). Extract just the issued cursor or
      // public error code, without buffering chunks or altering the response.
      res.end=new Proxy(end,{apply:(fn,self,args)=>{
        res.end=end;
        if((res.statusCode===200&&token===null)||res.statusCode===400){
          let body:unknown;
          try{if(typeof args[0]==='string')body=JSON.parse(args[0]);}catch{/* log missing fields below */}
          const next=record(body)&&typeof body.next_cursor==='string'?body.next_cursor:null;
          const error=record(body)&&record(body.error)?body.error.code:null;
          const code=error==='WORKBENCH_CURSOR_INVALID'||error==='WORKBENCH_REQUEST_INVALID'?error:'other';
          const status=res.statusCode;
          res.once('finish',()=>{
            if(this.stopped)return;
            const ms=this.ms(),result=snapshot(f.pool,reader,selected,this.epoch).catch(()=>{this.unavailable++;return null;});
            if(status===200){
              const page=++this.nextPage,c=next?boundary(next):null;
              if(next)this.issued.set(next,{page,result});
              this.track(result.then(s=>{this.pages.push({page,ms,doneMs:this.ms(),count:s?.sessions.size??null,scopeMatchesIssued:s&&c?s.hash===c.scope:null,
                anchorMatchesIssued:s&&c?s.sessions.get(c.anchor)?.activity===c.at:null});}));
            }else{
              this.track(Promise.all([baseline?.result??null,result]).then(([before,after])=>{
                this.checks.push({ms,doneMs:this.ms(),page:baseline?.page??null,code,readProof:read?.proof??null,...this.compare(before,after,decoded)});
              }));
            }
          });
        }
        return Reflect.apply(fn,self,args);
      }});
    };
    f.runtime.server.prependListener('request',observe);
    return async()=>{
      this.stopped=true;f.runtime.server.off('request',observe);
      await Promise.all(this.pending);
      this.issued.clear();this.sessionUpserts.clear();this.inFlight.clear();
    };
  }

  private compare(before:Snapshot|null,after:Snapshot|null,c:Boundary|null){
    const added:SessionFact[]=[],removed:SessionFact[]=[],changed:SessionFact[]=[];
    if(before&&after){
      for(const row of after.sessions.values()){
        const old=before.sessions.get(row.id);
        if(!old)added.push(row);else if(old.activity!==row.activity)changed.push(row);
      }
      for(const row of before.sessions.values())if(!after.sessions.has(row.id))removed.push(row);
    }
    const facts=(s:SessionFact)=>({state:s.state,chat_type:s.chat_type,createdDuringTest:s.created_during_test,
      retentionSeconds:s.ttl_seconds,sameContactAsPage:s.same_contact,runtimeSessionUpsertMs:this.sessionUpserts.get(s.id)??null});
    const anchor=c&&after?after.sessions.get(c.anchor):null;
    return {rolesTeamsChanged:before&&after?JSON.stringify([before.roles,before.teams])!==JSON.stringify([after.roles,after.teams]):null,
      anchorAtChanged:anchor&&c?anchor.activity!==c.at:null,anchorEligible:c&&after?!!anchor:null,
      eligibleCountBefore:before?.sessions.size??null,eligibleCountAfter:after?.sessions.size??null,
      eligibleHashChanged:before&&after?before.hash!==after.hash:null,
      beforeMatchesIssuedScope:before&&c?before.hash===c.scope:null,afterMatchesCursorScope:after&&c?after.hash===c.scope:null,
      addedSessions:before&&after?added.length:null,removedSessions:before&&after?removed.length:null,changedLastActivity:before&&after?changed.length:null,
      added:added.map(facts),removed:removed.map(facts),changed:changed.map(facts)};
  }

  // Queue a read alongside the existing CDP commands. Neither the click nor its
  // predicate awaits a diagnostic. Null means the pager could not be observed.
  samplePage(browser:ReadBrowser,phase:'back-start'|'after-400',binding?:string){
    if(this.stopped)return;
    const ms=this.ms();
    const listen=binding?`document.addEventListener('click',event=>{
      const b=event.target?.closest?.('.inbox-topic-pages button'),text=b?.textContent??'';
      globalThis[${JSON.stringify(binding)}]?.(JSON.stringify({kind:'back-click',...read(),
        action:text.includes('返回最新主题')?'back':text.includes('更多主题与窗口')?'more':'other'}));
    },{once:true,capture:true,passive:true});`:'';
    this.track(browser.evaluate(`(()=>{const read=()=>{const pager=document.querySelector('.inbox-topic-pages');
      return {present:!!pager,back:!!pager?.textContent.includes('返回最新主题'),more:!!pager?.textContent.includes('更多主题与窗口'),
        direct:!!document.querySelector('.inbox-new-direct')};};${listen}return read();})()`)
      .then(v=>{if(record(v))this.recordPager(phase,v,ms);})
      .catch(()=>{this.pageStates.push({phase,ms,unavailable:true});}));
  }
  recordPager(phase:'back-start'|'after-400'|'back-click',v:Record<string,unknown>,ms=this.ms()){
    this.pageStates.push({phase,ms,doneMs:this.ms(),cursorHeldByPager:v.present===true?v.back===true:null,
      pagerText:v.present===true?[(v.back===true?'返回最新主题':''),(v.more===true?'更多主题与窗口':'')].join(''):null,
      directExists:v.direct===true,...(phase==='back-click'?{action:v.action==='back'||v.action==='more'?v.action:'other'}:{})});
  }

  private committed(writes:Write[]){
    if(this.stopped||!writes.length)return;
    const ms=this.ms(),bin=Math.floor(ms/100),bucket=this.writeBuckets.get(bin)??{firstMs:ms,lastMs:ms,statements:{}};
    for(const w of writes){
      const key=w.operation+' '+w.table;bucket.statements[key]=(bucket.statements[key]??0)+1;
      if(w.session)this.sessionUpserts.set(w.session,ms);
    }
    bucket.lastMs=ms;this.writeBuckets.set(bin,bucket);
  }

  // The runtime exposes aggregate metrics, not a committed-write subscriber.
  // Tap only its own pool. Fixture seeding and diagnostic SELECTs use the original.
  runtimePool(pool:PostgresPool):PostgresPool{
    const queryFor=(owner:PostgresPool|PostgresPoolClient)=>{
      let transaction:Write[]|null=null;
      return new Proxy(owner.query,{apply:(fn,self,args)=>{
        const result=Reflect.apply(fn,owner,args);
        const sql=typeof args[0]==='string'?args[0]:record(args[0])&&typeof args[0].text==='string'?args[0].text:'';
        if(this.inFlight.size&&sql.includes(' AS cursor_valid,')&&sql.includes('JOIN eligible anchor')&&Array.isArray(args[1])){
          const values:unknown[]=args[1];
          const matches=[...this.inFlight].filter(({cursor,selected})=>[selected,cursor.anchor,cursor.at,cursor.scope].every(v=>values.includes(v)));
          const match=matches.length===1?matches[0]:undefined;
          if(match)return Promise.resolve(result).then(r=>{
            const proof=record(r)&&Array.isArray(r.rows)?r.rows[0]:null;
            if(record(proof))match.proof={rolesTeamsValid:proof.scope_valid===true,selectedEligible:proof.anchor_valid===true,
              cursorValid:proof.cursor_valid===true,scopeMatchesCursor:proof.readable_scope===match.cursor.scope};
            return r;
          });
        }
        const control=/^\s*(BEGIN|COMMIT|ROLLBACK)\b/iu.exec(sql)?.[1]?.toUpperCase();
        const dml=/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+((?:conversation|pilot_ticket|intake|communication|notification|workbench|channel)\.[a-z_0-9]+)\b/iu.exec(sql);
        if(!control&&!dml)return result;
        return Promise.resolve(result).then(r=>{
          if(control==='BEGIN')transaction=[];
          else if(control==='ROLLBACK')transaction=null;
          else if(control==='COMMIT'){
            if(record(r)&&r.command==='COMMIT')this.committed(transaction??[]);transaction=null;
          }else if(dml&&dml[1]&&dml[2]&&record(r)&&typeof r.rowCount==='number'&&r.rowCount>0){
            const operation=dml[1].split(/\s/u)[0]?.toUpperCase()??'',table=dml[2].toLowerCase();
            const w:Write={operation,table};
            if(table==='conversation.session'&&operation==='INSERT'&&Array.isArray(r.rows)&&record(r.rows[0])&&typeof r.rows[0].id==='string')w.session=r.rows[0].id;
            if(transaction)transaction.push(w);else this.committed([w]);
          }
          return r;
        });
      }});
    };
    const query=queryFor(pool);
    const connect=new Proxy(pool.connect,{apply:(fn,self,args)=>{
      const result=Reflect.apply(fn,pool,args);if(args.length)return result;
      return Promise.resolve(result).then((client:PostgresPoolClient)=>{
        const observed=queryFor(client);
        return new Proxy(client,{get:(c,key)=>key==='query'?observed:Reflect.get(c,key,c)});
      });
    }});
    return new Proxy(pool,{get:(p,key)=>key==='query'?query:key==='connect'?connect:Reflect.get(p,key,p)});
  }
}
