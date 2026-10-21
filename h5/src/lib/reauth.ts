import {hasProtectedInput} from './reload';

let leaving=false;
/** Only a same-origin login may start OAuth. Business commands are never replayed. */
export function reconnect(returnTo:string,{automatic=false,blocked=false,confirmed=false}:{automatic?:boolean;blocked?:boolean;confirmed?:boolean}={}):boolean{
 if(leaving||((blocked||hasProtectedInput())&&!confirmed))return false;
 if(automatic&&(new URLSearchParams(location.search).get('auth_return')==='1'||!/wxwork/i.test(navigator.userAgent)))return false;
 if(!/^\/(?:report|reports|department|requests\/[A-Za-z0-9_-]{32})?(?:\?[^#]*)?$/.test(returnTo))return false;
 leaving=true;
 location.replace('/wecom/yixiaoxiu/login?return_to='+encodeURIComponent(returnTo));
 return true;
}
