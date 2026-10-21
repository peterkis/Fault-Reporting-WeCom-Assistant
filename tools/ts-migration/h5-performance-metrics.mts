export interface Percentiles {count:number;min:number;p50:number;p75:number;p95:number;max:number}
export function percentiles(samples:readonly number[]):Percentiles{
  if(samples.length===0||samples.some(value=>!Number.isFinite(value)||value<0))throw new Error('H5_PERFORMANCE_FINITE_SAMPLES_REQUIRED');
  const sorted=[...samples].sort((a,b)=>a-b);
  const at=(fraction:number)=>{const value=sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*fraction)-1))];if(value===undefined)throw new Error('H5_PERFORMANCE_FINITE_SAMPLES_REQUIRED');return value;};
  return {count:sorted.length,min:at(0),p50:at(.5),p75:at(.75),p95:at(.95),max:at(1)};
}
export interface RequestObservation {path:string;status:number;start_ms:number;end_ms:number;mime:string;encoded_bytes:number;decoded_bytes:number;cached:boolean}
export function criticalJavaScript(observations:readonly RequestObservation[],readyMs:number):{paths:string[];encoded_bytes:number;decoded_bytes:number}{
  const selected=observations.filter(item=>item.status>=200&&item.status<400&&item.start_ms<=readyMs&&(/(?:java|ecma)script/u.test(item.mime)||/\.js$/u.test(item.path)));
  const unique=new Map<string,RequestObservation>();
  for(const item of selected)if(!unique.has(item.path))unique.set(item.path,item);
  return {paths:[...unique.keys()].sort(),encoded_bytes:[...unique.values()].reduce((sum,item)=>sum+item.encoded_bytes,0),decoded_bytes:[...unique.values()].reduce((sum,item)=>sum+item.decoded_bytes,0)};
}
function sqlReferenceCode(sql:string):string{
  let code='',index=0;
  while(index<sql.length){
    const character=sql[index];
    if(sql.startsWith('--',index)){const end=sql.indexOf('\n',index+2);index=end<0?sql.length:end;code+=' ';continue;}
    if(sql.startsWith('/*',index)){
      let depth=1;index+=2;
      while(index<sql.length&&depth>0){if(sql.startsWith('/*',index)){depth++;index+=2;}else if(sql.startsWith('*/',index)){depth--;index+=2;}else index++;}
      code+=' ';continue;
    }
    if(character==="'"){
      const escaped=/[eE]/u.test(sql[index-1]??'')&&!/[A-Za-z0-9_$]/u.test(sql[index-2]??'');index++;
      while(index<sql.length){if(escaped&&sql[index]==='\\'){index+=2;continue;}if(sql[index]==="'"){if(sql[index+1]==="'"){index+=2;continue;}index++;break;}index++;}
      code+=' ';continue;
    }
    if(character==='"'){
      let identifier='';index++;
      while(index<sql.length){if(sql[index]==='"'){if(sql[index+1]==='"'){identifier+='"';index+=2;continue;}index++;break;}identifier+=sql[index]??'';index++;}
      code+=['intake','pilot_ticket','directory','conversation'].includes(identifier)?identifier:'__quoted_identifier__';continue;
    }
    if(character==='$'){
      const tag=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index))?.[0];
      if(tag){const end=sql.indexOf(tag,index+tag.length);index=end<0?sql.length:end+tag.length;code+=' ';continue;}
    }
    code+=character??'';index++;
  }
  return code;
}
export function isBusinessSelect(sql:string):boolean{
  const code=sqlReferenceCode(sql);
  // Clock functions and catalog predicates do not turn a protected table read
  // into infrastructure. Inspect actual table references, not schema names in
  // to_regclass strings, comments or dollar-quoted metadata text.
  return /^\s*(?:SELECT|WITH)\b/iu.test(code)&&/\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:intake|pilot_ticket|directory|conversation)\s*\./iu.test(code);
}
export const WEB_VITALS_OBSERVER=String.raw`(()=>{
 const state={lcp:null,cls:0,clsWindow:0,clsFirst:0,clsLast:0,events:[],trustedClicks:0,supported:PerformanceObserver.supportedEntryTypes||[],errors:[]};
 Object.defineProperty(window,'__h5Performance',{value:state});
 new PerformanceObserver(list=>{for(const entry of list.getEntries())state.lcp=entry.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
 new PerformanceObserver(list=>{for(const entry of list.getEntries()){
  if(entry.hadRecentInput)continue;
  if(entry.startTime-state.clsLast>1000||entry.startTime-state.clsFirst>5000){state.clsWindow=entry.value;state.clsFirst=entry.startTime;}else state.clsWindow+=entry.value;
  state.clsLast=entry.startTime;state.cls=Math.max(state.cls,state.clsWindow);
 }}).observe({type:'layout-shift',buffered:true});
 if(state.supported.includes('event'))new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.interactionId)state.events.push({id:entry.interactionId,duration:entry.duration});}).observe({type:'event',buffered:true,durationThreshold:16});
 addEventListener('click',event=>{if(event.isTrusted)state.trustedClicks++;},{capture:true});
 addEventListener('error',event=>state.errors.push(String(event.message).slice(0,120)));
})();`;
export interface VitalsReading {lcp:number|null;cls:number;supported:string[];events:{id:number;duration:number}[];trustedClicks:number;errors:string[]}
export function interactionMetric(reading:VitalsReading):{status:'MEASURED'|'UPPER_BOUND'|'NOT_RUN';milliseconds:number|null;trusted_clicks:number;observed_interactions:number}{
  const values=new Map<number,number>();
  for(const item of reading.events){if(!Number.isFinite(item.duration)||item.duration<0)throw new Error('H5_PERFORMANCE_INVALID_EVENT_DURATION');values.set(item.id,Math.max(values.get(item.id)??0,item.duration));}
  if(!reading.supported.includes('event')||reading.trustedClicks===0)return {status:'NOT_RUN',milliseconds:null,trusted_clicks:reading.trustedClicks,observed_interactions:values.size};
  const sorted=[...values.values()].sort((a,b)=>b-a);
  return {status:sorted.length?'MEASURED':'UPPER_BOUND',milliseconds:sorted[Math.floor(values.size/50)]??16,trusted_clicks:reading.trustedClicks,observed_interactions:values.size};
}
