export type StaticEncoding='identity'|'gzip'|'br';

/** Equal qualities prefer Brotli, then gzip. An absent header keeps identity. */
export function negotiateStaticEncoding<T>(header:string|undefined,available:ReadonlyMap<StaticEncoding,T>):T|undefined{
 if(header===undefined)return available.get('identity');
 if(header.length>8192)return undefined;
 const qualities=new Map<string,number>();
 for(const token of header.split(',')){
  const [raw,...parameters]=token.trim().toLowerCase().split(';');if(!raw)continue;
  let quality=1;
  for(const parameter of parameters){const match=/^\s*q\s*=\s*(.*?)\s*$/u.exec(parameter);if(match){const value=match[1]??'';quality=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(value)?Number(value):0;}}
  qualities.set(raw,Math.max(qualities.get(raw)??0,quality));
 }
 let selected:T|undefined,best=0;
 for(const encoding of ['br','gzip','identity'] as const){
  const quality=qualities.get(encoding)??(encoding==='identity'?(qualities.get('*')===0?0:1):(qualities.get('*')??0));
  const candidate=available.get(encoding);if(candidate!==undefined&&quality>best){best=quality;selected=candidate;}
 }
 return selected;
}
