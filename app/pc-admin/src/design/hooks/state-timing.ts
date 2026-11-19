/** CSS tokens are the sole production values; all state timers read through this boundary. */
const durationCache=new Map<string,number>();
let cachedLoadingTiming:{delay:number;minVisible:number}|null=null;
let cachedConnectionTiming:{recovered:number;stale:number;retry:number[]}|null=null;

function parseDurationToken(token:string,styles:CSSStyleDeclaration):number{
  const value=styles.getPropertyValue(token).trim();
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)m?s$/u.test(value))throw new Error('STATE_DURATION_TOKEN_INVALID '+token);
  const parsed=Number.parseFloat(value)*(value.endsWith('ms')?1:1000);
  durationCache.set(token,parsed);
  return parsed;
}
export function stateDuration(token:string):number{
  const cached=durationCache.get(token);
  if(cached!==undefined)return cached;
  return parseDurationToken(token,getComputedStyle(document.documentElement));
}
export const loadingTiming=()=>{
  if(cachedLoadingTiming)return cachedLoadingTiming;
  const styles=getComputedStyle(document.documentElement);
  cachedLoadingTiming={delay:durationCache.get('--load-delay')??parseDurationToken('--load-delay',styles),minVisible:durationCache.get('--load-min')??parseDurationToken('--load-min',styles)};
  return cachedLoadingTiming;
};
export const connectionTiming=()=>{
  if(cachedConnectionTiming)return cachedConnectionTiming;
  const styles=getComputedStyle(document.documentElement);
  const read=(token:string)=>durationCache.get(token)??parseDurationToken(token,styles);
  cachedConnectionTiming={recovered:read('--connection-recovered'),stale:read('--connection-stale'),retry:[read('--connection-retry-1'),read('--connection-retry-2'),read('--connection-retry-3')]};
  return cachedConnectionTiming;
};
