export interface HashLocation {pathname:string;search:string}
export interface HashHistoryDriver {origin:string;readHash:()=>string;writeHash:(hash:string,replace:boolean)=>void;go:(delta:number)=>void;listen:(listener:()=>void)=>()=>void}
export function hashLocation(hash:string,origin:string):HashLocation{const url=new URL(hash.replace(/^#/,'')||'/',origin);return{pathname:url.pathname,search:url.search};}
export function routeHref(to:string,current:HashLocation,origin:string):string{const url=new URL(to.replace(/^#/,'')||'/',origin+current.pathname+current.search);if(url.origin!==origin)throw new TypeError('H5 navigation must stay in this origin');return'#'+url.pathname+url.search;}
export interface NavigationClick {button:number;metaKey:boolean;altKey:boolean;ctrlKey:boolean;shiftKey:boolean;defaultPrevented:boolean}
export function handleLinkClick(event:NavigationClick,target:string|undefined,download:boolean):boolean{return!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.altKey&&!event.ctrlKey&&!event.shiftKey&&(!target||target==='_self')&&!download;}
export function createHashHistory(driver:HashHistoryDriver){
 let snapshot=hashLocation(driver.readHash(),driver.origin),stop:(()=>void)|null=null;const listeners=new Set<()=>void>();
 const update=()=>{const next=hashLocation(driver.readHash(),driver.origin);if(next.pathname===snapshot.pathname&&next.search===snapshot.search)return;snapshot=next;for(const listener of listeners)listener();};
 const subscribe=(listener:()=>void)=>{listeners.add(listener);if(!stop)stop=driver.listen(update);return()=>{listeners.delete(listener);if(listeners.size===0){stop?.();stop=null;}};};
 const navigate=(to:string|number,options:{replace?:boolean}={})=>{if(typeof to==='number'){driver.go(to);return;}const href=routeHref(to,snapshot,driver.origin);if(href===driver.readHash())return;driver.writeHash(href,options.replace===true);update();};
 return{subscribe,getSnapshot:()=>snapshot,navigate,href:(to:string)=>routeHref(to,snapshot,driver.origin)};
}
