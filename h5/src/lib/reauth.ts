import {hasProtectedInput} from './reload';

let leaving=false;
export function isWeComClient():boolean{return /wxwork/i.test(navigator.userAgent);}
export function canReconnectAutomatically():boolean{return isWeComClient()&&new URLSearchParams(location.search).get('auth_return')!=='1';}
/** Only a same-origin login may start OAuth. Business commands are never replayed. */
export function reconnect(returnTo:string,{automatic=false,blocked=false,confirmed=false}:{automatic?:boolean;blocked?:boolean;confirmed?:boolean}={}):boolean{
 if(leaving||((blocked||hasProtectedInput())&&!confirmed))return false;
 if(automatic&&!canReconnectAutomatically())return false;
 if(!/^\/(?:report|reports|department|requests\/[A-Za-z0-9_-]{32})?(?:\?[^#]*)?$/.test(returnTo))return false;
 leaving=true;
 location.replace('/wecom/yixiaoxiu/login?return_to='+encodeURIComponent(returnTo));
 return true;
}
