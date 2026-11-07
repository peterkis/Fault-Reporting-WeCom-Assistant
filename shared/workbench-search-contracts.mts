import type {WorkbenchSearchCriteria,WorkbenchSearchRequest,WorkbenchSearchStatus,WorkbenchSearchSource} from '../contracts/workbench_search_contracts.js';
export type {WorkbenchSearchCriteria,WorkbenchSearchRequest,WorkbenchSearchPage} from '../contracts/workbench_search_contracts.js';

export const SEARCH_STATUSES:readonly WorkbenchSearchStatus[]=['NEW','QUEUED','ACCEPTED','REOPENED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','RESOLVED','CLOSED','CANCELLED','DUPLICATE_LINKED','PENDING','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED','COMPLETED','IGNORED'];
export const SEARCH_SOURCES:readonly WorkbenchSearchSource[]=['WECOM_DIRECT','WECOM_GROUP','WEB_REQUEST','MANUAL_PHONE','MANUAL_ON_SITE'];
export const SEARCH_KEYS=['q','column','range','scope','responsibility','resolver_team_id','assignee_id','sources','source_group_ref','statuses','supplement','schedule','closure_kind','closed_from','closed_to'] as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class SearchInputError extends TypeError{constructor(readonly code:'INPUT_INVALID'|'LIMIT_INVALID'|'CURSOR_INVALID'='INPUT_INVALID'){super('WORKBENCH_SEARCH_'+code);}}
function invalid():never{throw new SearchInputError();}
function selected<T extends string>(value:unknown,allowed:readonly T[]):T{
 if(typeof value!=='string')invalid();const found=allowed.find(item=>item===value);if(found===undefined)invalid();return found;
}
function plain(value:unknown,keys:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const names=Object.keys(value);if(keys.some(key=>!names.includes(key))||names.some(key=>!keys.includes(key)&&!optional.includes(key)))invalid();
 return value as Record<string,unknown>;
}
function text(value:unknown):string{if(typeof value!=='string')invalid();return value;}
function optionalId(value:unknown,pattern:RegExp):string|null{
 if(value===null)return null;const id=text(value);if(!pattern.test(id))invalid();return id.toLowerCase();
}
function array<T extends string>(value:unknown,allowed:readonly T[],maximum:number):T[]{
 if(!Array.isArray(value)||value.length>maximum)invalid();
 const values=value.map(item=>selected(item,allowed));if(new Set(values).size!==values.length)invalid();
 return values.sort();
}
function localDate(value:unknown):string{
 const date=text(value);
 if(!/^(?!0000-)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u.test(date))invalid();
 const at=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==date)invalid();
 return date;
}
function customDates(value:Record<string,unknown>):{closed_from:string;closed_to:string}{
 const closed_from=localDate(value.closed_from),closed_to=localDate(value.closed_to);
 if(closed_from>closed_to||closed_to==='9999-12-31')invalid();
 return {closed_from,closed_to};
}
export function normalizeSearchCriteria(value:unknown):WorkbenchSearchCriteria{
 const optional=['closure_kind','closed_from','closed_to'],v=plain(value,SEARCH_KEYS.filter(key=>!optional.includes(key)),optional),raw=text(v.q),q=raw.trim();
 if([...q].length>128||/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(raw))invalid();
 const team=v.resolver_team_id===null?null:text(v.resolver_team_id);
 if(team!==null&&!/^[A-Z][A-Z0-9_]{1,63}$/u.test(team))invalid();
 const range=selected(v.range,['recent','all','custom']),dates=range==='custom'?customDates(v):{};
 if(range!=='custom'&&(Object.hasOwn(v,'closed_from')||Object.hasOwn(v,'closed_to')))invalid();
 return {q,column:selected(v.column,['all','pending','active','closed']),range,
  scope:selected(v.scope,['team','related']),responsibility:selected(v.responsibility,['any','handling','communication','following','unassigned']),
  resolver_team_id:team,assignee_id:optionalId(v.assignee_id,UUID),sources:array(v.sources,SEARCH_SOURCES,5),
  source_group_ref:optionalId(v.source_group_ref,/^[a-f0-9]{64}$/u),statuses:array(v.statuses,SEARCH_STATUSES,8),
  supplement:selected(v.supplement,['any','pending','followed','none']),schedule:selected(v.schedule,['any','active','due','none']),
  ...(Object.hasOwn(v,'closure_kind')?{closure_kind:selected(v.closure_kind,['completed','dismissed'])}:{}),...dates};
}
function csv(value:string|null):string[]{return value===null?[]:value.split(',');}
export function parseSearchRequest(params:URLSearchParams):WorkbenchSearchRequest{
 const keys:readonly string[]=[...SEARCH_KEYS,'cursor','limit'];
 if([...params.keys()].some(key=>!keys.includes(key))||keys.some(key=>params.getAll(key).length>1))invalid();
 const rawLimit=params.get('limit')??'50';if(!/^(?:[1-9][0-9]?|100)$/u.test(rawLimit))throw new SearchInputError('LIMIT_INVALID');
 const cursor=params.get('cursor');if(cursor!==null&&(cursor.length<1||cursor.length>2048||!/^[A-Za-z0-9_.-]+$/u.test(cursor)))throw new SearchInputError('CURSOR_INVALID');
 const criteria=normalizeSearchCriteria({q:params.get('q')??'',column:params.get('column')??'all',range:params.get('range')??'all',
  scope:params.get('scope')??'team',responsibility:params.get('responsibility')??'any',resolver_team_id:params.get('resolver_team_id'),
  assignee_id:params.get('assignee_id'),sources:csv(params.get('sources')),source_group_ref:params.get('source_group_ref'),
  statuses:csv(params.get('statuses')),supplement:params.get('supplement')??'any',schedule:params.get('schedule')??'any',
  ...(params.has('closure_kind')?{closure_kind:params.get('closure_kind')}:{}),
  ...(params.has('closed_from')?{closed_from:params.get('closed_from')}:{}),...(params.has('closed_to')?{closed_to:params.get('closed_to')}:{})});
 return {criteria,cursor,limit:Number(rawLimit)};
}
export function parseSearchBody(value:unknown):WorkbenchSearchRequest{
 const body=plain(value,['criteria','cursor','limit']);
 if(typeof body.limit!=='number'||!Number.isInteger(body.limit)||body.limit<1||body.limit>100)throw new SearchInputError('LIMIT_INVALID');
 if(body.cursor!==null&&(typeof body.cursor!=='string'||body.cursor.length<1||body.cursor.length>2048||!/^[A-Za-z0-9_.-]+$/u.test(body.cursor)))throw new SearchInputError('CURSOR_INVALID');
 return {criteria:normalizeSearchCriteria(body.criteria),cursor:body.cursor,limit:body.limit};
}
export function searchCriteriaKey(criteria:WorkbenchSearchCriteria):string{return JSON.stringify(normalizeSearchCriteria(criteria));}
export function searchParameters(criteria:WorkbenchSearchCriteria):URLSearchParams{
 const value=normalizeSearchCriteria(criteria),params=new URLSearchParams();
 for(const key of SEARCH_KEYS){
  const item=value[key];
  if(item===null)continue;
  if(Array.isArray(item)){if(item.length)params.set(key,item.join(','));}
  else if(typeof item==='string')params.set(key,item);
 }
 return params;
}
export function hasSearchCriteria(criteria:WorkbenchSearchCriteria):boolean{
 return criteria.range==='custom'||criteria.q!==''||criteria.responsibility!=='any'||criteria.resolver_team_id!==null||criteria.assignee_id!==null||criteria.sources.length>0||
  criteria.source_group_ref!==null||criteria.statuses.length>0||criteria.supplement!=='any'||criteria.schedule!=='any'||criteria.closure_kind!==undefined;
}
