/** Display names need not be unique; keys are name + occurrence (「张伟#2」), collision-free without any identifier. */
export function withPresentationKeys<T extends {display_name:string}>(items:readonly T[]){
  const seen=new Map<string,number>();
  return items.map(item=>{const count=(seen.get(item.display_name)??0)+1;seen.set(item.display_name,count);return {key:item.display_name+'#'+count,item};});
}
