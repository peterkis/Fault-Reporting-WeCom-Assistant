import {checkEvidenceGeneration,publishPerfEvidence,type PerfEvidencePlan} from './perf-evidence-publication.mjs';
export {publishPerfEvidence};
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertLoopbackDatabaseUrl,loopbackFixtureTarget,withFixtureMigrations} from '../src/platform/loopback-database.mjs';
export {assertLoopbackDatabaseUrl};
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {applyFullSchemaThrough077} from '../../../tests/helpers/full-schema-migrations.mjs';
import {seedCapacityDataset} from '../../../tests/helpers/capacity-dataset.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../src/p2-006-workbench-authorization.mjs';
import {createP2016TicketQuery} from '../src/p2-016-ticket-query.mjs';
import {loadServiceCatalog,type ServiceCatalog} from '../src/p2-007-service-catalog.mjs';
import {createWeb01WorkbenchQuery} from '../src/web01-workbench-query.mjs';
import {HUMAN_WORKBENCH_OPTIONS} from './human-workbench-role.mjs';
import {createWorkbenchSourceGroups} from '../src/workbench-source-groups.mjs';
import {createWorkbenchSupplementFollowUp} from '../src/workbench-supplement-follow-up.mjs';
import {createP2016ManualReviewFacade} from '../src/p2-016-manual-review-facade.mjs';
import {createWorkbenchSearch} from '../src/workbench-search.mjs';
import type {WorkbenchSearchCriteria} from '../../../contracts/workbench_search_contracts.js';

function fullSearchCriteria(patch: Partial<WorkbenchSearchCriteria>): WorkbenchSearchCriteria {
  return {
    q: '', column: 'handled', range: 'recent', scope: 'team', responsibility: 'any',
    resolver_team_id: null, assignee_id: null, sources: [], source_group_ref: null,
    statuses: [], supplement: 'any', schedule: 'any', ...patch,
  };
}

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

interface ExplainJsonRoot {
  Plan?: PlanNode;
  'Execution Time'?: number;
  JIT?: {Functions?: number};
}

interface LatencyStats {
  name: string;
  iterations: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  rowCount: number;
}

function computeStats(name: string, samples: readonly number[], rowCount: number): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return Number((sorted[idx] ?? 0).toFixed(2));
  };
  return {
    name,
    iterations: sorted.length,
    minMs: Number((sorted[0] ?? 0).toFixed(2)),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    rowCount,
  };
}

/**
 * Card 42 §42A acceptance: no full Seq Scan of ticket combined with ~50k loops (the pre-42A pathology: per-row
 * LATERAL work over every ticket). Rows examined = (emitted + removed by filter) x loops.
 * - a ticket Seq Scan repeated across loops fails;
 * - any ticket node executed >= 1000 times fails (per-row probing of the ticket table);
 * - any node executed >= 50,000 times fails.
 * A single-pass ticket scan (one loop, e.g. a hash build for an anti-join) is allowed but listed in the summary.
 */
function assertPlanNodeSafe(label: string, node: PlanNode, singlePass: string[]): void {
  const nodeType = node['Node Type'] ?? '';
  const relation = node['Relation Name'] ?? '';
  const loops = node['Actual Loops'] ?? 0;
  const examined = ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * Math.max(1, loops);
  if (nodeType === 'Seq Scan' && relation === 'ticket' && loops > 1) {
    throw new Error(`PERF_BOARD_SEQ_SCAN_TICKET_REPEATED:${label}:examined=${examined}:loops=${loops}`);
  }
  if (nodeType === 'Seq Scan' && relation === 'ticket' && examined > 5000) singlePass.push(`${label}:examined=${examined}`);
  if (relation === 'ticket' && loops >= 1000) {
    throw new Error(`PERF_BOARD_TICKET_HIGH_LOOPS:${label}:${nodeType}:loops=${loops}`);
  }
  if (loops >= 50000) throw new Error(`PERF_BOARD_HIGH_LOOPS:${label}:${nodeType}:${relation}:loops=${loops}`);
  for (const child of node.Plans ?? []) {
    assertPlanNodeSafe(label, child, singlePass);
  }
}
interface RecordedRead {sql: string; values: readonly unknown[]; elapsedMs: number}
interface StatementPlan {text: string; root: ExplainJsonRoot}

// Count every application statement except the transaction controls that have no query plan.
const transactionControl=/^\s*(?:BEGIN|COMMIT|ROLLBACK|SET TRANSACTION READ ONLY|SET TRANSACTION ISOLATION LEVEL REPEATABLE READ|SET LOCAL statement_timeout='2000ms'|SET LOCAL jit=off)\s*$/iu;
export function perfReadCount(statements:readonly string[]):number{
  return statements.filter(sql=>!transactionControl.test(sql)).length;
}
export const PERF_BOARD_READ_LIMITS={page:18,item:13,search:33} as const;
export async function inspectPerfScenario(
  scenario: string, statements: readonly RecordedRead[], primary: (sql: string) => boolean,
  explain: (label: string, statement: RecordedRead, primary: boolean) => Promise<StatementPlan>,
  representativeLength = statements.length,
) {
  const failures: string[] = [], explainErrors:string[]=[], singlePass: string[] = [], timings: string[] = [];
  let primaryText: string | undefined, dominant: {label:string; elapsedMs:number} | undefined;
  for (const [index, statement] of statements.entries()) {
    // Transaction controls have no query plan. Every other statement must yield one.
    if (transactionControl.test(statement.sql)) continue;
    const label = scenario + '-stmt-' + String(index + 1).padStart(2, '0');
    const isPrimary = primary(statement.sql);
    const description = statement.sql.trim().replace(/\s+/gu,' ').slice(0,96).trimEnd();
    if (index < representativeLength && (!dominant || statement.elapsedMs > dominant.elapsedMs)) dominant = {label:label+' '+description,elapsedMs:statement.elapsedMs};
    let obtainedPlan=false;
    try {
      const {root,text} = await explain(label,statement,isPrimary);
      if (!root.Plan?.['Node Type']) throw new Error('PERF_BOARD_EXPLAIN_EMPTY');
      if(isPrimary){
        if(!text.trim())throw new Error('PERF_BOARD_PRIMARY_EXPLAIN_EMPTY');
        if(index<representativeLength)primaryText??=text;
      }
      timings.push(label+'='+root['Execution Time']+'ms');
      obtainedPlan=true;
      if ((root.JIT?.Functions ?? 0) > 0) throw new Error('PERF_BOARD_JIT_USED:functions='+root.JIT?.Functions);
      assertPlanNodeSafe(label,root.Plan,singlePass);
    } catch (error) {
      const failure=label+': '+(error instanceof Error ? error.message : String(error));
      failures.push(failure);
      if(!obtainedPlan)explainErrors.push(failure);
    }
  }
  if (primaryText === undefined) failures.push('PERF_BOARD_STATEMENT_NOT_CAPTURED:'+scenario);
  return {failures,explainErrors,singlePass,primaryText,timings,dominant};
}

async function explainQuery(pool:PostgresPool,label:string,statement:RecordedRead,primary:boolean,diagDir:string|null):Promise<StatementPlan> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const values = [...statement.values];
    const json = await client.query<{'QUERY PLAN':ExplainJsonRoot[]}>('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+statement.sql,values);
    const root = json.rows[0]?.['QUERY PLAN']?.[0];
    if (!root) throw new Error('PERF_BOARD_EXPLAIN_EMPTY:'+label);
    let text = '';
    if (primary || diagDir) {
      const result = await client.query<{'QUERY PLAN':string}>('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) '+statement.sql,values);
      text = result.rows.map(row=>row['QUERY PLAN']).join('\n');
      if (diagDir) {
        mkdirSync(diagDir,{recursive:true});
        writeFileSync(path.join(diagDir,label+'.txt'),text+'\n','utf8');
      }
    }
    await client.query('COMMIT');
    return {root,text};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function parseCliArgs(argv: readonly string[]): {writeEvidenceDir: string | null; diagDir: string | null; warmup: number; iterations: number} {
  let writeEvidenceDir: string | null = null;
  let diagDir: string | null = null;
  let warmup = 3;
  let iterations = 30;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-evidence') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('PERF_BOARD_WRITE_EVIDENCE_DIR_REQUIRED');
      writeEvidenceDir = next;
      i++;
    } else if (arg?.startsWith('--write-evidence=')) {
      writeEvidenceDir = arg.slice('--write-evidence='.length);
    } else if (arg?.startsWith('--diag-dir=')) {
      diagDir = arg.slice('--diag-dir='.length);
    } else if (arg === '--iterations' && argv[i + 1]) {
      iterations = Number(argv[i + 1]);
      i++;
    } else if (arg === '--warmup' && argv[i + 1]) {
      warmup = Number(argv[i + 1]);
      i++;
    } else throw new Error('PERF_BOARD_ARGUMENT_INVALID');
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1 || !Number.isSafeInteger(warmup) || warmup < 0) throw new Error('PERF_BOARD_ITERATIONS_INVALID');
  // Evidence is only written for a full PG18 run (Codex 42A r1): no older-server override, at least 30 samples.
  if (writeEvidenceDir && iterations < 30) throw new Error('PERF_BOARD_EVIDENCE_REQUIRES_PG18_AND_30_ITERATIONS');
  return {writeEvidenceDir, diagDir, warmup, iterations};
}

export function isPerfItemProjection(sql:string):boolean {
  return sql.includes("SELECT 'ticket'::text AS kind")&&sql.includes('t.ticket_no AS number,t.title')&&
    sql.includes('p.display_name AS assignee_name')&&sql.includes('FROM pilot_ticket.ticket t')&&/WHERE t\.id=\$[246]::uuid/u.test(sql);
}

export function assertPerfBoardVersion(versionNumber:number,version:string,evidence:boolean):void {
  const major=Math.floor(versionNumber/10000);
  if(!Number.isSafeInteger(versionNumber)||major<18||evidence&&major!==18)throw new Error(`PERF_BOARD_REQUIRES_PG18:found=${version}`);
}

export function perfSearchPrincipalCount(warmup:number,iterations:number):number {
  return Math.ceil(3*(warmup+iterations)/20);
}

export async function measurePerfScenario<T>(name:string,warmup:number,iterations:number,expectedCount:number,
  fn:()=>Promise<{count:number;value?:T}>,record:(reads:RecordedRead[]|null)=>void){
  const requests:RecordedRead[][]=[], samples:{ms:number;reads:RecordedRead[]}[]=[];
  let count=0, last:T|undefined, error:string|undefined;
  try {
    for(let i=-warmup;i<iterations;i++) {
      const reads:RecordedRead[]=[];
      requests.push(reads);
      record(reads);
      const start=performance.now();
      const result=await fn();
      if(result.count!==expectedCount)throw Error(`PERF_BOARD_ROW_COUNT:expected=${expectedCount}:actual=${result.count}`);
      if(i>=0) samples.push({ms:performance.now()-start,reads});
      count=result.count;
      last=result.value;
    }
  } catch(cause) {
    error=name+': '+(cause instanceof Error?cause.message:String(cause));
  } finally {
    record(null);
  }
  const stats=samples.length===iterations?computeStats(name,samples.map(sample=>sample.ms),count):null;
  const p95=[...samples].sort((a,b)=>a.ms-b.ms)[Math.ceil(samples.length*0.95)-1];
  const representative=(error?requests.at(-1):p95?.reads)??[];
  // Explain each position of the actual P95 request (or failed request), plus any SQL shape
  // observed at that position in another request. Keep that occurrence's own parameters.
  const statements=[...representative];
  const seen=representative.map(read=>new Set([read.sql]));
  for(const request of requests) for(const [position,read] of request.entries()){
    const shapes=seen[position]??=new Set<string>();
    if(!shapes.has(read.sql)){shapes.add(read.sql);statements.push(read);}
  }
  const maxReads=requests.reduce((max,request)=>Math.max(max,perfReadCount(request.map(read=>read.sql))),0);
  return {name,stats,last,statements,error,maxReads,representativeLength:representative.length};
}

export function createPerfBoardReads(pool:PostgresPool,catalog:ServiceCatalog){
  const role = HUMAN_WORKBENCH_OPTIONS;
  const features = {manual:role.workbenchManualReportsEnabled,manualReview:role.workbenchManualReviewEnabled,
    supplements:role.workbenchSupplementFollowUpEnabled,sourceGroups:role.sourceGroupDirectoryEnabled,
    follow:false,schedules:false}; // Follow is opt-in at role startup. Schedules use the runtime default.
  const authorization = createPilotWorkbenchAuthorizationAdapter({pool});
  const ticketQuery = createP2016TicketQuery({...role,pool,enabled:true,authorization});
  const reviews = createP2016ManualReviewFacade({pool,query:ticketQuery,enabled:true,
    workspaceEnabled:features.manualReview,manualSourceEnabled:features.manual});
  const web01 = createWeb01WorkbenchQuery({pool,query:ticketQuery,serviceCatalog:catalog,
    sourceGroups:features.sourceGroups?createWorkbenchSourceGroups({pool,query:ticketQuery}):null,
    supplementFollowUp:features.supplements?createWorkbenchSupplementFollowUp({pool,query:ticketQuery,enabled:true}):null,
    manualReviewEnabled:features.manualReview,manualReportsEnabled:features.manual,personalReadEnabled:role.workbenchPersonalReadEnabled,reviews});
  const search = createWorkbenchSearch({pool,query:ticketQuery,cards:web01,enabled:true,localTestProfile:true,features});
  return {web01,search,features};
}

export async function runPerfBoard(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === '--check-evidence') {
    const directory = argv[1];
    if (argv.length !== 2 || !directory || directory.startsWith('--')) throw Error('PERF_BOARD_CHECK_EVIDENCE_DIR_REQUIRED');
    console.log('PERF_BOARD_EVIDENCE_VERIFIED run_id=' + checkEvidenceGeneration(directory));
    return;
  }
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  if(!databaseUrl)throw new Error('PERF_BOARD_PILOT_DATABASE_URL_REQUIRED');
  const {connection:adminDatabase,databaseUrl:fixtureUrl}=loopbackFixtureTarget(databaseUrl);
  const {writeEvidenceDir, diagDir, warmup, iterations} = parseCliArgs(argv);

  const dbName = `ticket_card42a_perf_board_${randomUUID().replaceAll('-', '_')}`;
  const quoted = `"${dbName}"`;
  const isolatedDatabase={...adminDatabase,database:dbName};
  const adminPool = createPostgresPool({...adminDatabase, max: 1, connectionTimeoutMillis: 10_000, application_name: 'perf_board_admin'});
  let created = false;
  let pool: PostgresPool | null = null;
  let runError: unknown = null;
  let cleanupError: unknown = null;
  const evidence:PerfEvidencePlan[]=[];
  let evidenceSummary='',serverVersion='';

  try {
    const versionRow = (await adminPool.query<{version: string; ver_num: number}>(
      `SELECT version() AS version, current_setting('server_version_num')::integer AS ver_num`,
    )).rows[0];
    if (!versionRow) throw new Error('PERF_BOARD_VERSION_CHECK_FAILED');
    assertPerfBoardVersion(versionRow.ver_num,versionRow.version,writeEvidenceDir!==null);

    await adminPool.query(`CREATE DATABASE ${quoted} TEMPLATE template0`);
    created = true;
    const target=new URL(fixtureUrl);target.pathname='/'+dbName;
    await withFixtureMigrations(target.href,()=>applyFullSchemaThrough077(target.href));
    // 42A-7 in miniature: the deployment sets jit=off on the application role (db-role-settings). This throwaway
    // database gets the same setting at database level, so no cluster-wide role is touched by a benchmark.
    await adminPool.query(`ALTER DATABASE ${quoted} SET jit = off`);

    pool = createPostgresPool({...isolatedDatabase, max: 2, connectionTimeoutMillis: 10_000, application_name: 'perf_board_runner'});
    const access = createPilotAccessService({pool});
    const adminPrincipal = await access.upsertPrincipal({wecomUserId: 'perf-admin', displayName: '压测管理员（合成）', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT']});
    const handlerPrincipal = await access.upsertPrincipal({wecomUserId: 'perf-handler', displayName: '压测处理人（合成）', roles: ['HANDLER'], resolverTeamIds: ['PILOT_IT']});

    const tSeed0 = performance.now();
    const {sampleTicketId, sampleHandledTicketId} = await seedCapacityDataset({profile:'annual-board',pool,adminId:adminPrincipal.id,handlerId:handlerPrincipal.id});
    const seedMs = Number((performance.now() - tSeed0).toFixed(1));

    const counts = (await pool.query<{intakes: string; tickets: string; events: string; closures: string; journeys:number; legs:number; profiles:number; reviews:number; pending_reviews:number; linked_reviews:number; by_status: Record<string, number>}>(
      `SELECT (SELECT count(*) FROM intake.service_intake)::text AS intakes,(SELECT count(*) FROM pilot_ticket.ticket)::text AS tickets,
              (SELECT count(*) FROM pilot_ticket.ticket_event)::text AS events,(SELECT count(*) FROM pilot_ticket.closure_record)::text AS closures,
              (SELECT count(*)::int FROM intake.contact_journey) AS journeys,(SELECT count(*)::int FROM intake.channel_leg) AS legs,
              (SELECT count(*)::int FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id AND l.source_intake_id=j.origin_intake_id
                WHERE l.reporter_identity_hash=j.reporter_identity_hash AND j.profile_resolution_status='RESOLVED'
                  AND j.profile_snapshot->'contact'->>'name' LIKE '%（合成）%') AS profiles,
              (SELECT count(*)::int FROM intake.manual_review_item) AS reviews,
              (SELECT count(*)::int FROM intake.manual_review_item WHERE status='PENDING') AS pending_reviews,
              (SELECT count(*)::int FROM intake.manual_review_item r JOIN pilot_ticket.ticket t ON t.id=r.linked_ticket_id AND t.source_intake_id=r.service_intake_id
                JOIN intake.deterministic_decision h ON h.id=r.resolution_decision_id AND h.journey_id=r.journey_id WHERE r.status='RESOLVED') AS linked_reviews,
              (SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*)::integer AS n FROM pilot_ticket.ticket GROUP BY status) s) AS by_status`,
    )).rows[0];
    if (!counts || counts.intakes!=='56000' || counts.tickets!=='50400' || counts.journeys!==56000 || counts.legs!==56000 ||
        counts.profiles!==56000 || counts.reviews!==11200 || counts.pending_reviews!==22 || counts.linked_reviews!==10068)
      throw new Error('PERF_BOARD_COUNTS_FAILED:'+JSON.stringify(counts));
    const jitRows = await Promise.all([pool.query<{jit: string}>('SHOW jit'), pool.query<{jit: string}>('SHOW jit')]);
    const effectiveJit = [...new Set(jitRows.map(r => r.rows[0]?.jit ?? 'unknown'))].join(',');
    if (effectiveJit !== 'off') throw new Error(`PERF_BOARD_JIT_NOT_OFF:${effectiveJit}`);

    const catalog = await loadServiceCatalog();
    // Record pool queries and transaction queries, including those made by authorization and decorators.
    let recording: RecordedRead[] | null = null;
    function observedQuery(target:object,queryFn:(...args:unknown[])=>unknown,args:unknown[]) {
      if (!recording) return Reflect.apply(queryFn,target,args);
      const [sql,values] = args;
      if (typeof sql !== 'string') throw new Error('PERF_BOARD_UNRECORDED_SQL');
      const statement = {sql,values:Array.isArray(values)?values:[],elapsedMs:0};
      recording.push(statement);
      const start = performance.now();
      return Promise.resolve(Reflect.apply(queryFn,target,args)).finally(()=>{statement.elapsedMs=performance.now()-start;});
    }
    const timedPool = pool;
    const recordingPool = new Proxy(timedPool, {
      get(target, prop, receiver) {
        if (prop === 'query') return (...args: unknown[]) => observedQuery(target,target.query,args);
        if (prop === 'connect') {
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(clientTarget, clientProp, clientReceiver) {
                if (clientProp === 'query') return (...args: unknown[]) => observedQuery(clientTarget,clientTarget.query,args);
                const val = Reflect.get(clientTarget, clientProp, clientReceiver);
                return typeof val === 'function' ? val.bind(clientTarget) : val;
              },
            });
          };
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
    const {web01,search,features} = createPerfBoardReads(recordingPool,catalog);
    const authFor = (principalId: string) => ({principal_id: principalId, auth_method: 'TEST', csrf_token: 'perf-board-csrf-token-' + principalId.slice(0, 8), expires_epoch_ms: String(Date.now() + 3_600_000)});
    const auth = authFor(adminPrincipal.id);
    // The production search limiter (20 calls / minute / principal) stays in force; search samples rotate over
    // equivalently authorized synthetic admins so every timed call is a real, admitted request.
    const searchAdmins: ReturnType<typeof authFor>[] = [];
    const principalCount = perfSearchPrincipalCount(warmup,iterations);
    for (let n = 0; n < principalCount; n++) {
      const principal = await access.upsertPrincipal({wecomUserId: 'perf-search-admin-' + n, displayName: '压测检索管理员' + n + '（合成）', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT']});
      searchAdmins.push(authFor(principal.id));
    }
    let searchTurn = 0;
    const nextSearchAuth = () => {
      const value = searchAdmins[searchTurn++ % searchAdmins.length];
      if (!value) throw new Error('PERF_BOARD_SEARCH_PRINCIPALS_MISSING');
      return value;
    };

    const measure=<T,>(name:string,expectedCount:number,fn:()=>Promise<{count:number;value?:T}>)=>
      measurePerfScenario(name,warmup,iterations,expectedCount,fn,reads=>{recording=reads;});
    const pendingRes = await measure('pending_p1', 50, async () => {
      const p = await web01.list({authContext: auth, column: 'pending', range: 'recent', cursor: null, limit: '50'});
      return {count: p.items.length, value: p};
    });
    const activeRes = await measure('active_p1', 25, async () => {
      const p = await web01.list({authContext: auth, column: 'active', range: 'recent', cursor: null, limit: '50'});
      return {count: p.items.length};
    });
    const handledP1 = await measure('handled_recent_p1', 50, async () => {
      const p = await web01.list({authContext: auth, column: 'handled', range: 'recent', cursor: null, limit: '50'});
      return {count: p.items.length, value: p};
    });
    const handledAllP1 = await measure('handled_all_p1', 50, async () => {
      const p = await web01.list({authContext: auth, column: 'handled', range: 'all', cursor: null, limit: '50'});
      return {count: p.items.length, value: p};
    });
    const handledCursor = handledAllP1.last?.next_cursor ?? null;
    const handledP2 = await measure('handled_all_p2', 50, async () => {
      if (!handledCursor) throw new Error('PERF_BOARD_EXPECTED_HANDLED_CURSOR');
      const p = await web01.list({authContext: auth, column: 'handled', range: 'all', cursor: handledCursor, limit: '50'});
      return {count: p.items.length};
    });
    const itemRes = await measure('item_ticket', 1, async () => {
      const item=await web01.authorizedItem(auth,'ticket',sampleHandledTicketId);
      return {count:Number(item?.kind==='ticket'&&item.id===sampleHandledTicketId)};
    });
    const searchHandled = await measure('search_handled_recent', 50, async () => {
      const p = await search.search({authContext: nextSearchAuth(), request: {criteria: fullSearchCriteria({column: 'handled', range: 'recent', q: ''}), cursor: null, limit: 50}});
      return {count: p.items.length};
    });
    const searchTextRecent = await measure('search_text_recent', 50, async () => {
      const p = await search.search({authContext: nextSearchAuth(), request: {criteria: fullSearchCriteria({column: 'all', range: 'recent', q: '打印机'}), cursor: null, limit: 50}});
      return {count: p.items.length};
    });
    const searchText = await measure('search_text_all', 50, async () => {
      const p = await search.search({authContext: nextSearchAuth(), request: {criteria: fullSearchCriteria({column: 'all', range: 'all', q: '打印机'}), cursor: null, limit: 50}});
      return {count: p.items.length};
    });
    void sampleTicketId;

    const isPage = (sql:string) => sql.includes('page_keys AS (');
    const isSearchPage = (sql:string) => sql.includes('candidate_keys') && sql.includes('AS safety_signature FROM matched');
    const isItem = isPerfItemProjection;
    const scenarios = [
      ['pending',pendingRes,isPage],['active',activeRes,isPage],['handled',handledP1,isPage],
      ['handled-all',handledAllP1,isPage],['handled-page2',handledP2,isPage],['item',itemRes,isItem],
      ['search',searchHandled,isSearchPage],['search-text',searchTextRecent,isSearchPage],['search-text-all',searchText,isSearchPage],
    ] as const;
    const allStats:LatencyStats[]=[], informationalStats:LatencyStats[]=[];
    const failures:string[]=[], informationalFindings:string[]=[], singlePassTicketScans:string[]=[], planSummary:string[]=[];

    for (const [file,run,primary] of scenarios) {
      const informational=run===searchText;
      const findings=informational?informationalFindings:failures;
      if(run.error) findings.push(run.error);
      const readLimit=primary===isPage?PERF_BOARD_READ_LIMITS.page:primary===isItem?PERF_BOARD_READ_LIMITS.item:PERF_BOARD_READ_LIMITS.search;
      if(!informational && run.maxReads>readLimit) failures.push('PERF_BOARD_TOO_MANY_READS:'+run.name+':'+run.maxReads+'>'+readLimit);
      planSummary.push(run.name+' max reads/request='+run.maxReads);
      // Both fixture pages contain tickets. Verify the configured services actually issued their reads.
      if(run===activeRes || run===searchHandled) {
        for(const marker of ['workbench.source_group_name n','summary.pending AS has_pending_supplements']) {
          if(!run.statements.some(read=>read.sql.includes(marker))) failures.push('PERF_BOARD_DECORATOR_NOT_CAPTURED:'+run.name+':'+marker);
        }
      }
      if(run.stats) {
        (informational?informationalStats:allStats).push(run.stats);
        if(!informational && run.stats.p95Ms>=100) failures.push('PERF_BOARD_P95_EXCEEDED:'+run.name+':p95='+run.stats.p95Ms+'ms');
        else if(!informational && run.stats.p95Ms>75) failures.push('PERF_BOARD_MARGIN_MISSED:'+run.name+':p95='+run.stats.p95Ms+'ms');
      }
      const inspected=await inspectPerfScenario(run.name,run.statements,primary,
        (label,statement,isPrimary)=>explainQuery(timedPool,label,statement,isPrimary,diagDir),run.representativeLength);
      findings.push(...inspected.failures);
      singlePassTicketScans.push(...inspected.singlePass);
      const primaryText=inspected.primaryText??'EXPLAIN unavailable: '+findings.join(' | ');
      const plan={file,scenario:run.name,complete:run.error===undefined&&run.stats!==null&&inspected.explainErrors.length===0,text:inspected.primaryText};
      evidence.push(plan);
      if(writeEvidenceDir&&(!plan.complete||!plan.text))
        failures.push('PERF_BOARD_INCOMPLETE_EVIDENCE:'+run.name);
      if(diagDir) {
        mkdirSync(diagDir,{recursive:true});
        writeFileSync(path.join(diagDir,file+'.txt'),primaryText+'\n','utf8');
      }
      const slow=inspected.dominant;
      planSummary.push(run.name+(run.error?' failed request':' P95 request')+' dominant read: '+(slow?slow.elapsedMs.toFixed(2)+'ms '+slow.label:'none'),
        '  EXPLAIN execution: '+inspected.timings.join(', '));
    }
    const byStatus = Object.entries(counts.by_status ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(', ');
    const summaryLines = [
      `Run: ${dbName} | Gated outcome: ${failures.length?'FAIL':'PASS'}`,
      `PostgreSQL Version: ${versionRow.version}`,
      'Read profile: HUMAN_WORKBENCH_OPTIONS, search enabled, synthetic session, personalRead='+HUMAN_WORKBENCH_OPTIONS.workbenchPersonalReadEnabled+'; features='+JSON.stringify(features),
      `Dataset (synthetic 「（合成）」, actual row counts): service_intake=${counts.intakes}, ticket=${counts.tickets} (${byStatus}), ticket_event=${counts.events}, closure_record=${counts.closures}, journeys=${counts.journeys}, origin_legs=${counts.legs}, resolved_profiles=${counts.profiles}, reviews=${counts.reviews}, pending_reviews=${counts.pending_reviews}, linked_reviews=${counts.linked_reviews}, seed_ms=${seedMs}`,
      `Warmup=${warmup}, Iterations=${iterations}, jit=${effectiveJit} (database setting, verified on the timed connections), search principals rotated=${searchAdmins.length}`,
      '',
      'Scenario                     Rows   Min(ms)   P50(ms)   P95(ms)   Max(ms)',
      ...allStats.map(s => `${s.name.padEnd(28)} ${String(s.rowCount).padStart(4)}   ${String(s.minMs).padStart(7)}   ${String(s.p50Ms).padStart(7)}   ${String(s.p95Ms).padStart(7)}   ${String(s.maxMs).padStart(7)}`),
      'Informational (not asserted):',
      ...informationalStats.map(s => `${s.name.padEnd(28)} ${String(s.rowCount).padStart(4)}   ${String(s.minMs).padStart(7)}   ${String(s.p50Ms).padStart(7)}   ${String(s.p95Ms).padStart(7)}   ${String(s.maxMs).padStart(7)}`),
      '',
      'Informational plan findings (not asserted): ' + (informationalFindings.join(', ') || 'none'),
      'Single-pass ticket scans (1 loop; allowed): ' + (singlePassTicketScans.join(', ') || 'none'),
      ...planSummary,
      'Gated failures: '+(failures.join(' | ') || 'none'),
      'Assertions: every asserted P95 < 100ms and at most 75ms for margin; no repeated ticket Seq Scan; no ticket node with >= 1000 loops; no node with >= 50000 loops; ZERO JIT functions.',
    ];
    const summary = summaryLines.join('\n');
    console.log(summary);

    if (failures.length) throw new Error(failures.join('\n'));
    evidenceSummary=summary;
    serverVersion=versionRow.version;
  } catch (error) {
    runError = error;
  } finally {
    try {
      await pool?.end();
      if (created) {
        await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [dbName]);
        await adminPool.query(`DROP DATABASE IF EXISTS ${quoted}`);
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      await adminPool.end().catch(err => {
        cleanupError ??= err;
      });
    }
  }

  if (runError && cleanupError) throw new AggregateError([runError, cleanupError]);
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
  if(writeEvidenceDir)publishPerfEvidence(writeEvidenceDir,evidenceSummary,serverVersion,evidence);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPerfBoard().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
