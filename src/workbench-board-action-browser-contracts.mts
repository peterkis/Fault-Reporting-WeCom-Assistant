import type {WorkbenchBoardActionIntent,WorkbenchBoardActionResolution,WorkbenchBoardColumn} from '../contracts/workbench_board_action_intent_contracts.js';

export const boardColumnNames:Record<WorkbenchBoardColumn,string>={pending:'待受理',active:'处理中',closed:'已关闭'};
export const boardColumns:readonly WorkbenchBoardColumn[]=['pending','active','closed'];
export function readBoardIntent(value:unknown):WorkbenchBoardActionIntent|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==4||Object.keys(v).some(key=>!['kind','id','source_column','target_column'].includes(key))||typeof v.kind!=='string'||!['ticket','review','intake'].includes(v.kind)||typeof v.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v.id)
    ||!boardColumns.some(column=>column===v.source_column)||!boardColumns.some(column=>column===v.target_column))return null;
  return Object.freeze({kind:v.kind as WorkbenchBoardActionIntent['kind'],id:v.id,source_column:v.source_column as WorkbenchBoardColumn,target_column:v.target_column as WorkbenchBoardColumn});
}
/** Presentation only. The original current authorized GET and form own every command. */
export function planBoardAction(intent:WorkbenchBoardActionIntent):WorkbenchBoardActionResolution {
  if(intent.source_column===intent.target_column)return {state:'NO_CHANGE',intent};
  if(intent.source_column==='pending'&&intent.target_column==='active')return {state:'OPEN_EXISTING_FORM',intent,action:intent.kind==='ticket'?'SELF_HANDLE':'REVIEW_RESOLVE_AND_START'};
  if(intent.kind==='ticket'&&intent.source_column==='active'&&intent.target_column==='closed')return {state:'OPEN_EXISTING_FORM',intent,action:'STAFF_COMPLETE'};
  if(intent.kind==='ticket'&&intent.source_column==='closed'&&intent.target_column==='pending')return {state:'OPEN_EXISTING_FORM',intent,action:'STAFF_REOPEN'};
  return {state:'UNAVAILABLE',intent,reason:'INVALID_TRANSITION'};
}
