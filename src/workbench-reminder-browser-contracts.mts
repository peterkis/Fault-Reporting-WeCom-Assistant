import type {WorkbenchReminderPage,WorkbenchReminderItem,WorkbenchReminderPreferences,WorkbenchReminderCoordination} from '../contracts/workbench_reminder_contracts.js';
import type {LocalDateTime} from '../contracts/time_contracts.js';

export const REMINDER_PREFERENCES_KEY='wbint-reminder-preferences-v1';
export const mutedReminderPreferences:WorkbenchReminderPreferences=Object.freeze({schema_version:1,sound_enabled:false,desktop_enabled:false});
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const decimal=(v:unknown,zero=true):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/u.test(v)&&BigInt(v)<=9223372036854775807n&&(zero||v!=='0');
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))throw new TypeError('REMINDER_RESPONSE_INVALID');
  return v as Record<string,unknown>;
}
function time(v:unknown):LocalDateTime{
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(v))throw new TypeError('REMINDER_RESPONSE_INVALID');
  const [date,clock]=v.split(' '),[y,m,d]=(date??'').split('-').map(Number),[h,min,s]=(clock??'').split(':').map(Number);
  if(y===undefined||m===undefined||d===undefined||h===undefined||min===undefined||s===undefined||y<1||m<1||m>12||d<1||d>([31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][m-1]??0)||h>23||min>59||s>59)throw new TypeError('REMINDER_RESPONSE_INVALID');
  return v as LocalDateTime;
}
export function decodeReminderPreferences(raw:unknown):WorkbenchReminderPreferences{
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>128)return mutedReminderPreferences;
  try{const v=object(JSON.parse(raw),['schema_version','sound_enabled','desktop_enabled']);
    return v.schema_version===1&&typeof v.sound_enabled==='boolean'&&typeof v.desktop_enabled==='boolean'?
      {schema_version:1,sound_enabled:v.sound_enabled,desktop_enabled:v.desktop_enabled}:mutedReminderPreferences;
  }catch{return mutedReminderPreferences;}
}
export function decodeReminderCoordination(raw:unknown,scope:string):WorkbenchReminderCoordination|null{
  try{const v=object(raw,['schema_version','authority_scope','kind','reminder_id']);
    if(v.schema_version!==1||v.authority_scope!==scope||!sha(v.authority_scope))return null;
    if(v.kind==='RESET'&&v.reminder_id===null)return {schema_version:1,authority_scope:scope,kind:'RESET',reminder_id:null};
    return v.kind==='SEEN'&&sha(v.reminder_id)?{schema_version:1,authority_scope:scope,kind:'SEEN',reminder_id:v.reminder_id}:null;
  }catch{return null;}
}
export function decodeReminderPage(raw:unknown):WorkbenchReminderPage{
  const v=object(raw,['schema_version','items','as_of_event_id','baseline_token','next_cursor','reset_required']);
  if(v.schema_version!==1||!Array.isArray(v.items)||v.items.length>50||!decimal(v.as_of_event_id)||typeof v.baseline_token!=='string'
    ||v.baseline_token.length<1||v.baseline_token.length>512||!/^[A-Za-z0-9_.-]+$/u.test(v.baseline_token)||typeof v.reset_required!=='boolean'
    ||v.next_cursor!==null&&(typeof v.next_cursor!=='string'||v.next_cursor.length<1||v.next_cursor.length>512||!/^[A-Za-z0-9_-]+$/u.test(v.next_cursor)))throw new TypeError('REMINDER_RESPONSE_INVALID');
  const items:WorkbenchReminderItem[]=v.items.map(rawItem=>{
    const row=object(rawItem,['reminder_id','event_id','reason','canonical_item','source_key','source_revision','occurred_at']),item=object(row.canonical_item,['kind','id']);
    if(!sha(row.reminder_id)||!sha(row.source_key)||!decimal(row.event_id,false)||!decimal(row.source_revision,false)
      ||!['AUTHORIZED_TEAM_NEW_REPORT','RELATED_NEW_MATERIAL','RELATED_REOPEN','RELATED_FOLLOW_UP_DUE'].includes(String(row.reason))
      ||!['ticket','review','intake'].includes(String(item.kind))||typeof item.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(item.id)
      ||['RELATED_REOPEN','RELATED_FOLLOW_UP_DUE'].includes(String(row.reason))&&item.kind!=='ticket')throw new TypeError('REMINDER_RESPONSE_INVALID');
    return {reminder_id:row.reminder_id,event_id:row.event_id,reason:row.reason as WorkbenchReminderItem['reason'],canonical_item:{kind:item.kind as WorkbenchReminderItem['canonical_item']['kind'],id:item.id},source_key:row.source_key,source_revision:row.source_revision,occurred_at:time(row.occurred_at)};
  });
  if(v.reset_required&&(items.length!==0||v.next_cursor!==null))throw new TypeError('REMINDER_RESPONSE_INVALID');
  return {schema_version:1,items,as_of_event_id:v.as_of_event_id,baseline_token:v.baseline_token,next_cursor:v.next_cursor as string|null,reset_required:v.reset_required};
}
