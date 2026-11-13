/**
 * Codex review (card 34C): a visible, stable code for an item whose number is not shown in full (a conversation session, a
 * notification subscription). It is the shortest upper-case suffix of the id, at least `min` characters, that no other id in
 * `ids` shares, so two items on screen never read the same; it only grows when a colliding id appears.
 */
export function shortCodes(ids:readonly string[],min=6):Map<string,string>{
  const plain=[...new Set(ids)].map(id=>[id,id.replace(/-/gu,'').toUpperCase()] as const),codes=new Map<string,string>();
  for(const [id,value] of plain){
    let length=Math.min(min,value.length);
    while(length<value.length&&plain.some(([other,text])=>other!==id&&text.endsWith(value.slice(-length))))length++;
    codes.set(id,value.slice(-length));
  }
  return codes;
}
export function shortCode(id:string,ids:readonly string[],min=6):string{return shortCodes([id,...ids],min).get(id)??id;}
