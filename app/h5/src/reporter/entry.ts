export interface CapturedReporterAccess {
 readonly identityMode:'MEMBER_REQUIRED'|'BOUND_ACCESS_SESSION';
 consumeGrant:()=>string|null;
}
export interface ReporterEntry extends CapturedReporterAccess {readonly publicRef:string|null;readonly feedback:boolean}

/** The fragment is consumed once, before any Reporter request or module load.
 * It never enters React props as a string, a cache, storage or a broadcast. */
export function captureReporterEntry():CapturedReporterAccess|null {
 const mode=document.documentElement.dataset.reporterIdentity;
 if(mode!=='MEMBER_REQUIRED'&&mode!=='BOUND_ACCESS_SESSION')return null;
 let grant=new URLSearchParams(location.hash.slice(1)).get('grant');
 history.replaceState(null,'',location.pathname);
 return{identityMode:mode,consumeGrant(){const value=grant;grant=null;return value;}};
}
