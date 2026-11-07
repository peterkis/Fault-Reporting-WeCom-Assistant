import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {transpileModule, ModuleKind, ScriptTarget} from 'typescript';
import {CircleHelp, Monitor, PillBottle, Printer, ScanLine} from 'lucide-react';
import type {WorkbenchCard as CoreWorkbenchCard,BoardColumn} from '../contracts/web01_workbench_contracts.js';
import type {WorkbenchFollowAttention} from '../contracts/workbench_item_follow_contracts.js';
type WorkbenchCard=CoreWorkbenchCard&{attention?:WorkbenchFollowAttention};

const root = process.env.TS_MIGRATION_TEST_SOURCE_ROOT ?? process.cwd();
// Like the H5 pure-module tests, execute the actual browser source without importing its DOM application.
async function designModule(name: string): Promise<string> {
  const source = await readFile(resolve(root, 'app/pc-admin/src/design', name + '.ts'), 'utf8');
  const output = transpileModule(source, {compilerOptions: {module: ModuleKind.ESNext, target: ScriptTarget.ES2022, verbatimModuleSyntax: true}}).outputText;
  const resolved=output.replaceAll("'lucide-react'", JSON.stringify(import.meta.resolve('lucide-react')));
  return 'data:text/javascript;base64,' + Buffer.from(['board-presentation','format-time'].includes(name)?resolved.replaceAll("'./heat'",JSON.stringify(await designModule('heat'))):resolved).toString('base64');
}
interface Heat {tone: string; label: string; ring: string | null}
const {heatOf, cardHeat, cardHeatStart, HEAT_THRESHOLDS_MINUTES}: {
  heatOf: (startIso: string | null | undefined, nowMs: number) => Heat | null;
  cardHeat: (item: Pick<WorkbenchCard,'column'|'created_at'|'stage_entered_at'>,now:number)=>Heat|null;
  cardHeatStart: (item: Pick<WorkbenchCard,'column'|'created_at'|'stage_entered_at'>)=>string|null;
  HEAT_THRESHOLDS_MINUTES: readonly number[];
} = await import(await designModule('heat'));
interface Category {label: string; bg: string; fg: string; icon: unknown; border: string | null}
const {categoryOf, categoryMap, unclassifiedCategory}: {
  categoryOf: (domainCode: string | null | undefined, serviceCode?: string | null) => Category;
  categoryMap: Readonly<Record<string, Category>>;
  unclassifiedCategory: Category;
} = await import(await designModule('category-map'));

const now = Date.parse('2026-11-02T10:00:00+08:00');
const {formatListTime,shanghaiDays,formatWaitingTime,observeVisibleMinute}:{formatListTime:(local:string,nowMs:number)=>string;shanghaiDays:(nowMs:number)=>{today:string;yesterday:string};formatWaitingTime:(local:string|null|undefined,now:number)=>{label:string;tone:string}|null;observeVisibleMinute:(update:(now:number)=>void)=>()=>void}=await import(await designModule('format-time'));
for(const [name,local,clock,expected] of [
  ['today','2026-11-05 09:35:00','2026-11-05T12:00:00+08:00','09:35'],
  ['yesterday','2026-11-04 16:52:00','2026-11-05T12:00:00+08:00','昨天'],
  ['earlier this year','2026-10-21 10:00:00','2026-11-05T12:00:00+08:00','10-21'],
  ['previous year','2025-10-21 10:00:00','2026-11-05T12:00:00+08:00','2025-10-21'],
  ['midnight today','2026-11-05 00:00:30','2026-11-04T16:00:30Z','00:00'],
  ['midnight yesterday','2026-11-04 23:59:30','2026-11-04T16:00:30Z','昨天'],
  ['year boundary yesterday','2025-12-31 23:59:30','2026-01-01T00:00:30+08:00','昨天'],
] as const)test('V1 Shanghai list time '+name,()=>assert.equal(formatListTime(local,Date.parse(clock)),expected));
test('V1 list and timeline dividers share Shanghai midnight',()=>assert.deepEqual(shanghaiDays(Date.parse('2026-11-04T16:00:30Z')),{today:'2026-11-05',yesterday:'2026-11-04'}));
test('B3 waiting shares heat thresholds, Shanghai starts and whole-day labels',()=>{
  const start='2026-11-05 08:00:00',at=Date.parse('2026-11-05T08:00:00+08:00');
  for(const [minutes,label,tone] of [[0,'刚刚','neutral'],[4,'4 分钟','neutral'],[5,'5 分钟','neutral'],[12,'12 分钟','neutral'],[20,'20 分钟','neutral'],[59,'59 分钟','neutral'],[60,'1 小时','attention'],[120,'2 小时','attention'],[239,'3 小时','attention'],[240,'4 小时','danger'],[300,'5 小时','danger'],[1440,'1 天','danger'],[2880,'2 天','danger']] as const)assert.deepEqual(formatWaitingTime(start,at+minutes*60_000),{label,tone});
  for(const local of [null,undefined,'','2026-02-30 08:00:00','2026-11-05T08:00:00Z','2026-11-05 08:01:00'])assert.equal(formatWaitingTime(local,at),null);
  assert.equal(formatWaitingTime(start,NaN),null);
});
for(const [seconds,label] of [[0,'刚刚'],[59,'刚刚'],[60,'1 分钟']] as const)test('D2 waiting label at '+seconds+' seconds',()=>{
  const start='2026-11-06 08:00:00',at=Date.parse('2026-11-06T08:00:00+08:00');
  assert.deepEqual(formatWaitingTime(start,at+seconds*1000),{label,tone:'neutral'});
});
test('B5 minute clock pauses while hidden, resumes immediately and owns no request timer',t=>{
  const doc=new class extends EventTarget{hidden=false;}(),timers=new Map<number,()=>void>(),ticks:number[]=[],delays:number[]=[];let serial=0,clock=1000;
  const originals=['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  t.mock.method(Date,'now',()=>clock);
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setInterval:(callback:()=>void,delay:number)=>{delays.push(delay);timers.set(++serial,callback);return serial;},clearInterval:(id:number)=>timers.delete(id)}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  try{const stop=observeVisibleMinute(at=>ticks.push(at));assert.deepEqual(ticks,[1000]);assert.equal(timers.size,1);
    clock+=60_000;for(const tick of timers.values())tick();assert.deepEqual(ticks,[1000,61000]);
    doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(timers.size,0);clock+=120_000;assert.equal(ticks.length,2);
    doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(ticks,[1000,61000,181000]);assert.equal(timers.size,1);assert.deepEqual(delays,[60000,60000]);
    stop();assert.equal(timers.size,0);doc.dispatchEvent(new Event('visibilitychange'));assert.equal(ticks.length,3);
  }finally{for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
});
test('heat thresholds are the frozen shared minute tuple', () => {
  assert.deepEqual(HEAT_THRESHOLDS_MINUTES, [5, 20, 60, 240]);
  assert.ok(Object.isFrozen(HEAT_THRESHOLDS_MINUTES));
});
const boundaries: readonly (readonly [string, number, Heat | null])[] = [
  ['4:59', 299, null],
  ['5:00', 300, {tone: 'neutral', label: '5 分钟', ring: null}],
  ['19:59', 1199, {tone: 'neutral', label: '19 分钟', ring: null}],
  ['20:00', 1200, {tone: 'warning', label: '20 分钟', ring: null}],
  ['59:59', 3599, {tone: 'warning', label: '59 分钟', ring: null}],
  ['60:00', 3600, {tone: 'attention', label: '1 小时', ring: 'attention'}],
  ['239:59', 14399, {tone: 'attention', label: '3 小时', ring: 'attention'}],
  ['240:00', 14400, {tone: 'danger', label: '超时 4 小时', ring: 'danger'}],
  ['23h59', 23*3600+59*60, {tone: 'danger', label: '超时 23 小时', ring: 'danger'}],
  ['24h00', 24*3600, {tone: 'danger', label: '超时 1 天', ring: 'danger'}],
  ['720h', 720*3600, {tone: 'danger', label: '超时 30 天', ring: 'danger'}],
];
for (const [boundary, seconds, expected] of boundaries) test('heat boundary ' + boundary, () => {
  const start = new Date(now - seconds * 1000).toISOString();
  assert.deepEqual(heatOf(start, now), expected);
});
test('heat floors units, uses the supplied clock, and respects explicit zones', () => {
  assert.deepEqual(heatOf('2026-11-02T08:00:01+08:00', now), {tone: 'attention', label: '1 小时', ring: 'attention'});
  assert.deepEqual(heatOf('2026-11-02T01:55:00Z', now), heatOf('2026-11-02T09:55:00+08:00', now));
  assert.deepEqual(heatOf('2026-11-01T01:00:00Z', now), {tone: 'danger', label: '超时 1 天', ring: 'danger'});
  assert.equal(heatOf('2026-11-02T02:00:00Z', now), null);
  assert.deepEqual(heatOf('2026-11-02T02:00:00Z', now + 300_000), {tone: 'neutral', label: '5 分钟', ring: null});
});
test('missing, invalid, unzoned and future inputs never invent an overdue label', () => {
  for (const start of [null, undefined, '', 'invalid', '2026-13-02T00:00:00Z', '2026-02-30T00:00:00Z', '2025-02-29T12:00:00+08:00', '2026-11-02', '2026-11-02T01:00:00', '2026-11-02T02:00:01Z']) assert.equal(heatOf(start, now), null);
  for (const clock of [NaN, Infinity, -Infinity]) assert.equal(heatOf('2026-11-01T02:00:00Z', clock), null);
});
test('the visual map covers exactly the existing ServiceCatalog domains', async () => {
  const catalog: {domains: {domain_code: string; services: {service_code: string}[]}[]} = JSON.parse(await readFile(resolve(root, 'config_examples/p2-007-service-catalog.example.json'), 'utf8'));
  assert.equal(catalog.domains.length, 11);
  assert.deepEqual(Object.keys(categoryMap).sort(), catalog.domains.map(domain => domain.domain_code).sort());
  for (const domain of catalog.domains) {
    const category = categoryOf(domain.domain_code);
    assert.ok(category.label);
    assert.equal(category.border, null);
    assert.match(category.bg, /^var\(--cat-[a-z]+-bg\)$/u);
    assert.match(category.fg, /^var\(--cat-[a-z]+-fg\)$/u);
    for (const service of domain.services) assert.equal(categoryOf(domain.domain_code, service.service_code).bg, category.bg);
  }
});
test('printer services keep their category color, and mismatched or unknown services use the domain icon', () => {
  for (const code of ['PRINT.PRINTER_DEVICE', 'PRINT.PRINT_RENDERING']) {
    assert.equal(categoryOf('ENDPOINT_PRINT', code).icon, Printer);
    assert.equal(categoryOf('ENDPOINT_PRINT', code).bg, categoryOf('ENDPOINT_PRINT').bg);
  }
  assert.equal(categoryOf('DIAGNOSTIC', 'DIAG.LAB_RESULT_PRINT').icon, Printer);
  assert.equal(categoryOf('ENDPOINT_PRINT', 'ENDPOINT.COMPUTER').icon, Monitor);
  assert.equal(categoryOf('ENDPOINT_PRINT', 'UNKNOWN').icon, Monitor);
  assert.equal(categoryOf('DIAGNOSTIC', 'PRINT.PRINTER_DEVICE').icon, ScanLine);
  assert.equal(categoryOf('ENDPOINT_PRINT', 'toString').icon, Monitor);
});
test('unknown domains always use the neutral circle-help fallback', () => {
  for (const code of [null, undefined, '', 'UNKNOWN', 'toString', '__proto__']) {
    const category = categoryOf(code, 'PRINT.PRINTER_DEVICE');
    assert.deepEqual(category, unclassifiedCategory);
    assert.equal(category.icon, CircleHelp);
    assert.equal(category.border, 'var(--cat-unclassified-border)');
  }
});
test('solid badges meet white-text AA and every category meets its specified contrast', async () => {
  const css = await readFile(resolve(root, 'app/pc-admin/src/design/tokens.css'), 'utf8');
  const tokens = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map(match => [match[1], match[2]?.trim()]));
  function color(name: string, seen = new Set<string>()): string {
    assert.ok(!seen.has(name), 'token cycle: ' + name); seen.add(name);
    const value = tokens.get(name); assert.ok(value, 'missing token: ' + name);
    const reference = /^var\((--[\w-]+)\)$/u.exec(value);
    if (reference?.[1]) return color(reference[1], seen);
    assert.match(value, /^#[\da-f]{6}$/iu); return value;
  }
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map(index => {
      const value = parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
  }
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const tone of ['neutral', 'brand', 'info', 'success', 'warning', 'attention', 'danger', 'review']) {
    assert.equal(color('--tone-' + tone + '-solid'), color(tone==='brand'?'--blue-600':tone==='danger'?'--red-600':'--tone-' + tone + '-fg'));
    assert.ok(contrast(color('--tone-' + tone + '-solid'), color('--text-inverse')) >= 4.5, tone);
  }
  for (const category of [...Object.values(categoryMap), unclassifiedCategory]) {
    const bg = category.bg.slice(4, -1), fg = category.fg.slice(4, -1);
    assert.ok(contrast(color(bg), color(fg)) >= 4.5, category.label);
  }
});

const {matchesBoardSummary,sortBoardItems}: {
  matchesBoardSummary:(item:WorkbenchCard,filter:'pending'|'overdue'|'mine'|'today',now:number)=>boolean;
  sortBoardItems:(items:readonly WorkbenchCard[],column:BoardColumn,sort:'oldest'|'newest')=>WorkbenchCard[];
}=await import(await designModule('board-presentation'));
function boardCard(overrides:Partial<WorkbenchCard>={}):WorkbenchCard {
  return {kind:'ticket',id:'synthetic',intake_id:'synthetic-intake',number:'IT-test',title:'合成报修',status:'NEW',column:'pending',priority:null,source:'PORTAL',source_label:'H5报修',source_group:null,location:null,reporter_name:null,assignee_name:null,review_reason:null,created_at:'2026-11-02 06:00:00',updated_at:'2026-11-02 09:59:00',completed_at:null,closure:null,...overrides};
}
const completedClosure:NonNullable<WorkbenchCard['closure']>={kind:'COMPLETED',source:null,reason_code:null,reason_label:null,reason_note:null,secondary_reason:null,closed_by_display_name:null,closed_at:null,duplicate_of:null,can_restore:false};
test('Card 27B today counts completed only and excludes duplicate, cancelled and system rejection even with same-day completed_at',()=>{
  const now=Date.parse('2026-11-06T12:00:00+08:00');
  for(const status of ['CLOSED','RESOLVED','COMPLETED'])assert.equal(matchesBoardSummary(boardCard({status,column:'closed',completed_at:'2026-11-06 08:00:00',closure:completedClosure}),'today',now),true,status+'（合成）');
  for(const status of ['CANCELLED','DUPLICATE_LINKED','IGNORED'])assert.equal(matchesBoardSummary(boardCard({status,column:'closed',completed_at:'2026-11-06 08:00:00',closure:{...completedClosure,kind:'DISMISSED',source:status==='IGNORED'?'SYSTEM':'MANUAL'}}),'today',now),false,status+'（合成）');
  assert.equal(matchesBoardSummary(boardCard({status:'IGNORED',column:'closed',completed_at:null,closure:{...completedClosure,kind:'DISMISSED'}}),'today',now),false);
  assert.equal(matchesBoardSummary(boardCard({column:'closed',completed_at:'2026-11-06 08:00:00',closure:null}),'today',now),false);
});

test('R1 avatarInitial strips repeated suffixes, keeps Unicode and falls back without brackets',async()=>{
  const {avatarInitial}:{avatarInitial:(name:string)=>string}=await import(await designModule('components/Avatar/avatarInitial'));
  for(const [name,initial] of [['张三（合成）','三'],['李四(外包)','四'],['王五（合成）（外包）','五'],['（合成）','合'],['Peter','P'],['peter (实习)','P'],['  赵六  ','六'],['','—'],[' () （） ','—'],['张😀（合成）','😀']])assert.equal(avatarInitial(name??''),initial,name);
});
test('R2 a–e share civil-time starts, never substitute created_at for a missing active stage',()=>{
  const cases:readonly (readonly [Partial<WorkbenchCard>,string|null,string|null])[]=[
    [{created_at:'2026-11-01 08:00:00'},'2026-11-01 08:00:00','danger'],
    [{column:'active',stage_entered_at:'2026-11-02 05:00:00'},'2026-11-02 05:00:00','danger'],
    [{column:'active',stage_entered_at:'2026-11-02 09:30:00'},'2026-11-02 09:30:00','warning'],
    [{column:'active',stage_entered_at:null,created_at:'2026-10-31 10:00:00'},null,null],
    [{column:'closed',created_at:'2026-10-30 10:00:00',completed_at:'2026-11-02 09:00:00'},null,null],
  ];
  for(const [fields,start,tone] of cases){const item=boardCard(fields);assert.equal(cardHeatStart(item),start);assert.equal(cardHeat(item,now)?.tone??null,tone);assert.equal(matchesBoardSummary(item,'overdue',now),tone==='danger');}
  assert.equal(cardHeat(boardCard({column:'active'}),now),null);
});
test('R2 board overdue follows the heat of pending and active cards of every rendered kind',()=>{
  assert.equal(matchesBoardSummary(boardCard(),'overdue',now),true);
  assert.equal(matchesBoardSummary(boardCard({created_at:'2026-11-02 06:00:01'}),'overdue',now),false);
  for(const kind of ['ticket','intake','review'] as const)assert.equal(matchesBoardSummary(boardCard({kind}),'overdue',now),true);
  assert.equal(matchesBoardSummary(boardCard({column:'active',stage_entered_at:'2026-11-02 05:00:00'}),'overdue',now),true);
  for(const item of [boardCard({column:'active',stage_entered_at:null}),boardCard({column:'closed'})])assert.equal(matchesBoardSummary(item,'overdue',now),false);
  assert.equal(matchesBoardSummary(boardCard({created_at:'2026-11-02 09:59:00',updated_at:'2020-01-01 00:00:00'}),'overdue',now),false);
});
test('board mine requires the caller-only HANDLING relation, never names, follow or conversation responsibility',()=>{
  assert.equal(matchesBoardSummary(boardCard({assignee_name:'当前用户'}),'mine',now),false);
  const groups:WorkbenchFollowAttention['related_reasons'][]=[['FOLLOW'],['COMMUNICATION'],['HANDLING']];
  for(const reasons of groups){
    const item=boardCard({attention:{following:reasons.includes('FOLLOW'),follow_version:'a'.repeat(64),related_reasons:reasons}});
    assert.equal(matchesBoardSummary(item,'mine',now),reasons.includes('HANDLING'));
  }
});
test('board today follows Shanghai midnight and completion time rather than activity time',()=>{
  for(const [completed,expected] of [['2026-11-01 23:59:59',false],['2026-11-02 00:00:00',true],['2026-11-02 10:00:00',true],['2026-11-02 10:00:01',false]] as const){
    assert.equal(matchesBoardSummary(boardCard({column:'closed',completed_at:completed,closure:completedClosure}),'today',now),expected);
  }
  assert.equal(matchesBoardSummary(boardCard({column:'active',completed_at:'2026-11-02 00:00:00'}),'today',now),false);
  assert.equal(matchesBoardSummary(boardCard({column:'closed'}),'today',now),false);
});
test('board sorting leaves active order intact, uses completion for closed, and does not mutate DTOs',()=>{
  const older=boardCard({id:'older',created_at:'2026-11-01 00:00:00',completed_at:'2026-11-02 09:00:00'}),newer=boardCard({id:'newer',completed_at:'2026-11-01 09:00:00'}),items=[newer,older];
  assert.deepEqual(sortBoardItems(items,'pending','oldest'),[older,newer]);
  assert.deepEqual(sortBoardItems(items,'pending','newest'),[newer,older]);
  assert.deepEqual(sortBoardItems(items,'closed','oldest'),[newer,older]);
  assert.deepEqual(sortBoardItems(items,'active','oldest'),items);
  assert.deepEqual(sortBoardItems(items,'active','newest'),items);
  assert.deepEqual(items,[newer,older]);
});

test('pharmacy uses the existing pill bottle icon',()=>{assert.equal(categoryOf('PHARMACY_MEDICATION').icon,PillBottle);});
const {formatBeijingShort,formatBeijingFull}: {
  formatBeijingShort:(value:string,now:number)=>string;formatBeijingFull:(value:string)=>string;
}=await import(await designModule('beijing-time'));
const {nextSummary}: {nextSummary:(item:WorkbenchCard,heat:string|undefined,self:boolean,actions?:readonly string[])=>string}=await import(await designModule('components/Drawer/next-summary'));
const {recordKind}: {recordKind:(record:{type:string;old_status:string|null;new_status:string|null;text:string|null;audience:string})=>string}=await import(await designModule('components/Timeline/record-kind'));

test('Card 18 Beijing short times retain seconds in the full title across local/ISO/year boundaries',()=>{
  assert.equal(formatBeijingShort('2026-11-03 09:07:43',now),'11-03 09:07');
  assert.equal(formatBeijingShort('2025-11-03 09:07:43',now),'2025-11-03 09:07');
  assert.equal(formatBeijingFull('2026-11-03T01:07:43Z'),'2026-11-03 09:07:43');
  const yearBoundary=Date.parse('2026-12-31T16:00:00Z');
  assert.equal(formatBeijingShort('2026-12-31T16:00:01Z',yearBoundary),'01-01 00:00');
  assert.equal(formatBeijingShort('2026-12-31T15:59:59Z',yearBoundary),'2026-12-31 23:59');
  for(const value of ['','invalid','2026-11-03T09:07:43'])assert.equal(formatBeijingShort(value,now),'');
  assert.equal(formatBeijingShort('2026-11-03 09:07:43',NaN),'');
});

test('Card 18 record kinds distinguish explicit note events from real status transitions',()=>{
  const base={type:'ticket.status_changed',old_status:null,new_status:null,text:null,audience:'INTERNAL'};
  for(const status of [{old_status:'NEW'},{new_status:'IN_PROGRESS'}])assert.equal(recordKind({...base,...status,text:'状态变更'}),'note');
  assert.equal(recordKind({...base,old_status:'ACCEPTED',new_status:'IN_PROGRESS',text:'开始处理'}),'status');
  for(const audience of ['INTERNAL','EXTERNAL'])assert.equal(recordKind({...base,audience,text:'正文'}),'note');
  assert.equal(recordKind({...base,audience:'REPORT',text:'报修原文'}),'report');
  for(const text of [null,'','  '])assert.equal(recordKind({...base,text}),'event');
  for(const old_status of [null,'IN_PROGRESS'])assert.equal(recordKind({...base,type:'ticket.note_added',old_status,new_status:'IN_PROGRESS',text:'内部备注'}),'note');
  assert.equal(recordKind({...base,old_status:'IN_PROGRESS',new_status:'IN_PROGRESS',text:'责任已转交'}),'note');
});

const summaryCopy:Record<string,readonly [string,string]>={
  NEW:['已等待 12 分钟，尚无人领取','已等待 12 分钟，尚无人领取'],
  QUEUED:['已等待 12 分钟，尚无人领取','已等待 12 分钟，尚无人领取'],
  ACCEPTED:['你已领取，尚未开始','林舟已领取，尚未开始'],
  IN_PROGRESS:['你正在处理 · 故障排除后登记完工','林舟正在处理 · 需要时可接管'],
  WAITING_REQUESTER:['等待报修人补充 · 已等待 12 分钟','等待报修人补充 · 已等待 12 分钟'],
  WAITING_VENDOR:['等待厂商回复 · 已等待 12 分钟','等待厂商回复 · 已等待 12 分钟'],
  RESOLVED:['已解决，等待报修人确认','已解决，等待报修人确认'],
  CLOSED:['工单已关闭 · 同一故障仍未解决时可重新打开','工单已关闭 · 同一故障仍未解决时可重新打开'],
  CANCELLED:['工单已取消 · 请查看取消原因','工单已取消 · 请查看取消原因'],
  REOPENED:['同一故障仍未解决 · 请重新领取','同一故障仍未解决 · 请重新领取'],
  PENDING:['规则无法判断 · 需要人工复核','规则无法判断 · 需要人工复核'],
  RECEIVED:['报修已受理 · 等待建立工单','报修已受理 · 等待建立工单'],
  WAITING_TRIAGE:['报修待判断 · 请核对报修材料','报修待判断 · 请核对报修材料'],
  WAITING_DESCRIPTION:['等待补充报修描述','等待补充报修描述'],
  DUPLICATE_LINKED:['已关联已有工单 · 请查看关联处理进展','已关联已有工单 · 请查看关联处理进展'],
  FAILED:['受理处理失败 · 请核对报修材料','受理处理失败 · 请核对报修材料'],
};
for(const [status,expected] of Object.entries(summaryCopy))for(const self of [true,false])test('Card 18 next step '+status+' '+(self?'self':'other'),()=>{
  const item={...boardCard({status}),assignee_name:'林舟'};
  assert.equal(nextSummary(item,'12 分钟',self,['takeover']),expected[self?0:1]);
});
test('Card 18 next step does not offer takeover without allowed action or invent a wait under five minutes',()=>{
  assert.equal(nextSummary({...boardCard({status:'IN_PROGRESS'}),assignee_name:'林舟'},undefined,false),'林舟正在处理');
  assert.equal(nextSummary(boardCard({status:'NEW'}),undefined,false),'尚无人领取');
});

test('Card 20 T3 semantic colors reference the primitive palette and retire the board underlay',async()=>{
  const css=await readFile(resolve(root,'app/pc-admin/src/design/tokens.css'),'utf8');
  const semantic=css.split('/* ---------- 第 2 层')[1]?.split('/* ---------- 第 3 层')[0];assert.ok(semantic);
  assert.doesNotMatch(semantic,/#(?:[\da-f]{3}){1,2}\b/iu);
  assert.doesNotMatch(css,/--(?:bg-board|bg-column|gray-board|gray-column)\s*:/u);
  assert.match(css,/--scrollbar-size:\s*8px/u);
});


test('Card 27B dismissed sort uses proven closed_at and keeps unknown time last',()=>{
  const manual=boardCard({id:'manual',column:'closed',completed_at:'2020-01-01 00:00:00',closure:{...completedClosure,kind:'DISMISSED',closed_at:'2026-11-06 09:00:00'}});
  const system=boardCard({id:'system',column:'closed',completed_at:null,closure:{...completedClosure,kind:'DISMISSED',closed_at:'2026-11-06 08:00:00'}});
  const unknown=boardCard({id:'unknown',column:'closed',completed_at:'2026-11-06 10:00:00',closure:{...completedClosure,kind:'DISMISSED',closed_at:null}});
  assert.deepEqual(sortBoardItems([unknown,system,manual],'closed','newest').map(item=>item.id),['manual','system','unknown']);
  assert.deepEqual(sortBoardItems([unknown,manual,system],'closed','oldest').map(item=>item.id),['system','manual','unknown']);
});
