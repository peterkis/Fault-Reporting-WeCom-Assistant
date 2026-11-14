import {useRef} from 'react';
import {shortCode} from './short-code';

/**
 * Codex review (card 34C): a choice kept after its row left the loaded page still says which item it is. Each row's label is
 * remembered while it is on screen; a choice never seen here (restored from a draft) falls back to the tail of its number.
 */
export function useSeenLabels(rows:readonly (readonly [string,string])[]){
  const seen=useRef(new Map<string,string>());
  for(const [id,label] of rows)if(id)seen.current.set(id,label);
  // `fallback` names a choice never seen here when its number is readable (a team code); otherwise the number's tail is shown.
  return (id:string,full=false,fallback?:string):string=>'已选：'+(seen.current.get(id)??fallback??'尾号 '+shortCode(id,[]))+'（不在当前列表，提交时确认）'+(full?' · 编号 '+id:'');
}
