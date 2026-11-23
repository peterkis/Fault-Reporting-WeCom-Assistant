import {useSyncExternalStore} from 'react';

export type DurationToken='--dur-instant'|'--dur-fast'|'--dur-base'|'--dur-slow'|'--dur-move'|'--dur-highlight'|'--dur-return';
export type EasingToken='--ease-standard'|'--ease-soft'|'--ease-exit';
type NumericToken=DurationToken|'--delay-tooltip'|'--delay-hover-card-close'|'--delay-hover-card-warm'|'--press-scale'|'--scale-popover'|'--shift-xs'|'--shift-sm'|'--shift-md'|'--shift-lg'|'--space-12';
const cache=new Map<string,string>();
const listeners=new Set<()=>void>();
const WARM_TOKENS:readonly string[]=[
  '--dur-instant','--dur-fast','--dur-base','--dur-slow','--dur-move','--dur-highlight','--dur-return',
  '--ease-standard','--ease-soft','--ease-exit',
  '--delay-tooltip','--delay-hover-card-close','--delay-hover-card-warm','--press-scale','--scale-popover',
  '--shift-xs','--shift-sm','--shift-md','--shift-lg','--space-12',
  '--brand-subtle','--stage-intake-bg','--stage-active-bg','--stage-done-bg','--tone-danger-dot',
];
let media:MediaQueryList|undefined,override=false,revision=0;

/** Reads all known motion CSS custom properties in one computed-style access when the cache is cold. */
export function warmMotionTokens(){
  initMotionPreferences();
  if(cache.size>0||typeof document==='undefined')return;
  const styles=getComputedStyle(document.documentElement);
  for(const token of WARM_TOKENS){
    const value=styles.getPropertyValue(token).trim();
    if(value)cache.set(token,value);
  }
}

/** One source of truth: CSS durations are returned in milliseconds, curves as CSS strings. */
export function motionToken(name:EasingToken):string;
export function motionToken(name:NumericToken):number;
export function motionToken(name:EasingToken|NumericToken):number|string {
  initMotionPreferences();
  let value=cache.get(name);
  if(value===undefined){
    if(cache.size===0)warmMotionTokens();
    value=cache.get(name);
    if(value===undefined){value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();cache.set(name,value);}
  }
  if(name.startsWith('--ease-')){if(!value)throw Error('MOTION_TOKEN_MISSING '+name);return value;}
  const match=/^(-?(?:\d*\.)?\d+)\s*(ms|s|px)?$/.exec(value);
  if(!match)throw Error('MOTION_TOKEN_INVALID '+name);
  const result=Number(match[1])*(match[2]==='s'?1000:1);
  if(!Number.isFinite(result))throw Error('MOTION_TOKEN_INVALID '+name);
  return result;
}
export function initMotionPreferences(){
  if(media||typeof window==='undefined')return;
  media=window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change',invalidateMotionTokens);
  document.addEventListener('visibilitychange',invalidateMotionTokens);
  reflectPreference();
}
function reflectPreference(){document.documentElement.toggleAttribute('data-motion-reduced',override||media?.matches===true);}
/** Also used after a development-only token override; never cache across preference changes. */
export function invalidateMotionTokens(){cache.clear();revision++;reflectPreference();for(const listener of listeners)listener();}
export function setMotionPreferenceOverride(reduced:boolean){override=reduced;initMotionPreferences();invalidateMotionTokens();}
export function prefersReducedMotion(){initMotionPreferences();return override||media?.matches===true;}
export function subscribeMotion(listener:()=>void){initMotionPreferences();listeners.add(listener);return()=>{listeners.delete(listener);};}
export function useMotionRevision(){return useSyncExternalStore(subscribeMotion,()=>revision,()=>0);}
export function useReducedMotion(){useMotionRevision();return prefersReducedMotion();}
export function highlightToneColor(tone:'intake'|'active'|'done'|'brand'):string{
  initMotionPreferences();
  const name=tone==='brand'?'--brand-subtle':`--stage-${tone}-bg`;
  let value=cache.get(name);
  if(value===undefined){
    if(cache.size===0)warmMotionTokens();
    value=cache.get(name);
    if(value===undefined){value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();cache.set(name,value);}
  }
  return value;
}
