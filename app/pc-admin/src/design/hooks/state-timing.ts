/** CSS tokens are the sole production values; all state timers read through this boundary. */
export function stateDuration(token:string):number{
  const value=getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)m?s$/u.test(value))throw new Error('STATE_DURATION_TOKEN_INVALID '+token);
  return Number.parseFloat(value)*(value.endsWith('ms')?1:1000);
}
export const loadingTiming=()=>({delay:stateDuration('--load-delay'),minVisible:stateDuration('--load-min')});
export const connectionTiming=()=>({recovered:stateDuration('--connection-recovered'),stale:stateDuration('--connection-stale'),retry:[stateDuration('--connection-retry-1'),stateDuration('--connection-retry-2'),stateDuration('--connection-retry-3')]});
