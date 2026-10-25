import {useEffect,useState} from 'react';

export type GreetingKey='greetingMorning'|'greetingAfternoon'|'greetingEvening';
const clock=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'});
/** Hospital-local display time only; never changes event epochs or query freshness. */
export function greetingAt(now:number):{key:GreetingKey;delay:number}{
 const parts=clock.formatToParts(now),part=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find(value=>value.type===type)?.value),hour=part('hour');
 const key: GreetingKey=hour<5||hour>=18?'greetingEvening':hour<12?'greetingMorning':'greetingAfternoon';
 const next=hour<5?5:hour<12?12:hour<18?18:29;
 return{key,delay:(((next-hour)*60-part('minute'))*60-part('second'))*1000-new Date(now).getMilliseconds()};
}
export function subscribeGreeting(change:(key:GreetingKey)=>void):()=>void{
 let timer:ReturnType<typeof setTimeout>|undefined,disposed=false;
 const refresh=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined;if(disposed||document.visibilityState!=='visible')return;const value=greetingAt(Date.now());change(value.key);timer=setTimeout(refresh,value.delay);};
 document.addEventListener('visibilitychange',refresh);window.addEventListener('pageshow',refresh);window.addEventListener('focus',refresh);refresh();
 return()=>{disposed=true;if(timer!==undefined)clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('pageshow',refresh);window.removeEventListener('focus',refresh);};
}
export function useGreeting():GreetingKey{
 const [key,setKey]=useState(()=>greetingAt(Date.now()).key);
 useEffect(()=>subscribeGreeting(setKey),[]);
 return key;
}
